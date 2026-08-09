/* QUIEBRA — sonido. Muestras reales (Kenney, CC0) mezcladas con WebAudio.
   Se despierta con el primer gesto del usuario (política de autoplay).
   Si una muestra no carga, cae en un tono sintetizado para no quedarse mudo.

   Créditos: kenney.nl — "Casino Audio", "Interface Sounds", "Impact Sounds",
   "Music Jingles". Dominio público (CC0 1.0). */

const BASE = new URL('../assets/sfx/', import.meta.url).href;

/* muestra -> [archivo, volumen, variación de tono] */
const MUESTRAS = {
  clic:        ['clic', 0.55, 0.06],
  selec:       ['selec', 0.6, 0.05],
  bien:        ['bien', 0.6, 0.02],
  mal:         ['mal', 0.55, 0.03],
  tic:         ['tic', 0.4, 0.1],
  turno:       ['turno', 0.5, 0],
  abre:        ['abre', 0.5, 0.03],
  cierra:      ['cierra', 0.45, 0.03],
  dadoAgita:   ['dado-agita', 0.7, 0.08],
  dadoTira:    ['dado-tira', 0.75, 0.06],
  dadoCae:     ['dado-cae', 0.6, 0.12],
  ficha:       ['ficha', 0.5, 0.14],
  cobro:       ['cobro', 0.7, 0.05],
  pago:        ['pago', 0.6, 0.06],
  compra:      ['compra', 0.75, 0.04],
  cartaRoba:   ['carta-roba', 0.7, 0.08],
  cartaJuega:  ['carta-juega', 0.7, 0.06],
  baraja:      ['baraja', 0.6, 0.02],
  golpe:       ['golpe', 0.7, 0.08],
  vidrio:      ['vidrio', 0.65, 0.04],
  jingleGana:  ['jingle-gana', 0.8, 0],
  jinglePierde:['jingle-pierde', 0.8, 0],
  jingleMini:  ['jingle-mini', 0.7, 0],
};

let ctx = null;
let maestro = null;
let listo = false;
const buffers = new Map();
const cargando = new Map();

let activo = localStorage.getItem('quiebra:mudo') !== '1';
let volumen = Number(localStorage.getItem('quiebra:vol') ?? 0.85);

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    maestro = ctx.createGain();
    maestro.gain.value = activo ? volumen : 0;
    maestro.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

async function cargar(nombre) {
  if (buffers.has(nombre)) return buffers.get(nombre);
  if (cargando.has(nombre)) return cargando.get(nombre);
  const a = ac();
  if (!a) return null;
  const [archivo] = MUESTRAS[nombre];
  const p = fetch(BASE + archivo + '.ogg')
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404'))))
    .then((buf) => a.decodeAudioData(buf))
    .then((dec) => { buffers.set(nombre, dec); return dec; })
    .catch(() => { buffers.set(nombre, null); return null; });
  cargando.set(nombre, p);
  return p;
}

/* Reproduce una muestra. cuando = retardo en segundos. */
function sonar(nombre, { vol = 1, tono = 1, cuando = 0 } = {}) {
  if (!activo) return;
  const a = ac();
  if (!a) return;
  const def = MUESTRAS[nombre];
  if (!def) return;
  const [, volBase, variacion] = def;
  const buf = buffers.get(nombre);
  if (buf === undefined) {
    // Aún no está decodificada: cárgala y suéltala al llegar, salvo que tarde
    // tanto que ya no venga a cuento (medio segundo tarde es peor que nada).
    const pedida = performance.now();
    cargar(nombre).then((b) => {
      if (b && performance.now() - pedida < 500) sonar(nombre, { vol, tono, cuando });
    });
    return;
  }
  if (!buf) return sintetico(nombre);
  const src = a.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = tono * (1 + (Math.random() * 2 - 1) * variacion);
  const g = a.createGain();
  g.gain.value = volBase * vol;
  src.connect(g).connect(maestro);
  src.start(a.currentTime + cuando);
}

/* Red de seguridad: si la muestra falla, un tono simple para que haya respuesta. */
function sintetico(nombre) {
  const a = ac();
  if (!a) return;
  const F = {
    clic: 660, selec: 780, bien: 880, mal: 200, tic: 990, turno: 520,
    abre: 700, cierra: 420, dadoAgita: 300, dadoTira: 260, dadoCae: 220,
    ficha: 520, cobro: 1000, pago: 320, compra: 900, cartaRoba: 620,
    cartaJuega: 540, baraja: 400, golpe: 140, vidrio: 1400,
    jingleGana: 880, jinglePierde: 260, jingleMini: 700,
  };
  const f = F[nombre] || 500;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = f < 300 ? 'sawtooth' : 'triangle';
  o.frequency.setValueAtTime(f, a.currentTime);
  g.gain.setValueAtTime(0, a.currentTime);
  g.gain.linearRampToValueAtTime(0.12, a.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.16);
  o.connect(g).connect(maestro);
  o.start(); o.stop(a.currentTime + 0.2);
}

/* Notas puras para la melodía de MEMORIA y los remates. */
function nota(freq, dur = 0.22, tipo = 'triangle', vol = 0.16, cuando = 0) {
  if (!activo) return;
  const a = ac();
  if (!a) return;
  const t = a.currentTime + cuando;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = tipo;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(maestro);
  o.start(t); o.stop(t + dur + 0.05);
}

const ESCALA = [523.25, 659.25, 783.99, 1046.5];   // do mi sol do

export const S = {
  /* --------- control --------- */
  despertar() {
    ac();
    if (listo) return;
    listo = true;
    // Precarga por tandas: primero lo inmediato, el resto en cuanto haya hueco.
    const urgentes = ['clic', 'selec', 'dadoAgita', 'dadoTira', 'dadoCae', 'ficha', 'cobro', 'pago'];
    urgentes.forEach(cargar);
    const resto = Object.keys(MUESTRAS).filter((k) => !urgentes.includes(k));
    const luego = () => resto.forEach(cargar);
    'requestIdleCallback' in window ? requestIdleCallback(luego, { timeout: 3000 }) : setTimeout(luego, 1200);
  },
  get mudo() { return !activo; },
  toggle(v) {
    activo = v === undefined ? !activo : !!v;
    localStorage.setItem('quiebra:mudo', activo ? '0' : '1');
    if (maestro) maestro.gain.value = activo ? volumen : 0;
    if (activo) { ac(); sonar('selec'); }
    return activo;
  },
  volumen(v) {
    volumen = Math.min(1, Math.max(0, v));
    localStorage.setItem('quiebra:vol', String(volumen));
    if (maestro && activo) maestro.gain.value = volumen;
  },

  /* --------- interfaz --------- */
  clic() { sonar('clic'); },
  selec() { sonar('selec'); },
  bien() { sonar('bien'); },
  mal() { sonar('mal'); },
  tic() { sonar('tic'); },
  abre() { sonar('abre'); },
  cierra() { sonar('cierra'); },
  turno() { sonar('turno'); nota(659.25, 0.18, 'triangle', 0.1, 0.06); },

  /* --------- mesa --------- */
  dadoAgita() { sonar('dadoAgita'); },
  dadoTira() { sonar('dadoTira'); },
  dadoCae(n = 2) { for (let i = 0; i < n; i++) sonar('dadoCae', { cuando: i * 0.09, vol: 0.9 - i * 0.15 }); },
  /* compatible con el nombre viejo */
  dado() { sonar('dadoTira'); },
  ficha() { sonar('ficha', { vol: 0.8 }); },
  cobro() { sonar('cobro'); },
  pago() { sonar('pago'); },
  compra() { sonar('compra'); nota(880, 0.18, 'triangle', 0.09, 0.05); },
  moneda() { sonar('cobro', { vol: 0.5, tono: 1.35 }); },
  dinero() { sonar('cobro'); },

  /* --------- cartas --------- */
  cartaRoba() { sonar('cartaRoba'); },
  cartaJuega() { sonar('cartaJuega'); },
  carta() { sonar('cartaJuega'); },
  baraja() { sonar('baraja'); },

  /* --------- golpes y remates --------- */
  golpe() { sonar('golpe'); },
  quiebra() { sonar('vidrio'); sonar('golpe', { cuando: 0.06, vol: 0.8 }); sonar('jinglePierde', { cuando: 0.2 }); },
  gana() { sonar('jingleGana'); },
  pierde() { sonar('jinglePierde'); },
  fanfarria() { sonar('jingleGana'); },
  mini() { sonar('jingleMini'); },

  /* --------- ayudas para los minijuegos --------- */
  /* 3, 2, 1 secos; 0 es el "¡YA!" */
  cuenta(n) {
    if (n > 0) { sonar('tic', { tono: 1 + (3 - n) * 0.12 }); nota(392 + (3 - n) * 60, 0.12, 'square', 0.07); }
    else { sonar('bien'); nota(1046.5, 0.3, 'square', 0.12); }
  },
  /* nota de la escala, para pads y combos */
  nota(i, vol = 0.16) { nota(ESCALA[i % ESCALA.length] * (1 + Math.floor(i / ESCALA.length) * 0.5), 0.26, 'triangle', vol); },
  /* combo ascendente */
  combo(n) { nota(440 * Math.pow(1.122, Math.min(n, 12)), 0.16, 'square', 0.1); },
};
