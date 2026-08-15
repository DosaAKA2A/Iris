/* MOOVIN — API del catálogo y de subidas al bucket R2 "cine".
   (El bucket, el worker y la ruta /cine conservan ese nombre a propósito:
   son identificadores, y renombrarlos rompería los enlaces ya compartidos.)
   ---------------------------------------------------------------------------
   La biblioteca es PRIVADA: el bucket no tiene URL pública (se apagó con
   `wrangler r2 bucket dev-url disable cine`) y todo lo sirve este worker, que
   exige un pase. Si no, cerrar la página no cerraría nada: los archivos se
   bajaban con la URL del bucket sin pasar por aquí.

   Público:
     GET  /health                  -> ok
     POST /entrar {pase}           -> {token, exp}; el pase es el secret CINE_PASE
   Con pase (?t=<token> o Authorization: Bearer <token>):
     GET /catalogo                 -> biblioteca.json guardado en el bucket
     GET /media?key=               -> el objeto para reproducir (con rangos)
     GET /descargar?key=&n=        -> el mismo objeto como adjunto
   Con token de administración (Authorization: Bearer <CINE_TOKEN>):
     GET  /api/check               -> comprueba el token
     PUT  /api/catalogo            -> reemplaza biblioteca.json (valida JSON)
     PUT  /api/objeto?key=...      -> sube un objeto pequeño (póster, subs)
     DELETE /api/objeto?key=...    -> borra un objeto
     POST /api/multipart/create    -> {key, contentType} -> {uploadId}
     PUT  /api/multipart/part?key&uploadId&part          -> {etag, part}
     POST /api/multipart/complete  -> {key, uploadId, parts:[{part,etag}]}
     POST /api/multipart/abort     -> {key, uploadId}

   Las películas se suben por partes porque cada request a un Worker admite
   ~100 MB de cuerpo; el backoffice trocea el archivo y las une R2.

   El token del pase va firmado (HMAC-SHA256 con CINE_TOKEN de clave) y lleva
   dentro su caducidad, así que no hace falta guardar nada: el worker lo
   verifica solo. Dura un día, que da de sobra para ver la película y para
   descargarla, y un enlace que se escape deja de servir al caducar.

   Desplegar:  npx wrangler deploy      (desde cine/worker/)
   Secretos:   npx wrangler secret put CINE_TOKEN   (administración)
               npx wrangler secret put CINE_PASE    (pase de la biblioteca)
*/
const TTL_PASE = 24 * 3600;

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
    'raw', new TextEncoder().encode((env.CINE_TOKEN || '').trim()),
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
    const admin = igual(bearer, (env.CINE_TOKEN || '').trim());

    /* Entrar con el pase de la biblioteca -> token firmado con caducidad. */
    if (url.pathname === '/entrar' && req.method === 'POST') {
      let pase = '';
      try { pase = String((await req.json()).pase || '').trim(); } catch (e) { /* cuerpo raro */ }
      if (!igual(pase, (env.CINE_PASE || '').trim())) return json({ error: 'pase incorrecto' }, 401);
      return json(await nuevoToken(env));
    }

    /* ---- de aquí en adelante hace falta el pase (o ser administración) ---- */
    const pasa = admin || await tokenOk(env, url.searchParams.get('t') || bearer);
    const sinPase = () => json({ error: 'hace falta el pase' }, 401);

    if (url.pathname === '/catalogo' && req.method === 'GET') {
      if (!pasa) return sinPase();
      const obj = await env.CINE.get('biblioteca.json');
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
      try { obj = await env.CINE.get(key, { range: req.headers }); }
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

    /* Token de pase para el backoffice: un <img> no puede mandar cabeceras, así
       que las miniaturas necesitan el token en la URL. Mejor uno de un día que
       pasear el token de administración por los src. */
    if (url.pathname === '/api/pase') return json(await nuevoToken(env));

    if (url.pathname === '/api/catalogo' && req.method === 'PUT') {
      const body = await req.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { return json({ error: 'JSON invalido' }, 400); }
      if (!parsed || !Array.isArray(parsed.titulos)) return json({ error: 'falta titulos[]' }, 400);
      await env.CINE.put('biblioteca.json', body, {
        httpMetadata: { contentType: 'application/json' }
      });
      return json({ ok: true, n: parsed.titulos.length });
    }

    if (url.pathname === '/api/objeto') {
      const key = url.searchParams.get('key') || '';
      if (!key || key === 'biblioteca.json' || key.indexOf('..') !== -1) return json({ error: 'key invalida' }, 400);
      if (req.method === 'PUT') {
        await env.CINE.put(key, req.body, {
          httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' }
        });
        return json({ ok: true, key });
      }
      if (req.method === 'DELETE') {
        await env.CINE.delete(key);
        return json({ ok: true });
      }
      return json({ error: 'metodo' }, 405);
    }

    if (url.pathname === '/api/multipart/create' && req.method === 'POST') {
      const { key, contentType } = await req.json();
      if (!key || key === 'biblioteca.json') return json({ error: 'key invalida' }, 400);
      const up = await env.CINE.createMultipartUpload(key, {
        httpMetadata: { contentType: contentType || 'video/mp4' }
      });
      return json({ uploadId: up.uploadId });
    }

    if (url.pathname === '/api/multipart/part' && req.method === 'PUT') {
      const key = url.searchParams.get('key');
      const uploadId = url.searchParams.get('uploadId');
      const part = parseInt(url.searchParams.get('part'), 10);
      if (!key || !uploadId || !(part >= 1)) return json({ error: 'parametros' }, 400);
      const up = env.CINE.resumeMultipartUpload(key, uploadId);
      try {
        const p = await up.uploadPart(part, req.body);
        return json({ etag: p.etag, part });
      } catch (e) {
        return json({ error: String(e.message || e) }, 400);
      }
    }

    if (url.pathname === '/api/multipart/complete' && req.method === 'POST') {
      const { key, uploadId, parts } = await req.json();
      const up = env.CINE.resumeMultipartUpload(key, uploadId);
      try {
        await up.complete((parts || []).map((p) => ({ partNumber: p.part, etag: p.etag })));
        return json({ ok: true, key });
      } catch (e) {
        return json({ error: String(e.message || e) }, 400);
      }
    }

    if (url.pathname === '/api/multipart/abort' && req.method === 'POST') {
      const { key, uploadId } = await req.json();
      try { await env.CINE.resumeMultipartUpload(key, uploadId).abort(); } catch (e) { /* ya no existe */ }
      return json({ ok: true });
    }

    return json({ error: 'ruta desconocida' }, 404);
  }
};
