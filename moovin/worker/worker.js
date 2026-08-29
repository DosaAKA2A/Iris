/* MOOVIN — API del catálogo y de subidas al bucket R2 "cine".
   (El bucket, el worker y la ruta /cine conservan ese nombre a propósito:
   son identificadores, y renombrarlos rompería los enlaces ya compartidos.)
   ---------------------------------------------------------------------------
   La biblioteca es PRIVADA: el bucket no tiene URL pública (se apagó con
   `wrangler r2 bucket dev-url disable cine`) y todo lo sirve este worker, que
   exige un pase. Si no, cerrar la página no cerraría nada: los archivos se
   bajaban con la URL del bucket sin pasar por aquí.

   Hay tres formas de entrar y las tres acaban en el MISMO token firmado, que es
   lo único que abre /catalogo y /media:
     1. el pase compartido de siempre (el secreto MOOVIN_PASE), o un pase
        temporal acuñado en el backoffice;
     2. una cuenta a la que Dosa le dio acceso (se entra con un código al correo);
     3. una pantalla emparejada — un televisor que quedó colgando de una cuenta
        al escanear el QR del mando desde un móvil que ya había entrado.
   Así el portón no cambia y las URLs de /media siguen sirviendo igual.

   Público:
     GET  /health                     -> ok
     POST /entrar {pase}              -> {token, exp}; MOOVIN_PASE o un pase temporal
     POST /salir-dispositivo {clave} -> la pantalla se da de baja a si misma
     POST /entrar-dispositivo {clave} -> {token, exp}; la clave de una pantalla
     POST /cuenta/codigo {correo}     -> manda el código de acceso al correo
     POST /cuenta/entrar {correo, codigo, nombre} -> {token, exp, usuario}
     POST /vincular/nuevo             -> {codigo, secreto}; lo pide el televisor
     GET  /vincular/mira?codigo=      -> ¿ese código está esperando una cuenta?
     POST /vincular/estado {codigo, secreto} -> la tele recoge su clave
   Con sesión de cuenta (Authorization: Bearer <token de sesión>):
     GET  /cuenta/yo                  -> perfil y si tiene acceso
     POST /cuenta/pase                -> el token firmado, si la cuenta tiene acceso
     PUT  /cuenta/perfil {nombre, avatar}
     PUT  /cuenta/avatar              -> sube la foto (webp de 256x256, tope 200 KB)
     POST /cuenta/salir
     POST /vincular/confirmar {codigo} -> le da acceso a esa pantalla
   Con pase (?t=<token> o Authorization: Bearer <token>):
     GET /catalogo                 -> biblioteca.json guardado en el bucket
     GET /media?key=               -> el objeto para reproducir (con rangos)
     GET /descargar?key=&n=        -> el mismo objeto como adjunto
   Con token de administración (Authorization: Bearer <MOOVIN_TOKEN>):
     GET  /api/check               -> comprueba el token
     PUT  /api/catalogo            -> reemplaza biblioteca.json (valida JSON)
     PUT  /api/objeto?key=...      -> sube un objeto pequeño (póster, subs)
     DELETE /api/objeto?key=...    -> borra un objeto
     POST /api/multipart/create    -> {key, contentType} -> {uploadId}
     PUT  /api/multipart/part?key&uploadId&part          -> {etag, part}
     POST /api/multipart/complete  -> {key, uploadId, parts:[{part,etag}]}
     POST /api/multipart/abort     -> {key, uploadId}
     /api/cuentas* /api/pases* /api/eventos                -> ver admin.js

   Las películas se suben por partes porque cada request a un Worker admite
   ~100 MB de cuerpo; el backoffice trocea el archivo y las une R2.

   El token del pase va firmado (HMAC-SHA256 con MOOVIN_TOKEN de clave) y lleva
   dentro su caducidad, así que no hace falta guardar nada: el worker lo
   verifica solo. Dura un día, que da de sobra para ver la película y para
   descargarla, y un enlace que se escape deja de servir al caducar.

   Cuentas, pantallas, pases temporales y contadores viven en D1 (ver
   esquema.sql). El token firmado sigue sin guardarse en ningún sitio.

   Ojo con la revocación: quitarle el acceso a una cuenta no mata el token que
   ya tenga en la mano, que dura un día. Es el mismo trato que el pase de
   siempre y se acepta a sabiendas; lo que sí corta en seco es bloquear la
   cuenta, que además borra sus sesiones y sus pantallas.

   Desplegar:  npx wrangler deploy      (desde moovin/worker/)
               npx wrangler d1 execute moovin --remote --file=esquema.sql
   Secretos:   npx wrangler secret put MOOVIN_TOKEN      (administración)
               npx wrangler secret put MOOVIN_PASE       (pase de la biblioteca)
               npx wrangler secret put CORREO_PROVEEDOR  (brevo | resend)
               npx wrangler secret put CORREO_CLAVE
               npx wrangler secret put CORREO_REMITENTE
*/
import { barreVencidos } from './limites.js';
import {
  pideCodigo, verificaCodigo, sesionDe, cierraSesion, perfil, tieneAcceso,
  cambiaPerfil, vinculoNuevo, vinculoMira, vinculoConfirma, vinculoEstado,
  dispositivoDe, dispositivoBaja, paseTemporalOk
} from './cuentas.js';
import * as backoffice from './admin.js';

const TTL_PASE = 24 * 3600;
const MAX_AVATAR = 200 * 1024;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Comparación en tiempo constante: comparar con === filtra el secreto letra a letra.
function igual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length || !a.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function firma(env, texto) {
  const clave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode((env.MOOVIN_TOKEN || '').trim()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64url(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(texto)));
}
async function nuevoToken(env) {
  const exp = Math.floor(Date.now() / 1000) + TTL_PASE;
  return { token: exp + '.' + await firma(env, String(exp)), exp };
}
async function tokenOk(env, t) {
  const i = String(t || '').indexOf('.');
  if (i < 1) return false;
  const exp = parseInt(t.slice(0, i), 10);
  if (!(exp > Math.floor(Date.now() / 1000))) return false;
  return igual(t.slice(i + 1), await firma(env, String(exp)));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Max-Age': '86400'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const json = (o, s) => new Response(JSON.stringify(o), {
      status: s || 200, headers: { ...cors, 'Content-Type': 'application/json' }
    });

    if (url.pathname === '/health') return new Response('ok', { headers: cors });

    /* trim(): al poner un secret por stdin en Windows se cuela un \r final. */
    const bearer = (req.headers.get('Authorization') || '').trim().replace(/^Bearer\s+/i, '');
    const admin = igual(bearer, (env.MOOVIN_TOKEN || '').trim());

    /* Entrar con el pase de la biblioteca -> token firmado con caducidad. */
    if (url.pathname === '/entrar' && req.method === 'POST') {
      let pase = '';
      try { pase = String((await req.json()).pase || '').trim(); } catch (e) { /* cuerpo raro */ }
      const bueno = igual(pase, (env.MOOVIN_PASE || '').trim())
        || await paseTemporalOk(env, pase);
      if (!bueno) return json({ error: 'pase incorrecto' }, 401);
      return json(await nuevoToken(env));
    }

    /* Entrar desde Naviris sin escribir nada: la app trae una clave propia y a
       cambio recibe el MISMO token con caducidad que da el pase.

       Esto NO es tan fuerte como el pase y conviene tenerlo claro: la clave
       viaja dentro del instalador de Naviris, que se descarga en abierto, y un
       .asar se abre con cualquier descompresor. O sea que quien se lo proponga
       puede sacarla. Sirve para que no entre quien tropiece con la URL, no
       para resistir a alguien decidido. Se aceptó a sabiendas (biblioteca
       personal, grupo pequeño).
       Por eso es una credencial APARTE del pase: si algún día hay que rotarla,
       se cambia NAVIRIS_KEY y se publica una versión nueva de Naviris, sin
       tocar el pase de quien entra por navegador. */
    if (url.pathname === '/entrar-app' && req.method === 'POST') {
      const esperada = (env.NAVIRIS_KEY || '').trim();
      if (!esperada) return json({ error: 'no configurado' }, 401);
      let clave = '';
      try { clave = String((await req.json()).clave || '').trim(); } catch (e) { /* cuerpo raro */ }
      if (!igual(clave, esperada)) return json({ error: 'clave incorrecta' }, 401);
      return json(await nuevoToken(env));
    }

    /* ---- cuentas, pantallas y emparejamiento -------------------------------
       Todo lo de aqui abajo acaba en el MISMO token firmado de arriba. El
       porton no se entera de que existen las cuentas: solo ve el token. */

    const cuerpoDe = async () => { try { return await req.json(); } catch (e) { return {}; } };
    const resp = (r) => json(r.cuerpo, r.estado);
    const sinD1 = () => json({ error: 'las cuentas no estan configuradas' }, 503);

    if (url.pathname.startsWith('/cuenta/') || url.pathname.startsWith('/vincular/')
      || url.pathname === '/entrar-dispositivo' || url.pathname === '/salir-dispositivo') {
      if (!env.DB) return sinD1();
    }

    /* La tele cambia su clave de pantalla por el token de siempre. */
    if (url.pathname === '/entrar-dispositivo' && req.method === 'POST') {
      const { clave } = await cuerpoDe();
      const u = await dispositivoDe(env, String(clave || ''));
      if (!u) return json({ error: 'esta pantalla ya no tiene acceso' }, 401);
      return json({ ...(await nuevoToken(env)), usuario: perfil(u) });
    }

    /* Y se da de baja sola cuando el mando se lo pide. */
    if (url.pathname === '/salir-dispositivo' && req.method === 'POST') {
      const { clave } = await cuerpoDe();
      return resp(await dispositivoBaja(env, String(clave || '')));
    }

    if (url.pathname === '/cuenta/codigo' && req.method === 'POST') {
      return resp(await pideCodigo(env, req, await cuerpoDe()));
    }
    if (url.pathname === '/cuenta/entrar' && req.method === 'POST') {
      return resp(await verificaCodigo(env, req, await cuerpoDe()));
    }
    if (url.pathname === '/vincular/nuevo' && req.method === 'POST') {
      return resp(await vinculoNuevo(env, req));
    }
    if (url.pathname === '/vincular/mira' && req.method === 'GET') {
      return resp(await vinculoMira(env, url.searchParams.get('codigo')));
    }
    if (url.pathname === '/vincular/estado' && req.method === 'POST') {
      return resp(await vinculoEstado(env, req, await cuerpoDe()));
    }

    /* De aqui en adelante hace falta una sesion de cuenta. El bearer se mira
       solo si la ruta lo pide: una sesion no vale como pase. */
    if (url.pathname === '/cuenta/yo' || url.pathname === '/cuenta/pase'
      || url.pathname === '/cuenta/perfil' || url.pathname === '/cuenta/avatar'
      || url.pathname === '/cuenta/salir' || url.pathname === '/vincular/confirmar') {

      if (url.pathname === '/cuenta/salir' && req.method === 'POST') {
        return resp(await cierraSesion(env, req));
      }
      const u = await sesionDe(env, req, bearer);
      if (!u) return json({ error: 'sesion no valida' }, 401);

      if (url.pathname === '/cuenta/yo' && req.method === 'GET') {
        return json({ usuario: perfil(u) });
      }
      /* El canje: la cuenta con acceso pide el token firmado. Se pide otra vez
         cada pocas horas, y ahi es donde se nota que le quitaron el acceso. */
      if (url.pathname === '/cuenta/pase' && req.method === 'POST') {
        if (!tieneAcceso(u)) {
          return json({ error: 'tu cuenta todavia no tiene acceso', usuario: perfil(u) }, 403);
        }
        return json({ ...(await nuevoToken(env)), usuario: perfil(u) });
      }
      if (url.pathname === '/cuenta/perfil' && (req.method === 'PUT' || req.method === 'POST')) {
        return resp(await cambiaPerfil(env, u.id, await cuerpoDe()));
      }
      /* La foto llega ya recortada y en webp desde el navegador; aqui solo se
         mira el tamano y se guarda en el bucket. */
      if (url.pathname === '/cuenta/avatar' && (req.method === 'PUT' || req.method === 'POST')) {
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (!bytes.length) return json({ error: 'no llego la foto' }, 400);
        if (bytes.length > MAX_AVATAR) return json({ error: 'la foto pesa demasiado' }, 413);
        const key = 'avatares/' + u.id + '.webp';
        await env.MOOVIN.put(key, bytes, { httpMetadata: { contentType: 'image/webp' } });
        return resp(await cambiaPerfil(env, u.id, { avatar: key }));
      }
      if (url.pathname === '/vincular/confirmar' && req.method === 'POST') {
        return resp(await vinculoConfirma(env, req, u, await cuerpoDe()));
      }
      return json({ error: 'metodo' }, 405);
    }

    /* ---- de aquí en adelante hace falta el pase (o ser administración) ---- */
    const pasa = admin || await tokenOk(env, url.searchParams.get('t') || bearer);
    const sinPase = () => json({ error: 'hace falta el pase' }, 401);

    if (url.pathname === '/catalogo' && req.method === 'GET') {
      if (!pasa) return sinPase();
      const obj = await env.MOOVIN.get('biblioteca.json');
      if (!obj) return json({ titulos: [] });
      return new Response(obj.body, {
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    /* Servir un archivo del bucket, para ver (/media) o para guardar
       (/descargar, que además manda Content-Disposition: sin él el navegador
       abriría la película en una pestaña en vez de bajarla, y para el Watch
       Party cada persona necesita su copia en disco).
       Pasa los rangos: así se puede saltar dentro del video y reanudar la
       descarga. */
    if ((url.pathname === '/media' || url.pathname === '/descargar')
      && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!pasa) return sinPase();
      const key = url.searchParams.get('key') || '';
      if (!key || key === 'biblioteca.json' || key.indexOf('..') !== -1) {
        return json({ error: 'key invalida' }, 400);
      }
      const rango = req.headers.get('range');
      let obj;
      try { obj = await env.MOOVIN.get(key, { range: req.headers }); }
      catch (e) { return json({ error: 'rango invalido' }, 416); }
      if (!obj) return json({ error: 'no existe' }, 404);
      const h = new Headers(cors);
      obj.writeHttpMetadata(h);
      h.set('Accept-Ranges', 'bytes');
      h.set('ETag', obj.httpEtag);
      // Privado: que no se quede en caches compartidas por el camino.
      h.set('Cache-Control', 'private, max-age=31536000, immutable');
      if (url.pathname === '/descargar') {
        const nombre = (url.searchParams.get('n') || key.split('/').pop() || 'descarga')
          .replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120);
        h.set('Content-Disposition', 'attachment; filename="' + nombre + '"');
      }
      const cuerpo = req.method === 'HEAD' ? null : obj.body;
      if (rango && obj.range) {
        const ini = obj.range.offset || 0;
        const largo = obj.range.length != null ? obj.range.length : obj.size - ini;
        h.set('Content-Range', 'bytes ' + ini + '-' + (ini + largo - 1) + '/' + obj.size);
        h.set('Content-Length', String(largo));
        return new Response(cuerpo, { status: 206, headers: h });
      }
      h.set('Content-Length', String(obj.size));
      return new Response(cuerpo, { headers: h });
    }

    /* ---- de aquí en adelante hace falta el token de administración ---- */
    if (!admin) return json({ error: 'no autorizado' }, 401);

    if (url.pathname === '/api/check') return json({ ok: true });

    if (url.pathname.startsWith('/api/cuentas') || url.pathname.startsWith('/api/pases/')
      || url.pathname === '/api/pases' || url.pathname === '/api/eventos') {
      if (!env.DB) return json({ error: 'las cuentas no estan configuradas' }, 503);
      const r = await backoffice.ruta(env, req, url);
      return json(r.cuerpo, r.estado);
    }

    /* Token de pase para el backoffice: un <img> no puede mandar cabeceras, así
       que las miniaturas necesitan el token en la URL. Mejor uno de un día que
       pasear el token de administración por los src. */
    if (url.pathname === '/api/pase') return json(await nuevoToken(env));

    if (url.pathname === '/api/catalogo' && req.method === 'PUT') {
      const body = await req.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { return json({ error: 'JSON invalido' }, 400); }
      if (!parsed || !Array.isArray(parsed.titulos)) return json({ error: 'falta titulos[]' }, 400);
      await env.MOOVIN.put('biblioteca.json', body, {
        httpMetadata: { contentType: 'application/json' }
      });
      return json({ ok: true, n: parsed.titulos.length });
    }

    if (url.pathname === '/api/objeto') {
      const key = url.searchParams.get('key') || '';
      if (!key || key === 'biblioteca.json' || key.indexOf('..') !== -1) return json({ error: 'key invalida' }, 400);
      if (req.method === 'PUT') {
        await env.MOOVIN.put(key, req.body, {
          httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' }
        });
        return json({ ok: true, key });
      }
      if (req.method === 'DELETE') {
        await env.MOOVIN.delete(key);
        return json({ ok: true });
      }
      return json({ error: 'metodo' }, 405);
    }

    if (url.pathname === '/api/multipart/create' && req.method === 'POST') {
      const { key, contentType } = await req.json();
      if (!key || key === 'biblioteca.json') return json({ error: 'key invalida' }, 400);
      const up = await env.MOOVIN.createMultipartUpload(key, {
        httpMetadata: { contentType: contentType || 'video/mp4' }
      });
      return json({ uploadId: up.uploadId });
    }

    if (url.pathname === '/api/multipart/part' && req.method === 'PUT') {
      const key = url.searchParams.get('key');
      const uploadId = url.searchParams.get('uploadId');
      const part = parseInt(url.searchParams.get('part'), 10);
      if (!key || !uploadId || !(part >= 1)) return json({ error: 'parametros' }, 400);
      const up = env.MOOVIN.resumeMultipartUpload(key, uploadId);
      try {
        const p = await up.uploadPart(part, req.body);
        return json({ etag: p.etag, part });
      } catch (e) {
        return json({ error: String(e.message || e) }, 400);
      }
    }

    if (url.pathname === '/api/multipart/complete' && req.method === 'POST') {
      const { key, uploadId, parts } = await req.json();
      const up = env.MOOVIN.resumeMultipartUpload(key, uploadId);
      try {
        await up.complete((parts || []).map((p) => ({ partNumber: p.part, etag: p.etag })));
        return json({ ok: true, key });
      } catch (e) {
        return json({ error: String(e.message || e) }, 400);
      }
    }

    if (url.pathname === '/api/multipart/abort' && req.method === 'POST') {
      const { key, uploadId } = await req.json();
      try { await env.MOOVIN.resumeMultipartUpload(key, uploadId).abort(); } catch (e) { /* ya no existe */ }
      return json({ ok: true });
    }

    return json({ error: 'ruta desconocida' }, 404);
  },

  /* Una vez al dia se tiran los codigos vencidos, las sesiones muertas, los
     emparejamientos que nadie recogio y los contadores del rato pasado. */
  async scheduled(evt, env, ctx) {
    if (env.DB) ctx.waitUntil(barreVencidos(env));
  }
};
