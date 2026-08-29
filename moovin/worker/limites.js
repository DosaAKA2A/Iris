/* MOOVIN — rate limit.
   ---------------------------------------------------------------------------
   Contadores por ventana fija en D1. Se usa D1 y no el binding de rate limit
   del worker porque ese binding cuenta POR CENTRO DE DATOS: alguien repartido
   entre veinte colos consigue veinte veces el limite. Para pedir codigos de
   acceso y para emparejar televisores eso no sirve.

   El cubo va en la propia clave (clave:ventana), asi que no hay que reiniciar
   nada: cuando cambia la ventana, cambia la fila. Las viejas las barre el cron.
*/

import { ahora } from './util.js';

export async function limite(env, clave, max, ventanaSeg) {
  const t = ahora();
  const cubo = Math.floor(t / ventanaSeg);
  const fila = await env.DB.prepare(
    `INSERT INTO limites (clave, cuenta, ventana) VALUES (?1, 1, ?2)
     ON CONFLICT(clave) DO UPDATE SET cuenta = cuenta + 1
     RETURNING cuenta`
  ).bind(clave + ':' + cubo, (cubo + 1) * ventanaSeg).first();
  const n = fila?.cuenta ?? 1;
  return { ok: n <= max, cuenta: n, esperaSeg: (cubo + 1) * ventanaSeg - t };
}

// Aplica varios limites a la vez y devuelve el primero que salte.
export async function limites(env, reglas) {
  for (const [clave, max, ventana] of reglas) {
    const r = await limite(env, clave, max, ventana);
    if (!r.ok) return r;
  }
  return null;
}

export const ip = (req) => req.headers.get('CF-Connecting-IP') || 'sin-ip';

export async function barreVencidos(env) {
  const t = ahora();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM limites  WHERE ventana < ?1').bind(t),
    env.DB.prepare('DELETE FROM codigos  WHERE caduca  < ?1').bind(t),
    env.DB.prepare('DELETE FROM sesiones WHERE caduca  < ?1').bind(t),
    env.DB.prepare('DELETE FROM vinculos WHERE caduca  < ?1').bind(t),
    env.DB.prepare('DELETE FROM eventos  WHERE ts < ?1').bind(t - 180 * 86400)
  ]);
}
