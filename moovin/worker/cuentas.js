/* MOOVIN — cuentas, sesiones, televisores emparejados y pases temporales.
   ---------------------------------------------------------------------------
   Se entra SOLO con el correo. Se pide un codigo de 6 caracteres, llega al
   correo, se escribe y listo: eso crea la cuenta y la verifica en el mismo
   paso, asi que no existe el estado "registrado pero sin confirmar" ni el flujo
   de "olvide mi contrasena". Tampoco hay hash de contrasena que calcular, que
   en Workers seria PBKDF2 y se comeria el CPU del plan gratis.

   Crear la cuenta NO da acceso a la biblioteca. El acceso es un campo de la
   cuenta que enciende Dosa desde el backoffice: quien se registra queda "en
   espera" y la pagina se lo dice tal cual. Aqui no se vende nada, asi que no
   hay licencias que activar ni pedidos que aprobar.

   El televisor es el otro caso: no tiene cuenta ni teclado decente. Se empareja
   con el QR del mando desde un movil que ya entro, y a partir de ahi entra solo
   con una clave de dispositivo. El emparejamiento va por AQUI y no por el relay
   del Watch Party a proposito: el relay es un difusor tonto y todo el que este
   en la sala ve todos los mensajes, asi que una credencial no puede viajar por
   ahi.
*/

import {
  azar, ahora, sha256, igual, nuevoId,
  normalizaCorreo, correoValido, limpiaNombre
} from './util.js';
import { limites, ip } from './limites.js';
import { envia, hayCorreo, plantillaCodigo } from './correo.js';

const VIDA_CODIGO = 10 * 60;         // 10 minutos
const INTENTOS_CODIGO = 5;
const VIDA_SESION = 180 * 24 * 3600; // 6 meses: entrar cuesta un correo, no se pide cada mes
const MAX_SESIONES = 5;              // por cuenta; la sexta echa a la mas vieja
const VIDA_VINCULO = 10 * 60;        // el QR de la tele dura lo que dura en pantalla

// ---- codigo de acceso -----------------------------------------------------

export async function pideCodigo(env, req, cuerpo) {
  const correo = normalizaCorreo(cuerpo.correo);
  if (!correoValido(correo)) return { estado: 400, cuerpo: { error: 'ese correo no vale' } };

  const tope = await limites(env, [
    ['cod:correo:' + correo, 3, 3600],
    ['cod:ip:' + ip(req), 10, 3600],
    ['cod:ip:dia:' + ip(req), 30, 86400]
  ]);
  // La respuesta es la misma pase lo que pase: si dijeramos "ese correo no
  // existe" o "vas muy rapido", habriamos hecho un buscador de cuentas.
  if (tope) return { estado: 200, cuerpo: { ok: true, correo: hayCorreo(env) } };

  const codigo = azar(6);
  const t = ahora();
  await env.DB.prepare(
    `INSERT INTO codigos (correo, hash, caduca, intentos, creado) VALUES (?1, ?2, ?3, 0, ?4)
     ON CONFLICT(correo) DO UPDATE SET hash = ?2, caduca = ?3, intentos = 0, creado = ?4`
  ).bind(correo, await sha256(correo + ':' + codigo), t + VIDA_CODIGO, t).run();

  if (!hayCorreo(env)) {
    // Sin proveedor de correo el codigo existe igual y se recoge desde el
    // backoffice. Se dice claro en vez de fingir un envio que no ocurre.
    await evento(env, 'codigo.sin_correo', correo, '');
    return { estado: 200, cuerpo: { ok: true, correo: false } };
  }
  const p = plantillaCodigo(codigo, VIDA_CODIGO / 60);
  await envia(env, { para: correo, asunto: p.asunto, html: p.html, texto: p.texto });
  return { estado: 200, cuerpo: { ok: true, correo: true } };
}

export async function verificaCodigo(env, req, cuerpo) {
  const correo = normalizaCorreo(cuerpo.correo);
  const codigo = String(cuerpo.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!correoValido(correo) || codigo.length !== 6) {
    return { estado: 400, cuerpo: { error: 'faltan datos' } };
  }

  const tope = await limites(env, [['ver:ip:' + ip(req), 20, 3600]]);
  if (tope) return { estado: 429, cuerpo: { error: 'demasiados intentos, espera un rato' } };

  const fila = await env.DB.prepare('SELECT * FROM codigos WHERE correo = ?1').bind(correo).first();
  const malo = { estado: 401, cuerpo: { error: 'código incorrecto o vencido' } };
  if (!fila || fila.caduca < ahora()) return malo;

  if (fila.intentos >= INTENTOS_CODIGO) {
    await env.DB.prepare('DELETE FROM codigos WHERE correo = ?1').bind(correo).run();
    return malo;
  }
  if (!igual(fila.hash, await sha256(correo + ':' + codigo))) {
    await env.DB.prepare('UPDATE codigos SET intentos = intentos + 1 WHERE correo = ?1').bind(correo).run();
    return malo;
  }

  // Acertado: el codigo se quema aunque despues falle algo.
  await env.DB.prepare('DELETE FROM codigos WHERE correo = ?1').bind(correo).run();

  const usuario = await dameOCreaUsuario(env, correo, cuerpo.nombre);
  if (usuario.estado === 'bloqueada') {
    return { estado: 403, cuerpo: { error: 'esta cuenta está bloqueada' } };
  }

  const ses = await abreSesion(env, req, usuario.id);
  return {
    estado: 200,
    cuerpo: { token: ses.token, exp: ses.caduca, usuario: perfil(usuario) }
  };
}

// ---- usuarios -------------------------------------------------------------

async function dameOCreaUsuario(env, correo, nombrePedido) {
  const ya = await env.DB.prepare('SELECT * FROM usuarios WHERE correo = ?1').bind(correo).first();
  if (ya) {
    await env.DB.prepare('UPDATE usuarios SET visto = ?2 WHERE id = ?1').bind(ya.id, ahora()).run();
    return ya;
  }
  const nombre = limpiaNombre(nombrePedido) || correo.split('@')[0].slice(0, 32);
  const t = ahora();
  // El codigo de usuario son 6 caracteres de 32: chocan de vez en cuando y
  // reintentar es mas barato que llevar un contador global.
  for (let i = 0; i < 6; i++) {
    const id = nuevoId();
    try {
      await env.DB.prepare(
        `INSERT INTO usuarios (id, correo, nombre, codigo, rol, estado, acceso, creado, visto)
         VALUES (?1, ?2, ?3, ?4, 'usuario', 'activa', 0, ?5, ?5)`
      ).bind(id, correo, nombre, azar(6), t).run();
      await evento(env, 'cuenta.creada', correo, nombre);
      return await env.DB.prepare('SELECT * FROM usuarios WHERE id = ?1').bind(id).first();
    } catch (e) {
      if (!String(e.message).includes('UNIQUE')) throw e;
      const otra = await env.DB.prepare('SELECT * FROM usuarios WHERE correo = ?1').bind(correo).first();
      if (otra) return otra; // dos pestanas pidiendo a la vez
    }
  }
  throw new Error('no se pudo crear la cuenta');
}

// ¿Esta cuenta puede ver la biblioteca ahora mismo?
export function tieneAcceso(u) {
  if (!u || u.estado === 'bloqueada' || !u.acceso) return false;
  return !u.acceso_caduca || u.acceso_caduca > ahora();
}

export function perfil(u) {
  return {
    correo: u.correo,
    nombre: u.nombre,
    codigo: u.codigo,
    avatar: u.avatar || '',
    admin: u.rol === 'admin',
    acceso: tieneAcceso(u),
    caduca: u.acceso_caduca || null
  };
}

export async function cambiaPerfil(env, usuarioId, cuerpo) {
  const campos = [];
  const vals = [usuarioId];
  if (cuerpo.nombre !== undefined) {
    const limpio = limpiaNombre(cuerpo.nombre);
    if (!limpio) return { estado: 400, cuerpo: { error: 'el nombre no puede estar vacío' } };
    campos.push('nombre = ?' + (vals.length + 1)); vals.push(limpio);
  }
  if (cuerpo.avatar !== undefined) {
    // El avatar es un nombre del elenco o una clave del bucket. Se limpia a
    // caracteres de ruta para que no se pueda colar una URL de fuera.
    const av = String(cuerpo.avatar || '').slice(0, 80).replace(/[^A-Za-z0-9._/-]/g, '');
    campos.push('avatar = ?' + (vals.length + 1)); vals.push(av);
  }
  if (!campos.length) return { estado: 400, cuerpo: { error: 'nada que cambiar' } };
  await env.DB.prepare('UPDATE usuarios SET ' + campos.join(', ') + ' WHERE id = ?1').bind(...vals).run();
  const u = await env.DB.prepare('SELECT * FROM usuarios WHERE id = ?1').bind(usuarioId).first();
  return { estado: 200, cuerpo: perfil(u) };
}

// ---- sesiones -------------------------------------------------------------

async function abreSesion(env, req, usuarioId) {
  const token = azar(10) + '.' + azar(32);
  const t = ahora();
  const caduca = t + VIDA_SESION;
  await env.DB.prepare(
    `INSERT INTO sesiones (hash, usuario_id, creada, vista, caduca, ua, pais)
     VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6)`
  ).bind(
    await sha256(token), usuarioId, t, caduca,
    (req.headers.get('User-Agent') || '').slice(0, 180),
    req.headers.get('CF-IPCountry') || null
  ).run();

  // Tope de sesiones vivas por cuenta: la mas vieja cae sola. No limita
  // equipos (se puede entrar desde donde sea), limita cuantos a la vez.
  await env.DB.prepare(
    `DELETE FROM sesiones WHERE usuario_id = ?1 AND hash NOT IN (
       SELECT hash FROM sesiones WHERE usuario_id = ?1 ORDER BY vista DESC LIMIT ?2)`
  ).bind(usuarioId, MAX_SESIONES).run();

  return { token, caduca };
}

/* Solo Authorization: Bearer. Nada de cookies: la pagina vive en moovin.live y
   el worker en otro dominio, asi que la cookie tendria que ser SameSite=None y
   no aporta nada frente al Bearer que ya se usa para el pase. */
function bearerDe(req) {
  const auth = (req.headers.get('Authorization') || '').trim();
  return /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '') : '';
}

export async function sesionDe(env, req, tokenSuelto) {
  const token = tokenSuelto || bearerDe(req);
  if (!token) return null;

  const fila = await env.DB.prepare(
    `SELECT s.hash AS s_hash, s.vista AS s_vista, s.caduca AS s_caduca, u.*
     FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.hash = ?1`
  ).bind(await sha256(token)).first();
  if (!fila || fila.s_caduca < ahora() || fila.estado === 'bloqueada') return null;

  // Renovar en cada peticion seria una escritura por request. Se toca la
  // sesion como mucho una vez por hora.
  if (ahora() - (fila.s_vista || 0) > 3600) {
    await env.DB.prepare('UPDATE sesiones SET vista = ?2, caduca = ?3 WHERE hash = ?1')
      .bind(fila.s_hash, ahora(), ahora() + VIDA_SESION).run();
  }
  return fila;
}

export async function cierraSesion(env, req) {
  const token = bearerDe(req);
  if (token) await env.DB.prepare('DELETE FROM sesiones WHERE hash = ?1').bind(await sha256(token)).run();
  return { estado: 200, cuerpo: { ok: true } };
}

// ---- televisores emparejados ----------------------------------------------
//
// La tele pide un codigo, se queda un secreto que no sale de ella (el QR solo
// lleva el codigo) y pregunta cada dos segundos. El movil, ya con su cuenta,
// confirma. Solo entonces se acuna la clave del dispositivo, y solo la recoge
// quien enseñe el secreto.

export async function vinculoNuevo(env, req) {
  const tope = await limites(env, [['vin:ip:' + ip(req), 30, 3600]]);
  if (tope) return { estado: 429, cuerpo: { error: 'demasiados emparejamientos, espera un rato' } };

  const secreto = azar(32);
  const t = ahora();
  for (let i = 0; i < 8; i++) {
    const codigo = azar(6);
    try {
      await env.DB.prepare(
        'INSERT INTO vinculos (codigo, secreto_hash, creado, caduca) VALUES (?1, ?2, ?3, ?4)'
      ).bind(codigo, await sha256(secreto), t, t + VIDA_VINCULO).run();
      return { estado: 200, cuerpo: { codigo, secreto, caduca: t + VIDA_VINCULO } };
    } catch (e) {
      if (!String(e.message).includes('UNIQUE')) throw e;
      // Colision con un codigo vivo: si ya vencio, se recicla.
      await env.DB.prepare('DELETE FROM vinculos WHERE codigo = ?1 AND caduca < ?2').bind(codigo, t).run();
    }
  }
  return { estado: 503, cuerpo: { error: 'no se pudo abrir el emparejamiento' } };
}

/* Lo que ve el movil al abrir /mando/<CODIGO>: si ese codigo esta esperando a
   que alguien le de acceso a una pantalla. No dice de quien es ni nada mas. */
export async function vinculoMira(env, codigo) {
  const c = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (c.length !== 6) return { estado: 400, cuerpo: { error: 'código inválido' } };
  const v = await env.DB.prepare('SELECT * FROM vinculos WHERE codigo = ?1').bind(c).first();
  if (!v || v.caduca < ahora()) return { estado: 200, cuerpo: { existe: false } };
  return { estado: 200, cuerpo: { existe: true, dado: !!v.usuario_id } };
}

export async function vinculoConfirma(env, req, usuario, cuerpo) {
  if (!tieneAcceso(usuario)) {
    return { estado: 403, cuerpo: { error: 'tu cuenta todavía no tiene acceso a la biblioteca' } };
  }
  const c = String(cuerpo.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (c.length !== 6) return { estado: 400, cuerpo: { error: 'código inválido' } };

  const tope = await limites(env, [['vinc:cuenta:' + usuario.id, 20, 3600]]);
  if (tope) return { estado: 429, cuerpo: { error: 'demasiados intentos, espera un rato' } };

  const t = ahora();
  const v = await env.DB.prepare('SELECT * FROM vinculos WHERE codigo = ?1').bind(c).first();
  if (!v || v.caduca < t) return { estado: 404, cuerpo: { error: 'ese código ya no vale' } };
  if (v.usuario_id) return { estado: 409, cuerpo: { error: 'esa pantalla ya tiene acceso' } };

  const clave = azar(12) + '.' + azar(32);
  // El WHERE usuario_id IS NULL es la carrera: si dos moviles confirman a la
  // vez, solo uno escribe la entrega y el otro ve changes = 0.
  const r = await env.DB.prepare(
    'UPDATE vinculos SET usuario_id = ?2, entrega = ?3 WHERE codigo = ?1 AND usuario_id IS NULL'
  ).bind(c, usuario.id, clave).run();
  if (!r.meta.changes) return { estado: 409, cuerpo: { error: 'esa pantalla ya tiene acceso' } };

  await evento(env, 'pantalla.vinculada', usuario.correo, c);
  return { estado: 200, cuerpo: { ok: true } };
}

/* La tele pregunta si ya le dieron acceso. Va con el secreto, no con el codigo:
   el codigo lo ve cualquiera que mire la pantalla. */
export async function vinculoEstado(env, req, cuerpo) {
  const c = String(cuerpo.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const secreto = String(cuerpo.secreto || '');
  if (c.length !== 6 || !secreto) return { estado: 400, cuerpo: { error: 'faltan datos' } };

  const v = await env.DB.prepare('SELECT * FROM vinculos WHERE codigo = ?1').bind(c).first();
  if (!v || v.caduca < ahora()) return { estado: 200, cuerpo: { listo: false, vivo: false } };
  if (!igual(v.secreto_hash, await sha256(secreto))) {
    return { estado: 200, cuerpo: { listo: false, vivo: false } };
  }
  if (!v.usuario_id || !v.entrega) return { estado: 200, cuerpo: { listo: false, vivo: true } };

  // Se recoge una sola vez: se crea el dispositivo y el vinculo desaparece.
  const u = await env.DB.prepare('SELECT * FROM usuarios WHERE id = ?1').bind(v.usuario_id).first();
  if (!tieneAcceso(u)) {
    await env.DB.prepare('DELETE FROM vinculos WHERE codigo = ?1').bind(c).run();
    return { estado: 200, cuerpo: { listo: false, vivo: false } };
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO dispositivos (hash, usuario_id, nombre, creado, visto, ua)
       VALUES (?1, ?2, ?3, ?4, ?4, ?5)`
    ).bind(await sha256(v.entrega), u.id, 'Pantalla', ahora(),
      (req.headers.get('User-Agent') || '').slice(0, 180)),
    env.DB.prepare('DELETE FROM vinculos WHERE codigo = ?1').bind(c)
  ]);
  return { estado: 200, cuerpo: { listo: true, clave: v.entrega, usuario: perfil(u) } };
}

/* La tele cambia su clave de dispositivo por el token firmado de siempre, el
   mismo que da el pase. Asi el porton del worker no cambia y las URLs de
   /media siguen funcionando igual. */
export async function dispositivoDe(env, clave) {
  if (!clave) return null;
  const d = await env.DB.prepare(
    `SELECT d.hash AS d_hash, d.visto AS d_visto, u.*
     FROM dispositivos d JOIN usuarios u ON u.id = d.usuario_id WHERE d.hash = ?1`
  ).bind(await sha256(clave)).first();
  if (!d || !tieneAcceso(d)) return null;
  if (ahora() - (d.d_visto || 0) > 3600) {
    await env.DB.prepare('UPDATE dispositivos SET visto = ?2 WHERE hash = ?1')
      .bind(d.d_hash, ahora()).run();
  }
  return d;
}

/* La pantalla se da de baja a si misma. No hace falta sesion: tener la clave
   ES ser esa pantalla, igual que en /entrar-dispositivo. Quien mande la orden
   por el relay no lleva la clave, asi que el peor caso de un codigo de sala
   adivinado es dejar una tele fuera; no se le entrega nada a nadie.

   El token firmado que ya tenga sigue valiendo hasta que caduque -es la vida
   del token, no de la clave-, por eso la tele ademas se lo tira ella. */
export async function dispositivoBaja(env, clave) {
  if (!clave) return { estado: 400, cuerpo: { error: 'falta la clave' } };
  const h = await sha256(clave);
  const d = await env.DB.prepare('SELECT usuario_id FROM dispositivos WHERE hash = ?1')
    .bind(h).first();
  if (!d) return { estado: 200, cuerpo: { ok: true } };   // ya no estaba
  await env.DB.prepare('DELETE FROM dispositivos WHERE hash = ?1').bind(h).run();
  await evento(env, 'pantalla.desvinculada', d.usuario_id, '');
  return { estado: 200, cuerpo: { ok: true } };
}

// ---- pases temporales -----------------------------------------------------
//
// Para quien no tiene cuenta. El pase compartido de siempre (MOOVIN_PASE) sigue
// siendo un secreto del worker y no pasa por aqui.

export async function paseTemporalOk(env, clave) {
  const c = String(clave || '').trim();
  if (c.length < 6) return false;
  const p = await env.DB.prepare("SELECT * FROM pases WHERE hash = ?1 AND estado = 'activo'")
    .bind(await sha256(c)).first();
  if (!p) return false;
  if (p.caduca && p.caduca < ahora()) return false;
  if (p.max_usos != null && p.usos >= p.max_usos) return false;
  await env.DB.prepare('UPDATE pases SET usos = usos + 1 WHERE hash = ?1').bind(p.hash).run();
  return true;
}

// ---- eventos --------------------------------------------------------------

export async function evento(env, tipo, quien, detalle) {
  try {
    await env.DB.prepare('INSERT INTO eventos (ts, tipo, quien, detalle) VALUES (?1, ?2, ?3, ?4)')
      .bind(ahora(), tipo, quien || null, String(detalle || '').slice(0, 200)).run();
  } catch (e) { /* un evento perdido no puede tumbar la peticion */ }
}
