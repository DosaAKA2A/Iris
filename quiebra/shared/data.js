/* QUIEBRA — datos compartidos entre cliente y servidor.
   Única fuente de verdad del tablero, cartas, personajes y economía.
   La importan el worker (esbuild la empaqueta) y el frontend (módulo ES). */

export const CONFIG = {
  START_CASH: 1000,
  SALIDA_PAGO: 200,
  BACHE_MULTA: 75,
  IMPUESTO_PCT: 0.10,
  IMPUESTO_MIN: 50,
  REFORMA_PCT: 0.60,        // costo de la reforma sobre el precio del negocio
  REFORMA_RENTA: 2.5,       // multiplicador de renta con reforma
  BARRIO_RENTA: 2,          // multiplicador con barrio completo
  LIQUIDACION_PCT: 0.5,     // lo que devuelve vender en la quiebra
  MANO_MAX: 3,
  RONDAS: [8, 10, 14],
  RONDAS_DEF: 10,
  TURNO_MS: 45000,          // anti-AFK por decisión
  MINI_PREMIOS: [150, 75, 25, 0],
  TROFEO_VALOR: 100,        // valor de cada trofeo en el patrimonio final
};

export const BARRIOS = {
  cobre:   { nombre: 'COBRE',   color: '#c98a5e' },
  jade:    { nombre: 'JADE',    color: '#3fb950' },
  violeta: { nombre: 'VIOLETA', color: '#7b69ff' },
  oro:     { nombre: 'ORO',     color: '#e8b93c' },
};

/* 24 casillas, anillo. renta = base; con barrio completo ×2; con reforma ×2.5 */
export const CASILLAS = [
  { t: 'salida',    nombre: 'SALIDA' },
  { t: 'negocio',   nombre: 'Puesto de Empanadas', barrio: 'cobre',   precio: 120, renta: 30 },
  { t: 'azar',      nombre: 'AZAR' },
  { t: 'negocio',   nombre: 'Lavandería 24h',      barrio: 'cobre',   precio: 140, renta: 35 },
  { t: 'mini',      nombre: 'MINIJUEGO' },
  { t: 'negocio',   nombre: 'Cíber Renacer',       barrio: 'cobre',   precio: 160, renta: 40 },
  { t: 'siesta',    nombre: 'SIESTA' },
  { t: 'negocio',   nombre: 'Gimnasio Momentum',   barrio: 'jade',    precio: 200, renta: 50 },
  { t: 'azar',      nombre: 'AZAR' },
  { t: 'negocio',   nombre: 'Barbería El Filo',    barrio: 'jade',    precio: 220, renta: 55 },
  { t: 'bache',     nombre: 'EL BACHE' },
  { t: 'negocio',   nombre: 'Cafetería Ojeras',    barrio: 'jade',    precio: 240, renta: 60 },
  { t: 'bote',      nombre: 'EL BOTE' },
  { t: 'negocio',   nombre: 'Sushi Neón',          barrio: 'violeta', precio: 280, renta: 70 },
  { t: 'mini',      nombre: 'MINIJUEGO' },
  { t: 'negocio',   nombre: 'Arcade Vórtice',      barrio: 'violeta', precio: 300, renta: 75 },
  { t: 'azar',      nombre: 'AZAR' },
  { t: 'negocio',   nombre: 'Rooftop Malbec',      barrio: 'violeta', precio: 320, renta: 80 },
  { t: 'mudanza',   nombre: 'MUDANZA' },
  { t: 'negocio',   nombre: 'Torre Espejo',        barrio: 'oro',     precio: 360, renta: 90 },
  { t: 'impuestos', nombre: 'IMPUESTOS' },
  { t: 'negocio',   nombre: 'Casino Lunar',        barrio: 'oro',     precio: 400, renta: 100 },
  { t: 'mini',      nombre: 'MINIJUEGO' },
  { t: 'negocio',   nombre: 'Heliopuerto',         barrio: 'oro',     precio: 440, renta: 110 },
];

export const PERSONAJES = {
  rata:    { nombre: 'RATA',    apodo: 'La Codiciosa', color: '#ff5d8f',
             desc: 'Cobra $280 en vez de $200 al pasar por SALIDA.' },
  pulpo:   { nombre: 'PULPO',   apodo: 'El Manitas',   color: '#7b69ff',
             desc: 'Negocios y reformas 15% más baratos.' },
  cabra:   { nombre: 'CABRA',   apodo: 'La Cabezona',  color: '#3fb950',
             desc: 'Premios de minijuego +50% y gana los empates.' },
  polilla: { nombre: 'POLILLA', apodo: 'La Ladrona',   color: '#ff8f3f',
             desc: 'Roba $40 al caer sobre un rival y a veces saca carta doble.' },
};

/* Cartas. inst=true se resuelve al momento; el resto va a la mano (máx 3). */
export const CARTAS = {
  propina:   { nombre: 'PROPINA',                desc: 'Te llevas $120 al instante.', inst: true, peso: 3 },
  multa:     { nombre: 'MULTA',                  desc: 'Pagas $80 al instante.', inst: true, peso: 3 },
  cumple:    { nombre: 'CUMPLEAÑOS',             desc: 'Cada rival te da $40.', inst: true, peso: 2 },
  apagon:    { nombre: 'APAGÓN',                 desc: 'Te vas derecho a SIESTA.', inst: true, peso: 2 },
  dado:      { nombre: 'DADO TRUCADO',           desc: 'Eliges el resultado de tu tirada (2–12).', peso: 3 },
  mudanzaf:  { nombre: 'MUDANZA FORZOSA',        desc: 'Mandas a un rival a EL BACHE.', peso: 3, target: true },
  congelado: { nombre: 'ALQUILER CONGELADO',     desc: 'Nadie te cobra renta durante una ronda.', peso: 2 },
  imprev:    { nombre: 'IMPUESTO REVOLUCIONARIO', desc: 'Robas el 15% del efectivo del más rico.', peso: 2 },
  okupa:     { nombre: 'OKUPA',                  desc: 'La próxima renta de un negocio rival te la llevas tú.', peso: 2, target: 'prop' },
  seguro:    { nombre: 'SEGURO',                 desc: 'Anula la próxima carta que te ataque.', peso: 3 },
};

export const MINIJUEGOS = {
  clics:    { nombre: 'DUELO DE CLICS', dur: 5000,
              desc: 'Cliquea el botón tantas veces como puedas en 5 segundos.' },
  semaforo: { nombre: 'SEMÁFORO', dur: 9000,
              desc: 'Espera el verde y cliquea. Si te adelantas, quedas fuera.' },
  memoria:  { nombre: 'MEMORIA', dur: 22000,
              desc: 'Mira la secuencia de 6 luces y repítela sin fallar.' },
  monedas:  { nombre: 'CAZAMONEDAS', dur: 10000,
              desc: 'Caza todas las monedas que puedas en 10 segundos.' },
};

/* RNG determinista (mulberry32) — misma semilla, misma partida en los 4 clientes. */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rentaDe(g, idx) {
  const c = CASILLAS[idx];
  if (!c || c.t !== 'negocio') return 0;
  const p = g.props[idx];
  if (!p || !p.owner) return 0;
  let r = c.renta;
  const setCompleto = CASILLAS.every((cc, i) =>
    cc.t !== 'negocio' || cc.barrio !== c.barrio || (g.props[i] && g.props[i].owner === p.owner));
  if (setCompleto) r *= CONFIG.BARRIO_RENTA;
  if (p.reforma) r *= CONFIG.REFORMA_RENTA;
  return Math.round(r);
}

/* Patrimonio final: efectivo + lo pagado en negocios y reformas + trofeos. */
export function patrimonio(g, pid) {
  const pl = g.players.find((p) => p.id === pid);
  if (!pl) return 0;
  let total = pl.cash + pl.trophies * CONFIG.TROFEO_VALOR;
  for (const [idx, p] of Object.entries(g.props)) {
    if (p.owner !== pid) continue;
    const c = CASILLAS[idx];
    const desc = pl.char === 'pulpo' ? 0.85 : 1;
    total += Math.round(c.precio * desc);
    if (p.reforma) total += Math.round(c.precio * CONFIG.REFORMA_PCT * desc);
  }
  return total;
}
