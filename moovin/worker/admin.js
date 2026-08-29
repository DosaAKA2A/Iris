/* MOOVIN — backoffice de cuentas, pantallas y pases.
   ---------------------------------------------------------------------------
   Todo esto va detras del token de administracion que ya usaba el backoffice
   (Authorization: Bearer MOOVIN_TOKEN). No hay cuentas de admin aparte: quien
   tiene ese token ya podia reemplazar la biblioteca entera.

   El endpoint que canta el codigo de acceso de una cuenta (`/api/cuentas/codigo`)
   existe porque todavia no hay proveedor de correo. Es un puente, no el diseño:
   en cuanto haya CORREO_CLAVE, el codigo va al correo y esto se queda como
   rescate para quien no lo reciba. Se acuña de uno en uno y a peticion, en vez
   de tener una lista de codigos ajenos a la vista.
*/

import { azar, ahora, sha256, nuevoId, normalizaCorreo, correoValido, limpiaNombre } from './util.js';
import { evento } from './cuentas.js';
import { envia, hayCorreo, plantillaCodigo, plantillaAcceso } from './correo.js';

const VIDA_CODIGO = 10 * 60;

const ok = (cuerpo) => ({ estado: 200, cuerpo });
const mal = (msg, estado) => ({ estado: estado || 400, cuerpo: { error: msg } });

export async function ruta(env, req, url) {
  const p = url.pathname;
  const cuerpo = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  // ---- cuentas ------------------------------------------------------------

  if (p === '/api/cuentas' && req.method === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const filas = q
      ? await env.DB.prepare(
        `SELECT * FROM usuarios
         WHERE lower(correo) LIKE ?1 OR lower(nombre) LIKE ?1 OR lower(codigo) = ?2
         ORDER BY creado DESC LIMIT 200`
      ).bind('%' + q + '%', q).all()
      : await env.DB.prepare('SELECT * FROM usuarios ORDER BY creado DESC LIMIT 200').all();

    // Cuantas pantallas tiene emparejadas cada uno. Una sola consulta: la
    // biblioteca es de un grupo pequeño y no compensa complicar el JOIN.
    const pant = await env.DB.prepare(
      'SELECT usuario_id, COUNT(*) AS n FROM dispositivos GROUP BY usuario_id'
    ).all();
    const cuenta = {};
    for (const f of pant.results || []) cuenta[f.usuario_id] = f.n;

    return ok({
      cuentas: (filas.results || []).map((u) => ({
        id: u.id, correo: u.correo, nombre: u.nombre, codigo: u.codigo,
        avatar: u.avatar || '', rol: u.rol, estado: u.estado,
        acceso: !!u.acceso, caduca: u.acceso_caduca || null,
        creado: u.creado, visto: u.visto, pantallas: cuenta[u.id] || 0
      })),
      correo: hayCorreo(env)
    });
  }

  if (p === '/api/cuentas/nueva' && req.method === 'POST') {
    const correo = normalizaCorreo(cuerpo.correo);
    if (!correoValido(correo)) return mal('ese correo no vale');
    const ya = await env.DB.prepare('SELECT id FROM usuarios WHERE correo = ?1').bind(correo).first();
    if (ya) return mal('ya existe una cuenta con ese correo', 409);
    const t = ahora();
    const id = nuevoId();
    await env.DB.prepare(
      `INSERT INTO usuarios (id, correo, nombre, codigo, rol, estado, acceso, creado, visto)
       VALUES (?1, ?2, ?3, ?4, ?5, 'activa', ?6, ?7, 0)`
    ).bind(id, correo, limpiaNombre(cuerpo.nombre) || correo.split('@')[0].slice(0, 32),
      azar(6), cuerpo.admin ? 'admin' : 'usuario', cuerpo.acceso ? 1 : 0, t).run();
    await evento(env, 'cuenta.creada.admin', correo, cuerpo.acceso ? 'con acceso' : 'sin acceso');
    return ok({ ok: true, id });
  }

  if (p === '/api/cuentas/acceso' && req.method === 'POST') {
    const u = await usuarioDe(env, cuerpo);
    if (!u) return mal('esa cuenta no existe', 404);
    const dar = !!cuerpo.acceso;
    // `dias` es lo que se escribe en el backoffice; 0 o vacio = sin caducidad.
    const dias = parseInt(cuerpo.dias, 10);
    const caduca = dar && dias > 0 ? ahora() + dias * 86400 : null;
    await env.DB.prepare('UPDATE usuarios SET acceso = ?2, acceso_caduca = ?3 WHERE id = ?1')
      .bind(u.id, dar ? 1 : 0, caduca).run();
    await evento(env, dar ? 'acceso.dado' : 'acceso.quitado', u.correo, caduca ? dias + ' días' : '');

    // Avisar solo al dar acceso, y solo si hay correo: quitarlo no se anuncia.
    let avisado = false;
    if (dar && hayCorreo(env) && cuerpo.avisar) {
      const pl = plantillaAcceso(u.nombre);
      try {
        await envia(env, { para: u.correo, asunto: pl.asunto, html: pl.html, texto: pl.texto });
        avisado = true;
      } catch (e) { /* el acceso ya esta dado; el correo es un extra */ }
    }
    return ok({ ok: true, acceso: dar, caduca, avisado });
  }

  if (p === '/api/cuentas/estado' && req.method === 'POST') {
    const u = await usuarioDe(env, cuerpo);
    if (!u) return mal('esa cuenta no existe', 404);
    const estado = cuerpo.estado === 'bloqueada' ? 'bloqueada' : 'activa';
    await env.DB.prepare('UPDATE usuarios SET estado = ?2 WHERE id = ?1').bind(u.id, estado).run();
    // Bloquear tiene que echar de verdad: sin esto las sesiones vivas seguirian
    // renovando el token hasta que caducaran solas.
    if (estado === 'bloqueada') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM sesiones WHERE usuario_id = ?1').bind(u.id),
        env.DB.prepare('DELETE FROM dispositivos WHERE usuario_id = ?1').bind(u.id)
      ]);
    }
    await evento(env, 'cuenta.' + estado, u.correo, '');
    return ok({ ok: true, estado });
  }

  if (p === '/api/cuentas/codigo' && req.method === 'POST') {
    const u = await usuarioDe(env, cuerpo);
    const correo = u ? u.correo : normalizaCorreo(cuerpo.correo);
    if (!correoValido(correo)) return mal('ese correo no vale');
    const codigo = azar(6);
    const t = ahora();
    await env.DB.prepare(
      `INSERT INTO codigos (correo, hash, caduca, intentos, creado) VALUES (?1, ?2, ?3, 0, ?4)
       ON CONFLICT(correo) DO UPDATE SET hash = ?2, caduca = ?3, intentos = 0, creado = ?4`
    ).bind(correo, await sha256(correo + ':' + codigo), t + VIDA_CODIGO, t).run();
    let enviado = false;
    if (hayCorreo(env) && cuerpo.enviar) {
      const pl = plantillaCodigo(codigo, VIDA_CODIGO / 60);
      try {
        await envia(env, { para: correo, asunto: pl.asunto, html: pl.html, texto: pl.texto });
        enviado = true;
      } catch (e) { /* se enseña igual, que para eso se pidio */ }
    }
    await evento(env, 'codigo.admin', correo, '');
    return ok({ ok: true, codigo, correo, caduca: t + VIDA_CODIGO, enviado });
  }

  if (p === '/api/cuentas/olvidar' && req.method === 'POST') {
    const u = await usuarioDe(env, cuerpo);
    if (!u) return mal('esa cuenta no existe', 404);
    const r = await env.DB.prepare('DELETE FROM dispositivos WHERE usuario_id = ?1').bind(u.id).run();
    await evento(env, 'pantallas.olvidadas', u.correo, String(r.meta.changes || 0));
    return ok({ ok: true, n: r.meta.changes || 0 });
  }

  if (p === '/api/cuentas/borrar' && req.method === 'POST') {
    const u = await usuarioDe(env, cuerpo);
    if (!u) return mal('esa cuenta no existe', 404);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sesiones WHERE usuario_id = ?1').bind(u.id),
      env.DB.prepare('DELETE FROM dispositivos WHERE usuario_id = ?1').bind(u.id),
      env.DB.prepare('DELETE FROM codigos WHERE correo = ?1').bind(u.correo),
      env.DB.prepare('DELETE FROM usuarios WHERE id = ?1').bind(u.id)
    ]);
    await evento(env, 'cuenta.borrada', u.correo, '');
    return ok({ ok: true });
  }

  // ---- pases temporales ---------------------------------------------------

  if (p === '/api/pases' && req.method === 'GET') {
    const filas = await env.DB.prepare('SELECT * FROM pases ORDER BY creado DESC LIMIT 200').all();
    return ok({
      pases: (filas.results || []).map((x) => ({
        hash: x.hash, pista: x.pista, nota: x.nota || '', caduca: x.caduca || null,
        usos: x.usos, max_usos: x.max_usos || null, estado: x.estado, creado: x.creado
      }))
    });
  }

  if (p === '/api/pases/nuevo' && req.method === 'POST') {
    // Se enseña UNA vez y se guarda solo el hash: si se pierde, se acuña otro.
    const clave = 'MV-' + azar(4) + '-' + azar(4) + '-' + azar(4);
    const dias = parseInt(cuerpo.dias, 10);
    const max = parseInt(cuerpo.max_usos, 10);
    await env.DB.prepare(
      `INSERT INTO pases (hash, pista, nota, caduca, usos, max_usos, estado, creado)
       VALUES (?1, ?2, ?3, ?4, 0, ?5, 'activo', ?6)`
    ).bind(await sha256(clave), clave.slice(-4), String(cuerpo.nota || '').slice(0, 120) || null,
      dias > 0 ? ahora() + dias * 86400 : null, max > 0 ? max : null, ahora()).run();
    await evento(env, 'pase.acunado', null, clave.slice(-4));
    return ok({ ok: true, clave });
  }

  if (p === '/api/pases/anular' && req.method === 'POST') {
    const h = String(cuerpo.hash || '');
    const r = await env.DB.prepare("UPDATE pases SET estado = 'anulado' WHERE hash = ?1").bind(h).run();
    if (!r.meta.changes) return mal('ese pase no existe', 404);
    await evento(env, 'pase.anulado', null, '');
    return ok({ ok: true });
  }

  // ---- registro -----------------------------------------------------------

  if (p === '/api/eventos' && req.method === 'GET') {
    const filas = await env.DB.prepare('SELECT * FROM eventos ORDER BY ts DESC LIMIT 120').all();
    return ok({ eventos: filas.results || [] });
  }

  return mal('ruta desconocida', 404);
}

async function usuarioDe(env, cuerpo) {
  if (cuerpo.id) return await env.DB.prepare('SELECT * FROM usuarios WHERE id = ?1').bind(cuerpo.id).first();
  const correo = normalizaCorreo(cuerpo.correo);
  if (!correo) return null;
  return await env.DB.prepare('SELECT * FROM usuarios WHERE correo = ?1').bind(correo).first();
}
