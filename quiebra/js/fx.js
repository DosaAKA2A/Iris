/* QUIEBRA — motor de efectos. Todo lo que hace que un movimiento se sienta.
   Partículas en un solo canvas a pantalla completa, números flotantes en DOM,
   sacudidas y destellos sobre el <body>.

   Regla de rendimiento: el bucle de animación SOLO corre mientras hay partículas
   vivas. En reposo no hay rAF, ni animaciones infinitas, ni timers sueltos. */

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

let cv = null, cx = null, dpr = 1;
let particulas = [];
let corriendo = false;
let ultimo = 0;

function lienzo() {
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.className = 'fx-lienzo';
  document.body.appendChild(cv);
  cx = cv.getContext('2d');
  redimensionar();
  addEventListener('resize', redimensionar, { passive: true });
  return cv;
}

function redimensionar() {
  if (!cv) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function arrancar() {
  if (corriendo) return;
  corriendo = true;
  ultimo = performance.now();
  requestAnimationFrame(paso);
}

function paso(ahora) {
  const dt = Math.min(48, ahora - ultimo) / 1000;
  ultimo = ahora;
  cx.clearRect(0, 0, innerWidth, innerHeight);

  for (let i = particulas.length - 1; i >= 0; i--) {
    const p = particulas[i];
    p.vida -= dt;
    if (p.vida <= 0) { particulas.splice(i, 1); continue; }
    p.vx *= p.roce;
    p.vy = p.vy * p.roce + p.grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.giro += p.vgiro * dt;
    dibujar(p);
  }

  if (particulas.length) requestAnimationFrame(paso);
  else { corriendo = false; cx.clearRect(0, 0, innerWidth, innerHeight); }
}

function dibujar(p) {
  const t = p.vida / p.vidaMax;
  cx.save();
  cx.globalAlpha = Math.min(1, t * 2.2);
  cx.translate(p.x, p.y);
  cx.rotate(p.giro);

  if (p.tipo === 'moneda') {
    // Disco que se aplasta al girar: parece una moneda de canto.
    const ancho = Math.abs(Math.cos(p.giro * 2)) * p.r + p.r * 0.18;
    cx.beginPath();
    cx.ellipse(0, 0, ancho, p.r, 0, 0, Math.PI * 2);
    const grad = cx.createLinearGradient(-ancho, -p.r, ancho, p.r);
    grad.addColorStop(0, '#ffe9a0');
    grad.addColorStop(0.5, p.color);
    grad.addColorStop(1, '#a8821a');
    cx.fillStyle = grad;
    cx.fill();
  } else if (p.tipo === 'confeti') {
    const alto = p.r * Math.abs(Math.cos(p.giro * 1.6)) + 1;
    cx.fillStyle = p.color;
    cx.fillRect(-p.r * 0.45, -alto / 2, p.r * 0.9, alto);
  } else if (p.tipo === 'chispa') {
    cx.strokeStyle = p.color;
    cx.lineWidth = p.r * 0.5;
    cx.lineCap = 'round';
    cx.beginPath();
    cx.moveTo(0, 0);
    cx.lineTo(-p.vx * 0.014, -p.vy * 0.014);
    cx.stroke();
  } else if (p.tipo === 'humo') {
    cx.globalAlpha = t * 0.28;
    cx.fillStyle = p.color;
    cx.beginPath();
    cx.arc(0, 0, p.r * (2.4 - t * 1.4), 0, Math.PI * 2);
    cx.fill();
  } else {
    cx.fillStyle = p.color;
    cx.beginPath();
    cx.arc(0, 0, p.r, 0, Math.PI * 2);
    cx.fill();
  }
  cx.restore();
}

function nace(o) {
  particulas.push({
    tipo: 'punto', x: 0, y: 0, vx: 0, vy: 0, grav: 900, roce: 0.995,
    r: 4, color: '#fff', giro: 0, vgiro: 0, vida: 1, vidaMax: 1, ...o,
  });
}

/* Borra todo lo que haya en vuelo. Se llama al abrir un velo a pantalla
   completa: las partículas del tablero no tienen por qué caer sobre el
   minijuego. */
export function limpiar() {
  particulas.length = 0;
  if (cx) cx.clearRect(0, 0, innerWidth, innerHeight);
  document.querySelectorAll('.fx-flotante, .fx-vuela').forEach((e) => e.remove());
}

/* Centro de un elemento en coordenadas de pantalla. */
export function centroDe(el) {
  if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/* ------------------------------ estallidos ------------------------------ */

const PALETA = {
  oro: ['#ffe9a0', '#e8b93c', '#c99a1f'],
  dinero: ['#8dffb5', '#59d98c', '#2c9d5f'],
  peligro: ['#ffb0b0', '#ff5d5d', '#c53030'],
  violeta: ['#c4bbff', '#7b69ff', '#5044c9'],
  fiesta: ['#59d98c', '#e8b93c', '#7b69ff', '#ff5d8f', '#ff8f3f', '#f2f3f7'],
};

/**
 * Estallido de partículas desde un punto.
 * @param {{x:number,y:number}} punto
 * @param {object} o  tipo, n, color|paleta, fuerza, grav, vida, r
 */
export function estallido(punto, o = {}) {
  if (reduce.matches) return;
  lienzo();
  const {
    tipo = 'chispa', n = 18, paleta = 'oro', fuerza = 320,
    grav = 900, vida = 0.9, r = 4, cono = Math.PI * 2, angulo = -Math.PI / 2,
  } = o;
  const colores = Array.isArray(paleta) ? paleta : PALETA[paleta] || PALETA.oro;
  for (let i = 0; i < n; i++) {
    const a = angulo + (Math.random() - 0.5) * cono;
    const v = fuerza * (0.45 + Math.random() * 0.75);
    const vd = vida * (0.7 + Math.random() * 0.6);
    nace({
      tipo,
      x: punto.x + (Math.random() - 0.5) * 10,
      y: punto.y + (Math.random() - 0.5) * 10,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      grav, roce: tipo === 'humo' ? 0.94 : 0.992,
      r: r * (0.6 + Math.random() * 0.8),
      color: colores[(Math.random() * colores.length) | 0],
      giro: Math.random() * Math.PI * 2,
      vgiro: (Math.random() - 0.5) * 14,
      vida: vd, vidaMax: vd,
    });
  }
  arrancar();
}

/** Lluvia de monedas cayendo sobre un punto (cobro grande). */
export function lluviaMonedas(punto, n = 14) {
  if (reduce.matches) return;
  lienzo();
  for (let i = 0; i < n; i++) {
    const vd = 1.1 + Math.random() * 0.5;
    nace({
      tipo: 'moneda',
      x: punto.x + (Math.random() - 0.5) * 140,
      y: punto.y - 60 - Math.random() * 160,
      vx: (Math.random() - 0.5) * 90,
      vy: 40 + Math.random() * 120,
      grav: 1100, roce: 0.999,
      r: 7 + Math.random() * 4,
      color: '#e8b93c',
      giro: Math.random() * 6, vgiro: 5 + Math.random() * 8,
      vida: vd, vidaMax: vd,
    });
  }
  arrancar();
}

/** Confeti desde arriba, para el final de la partida. */
export function confeti(n = 120) {
  if (reduce.matches) return;
  lienzo();
  for (let i = 0; i < n; i++) {
    const vd = 2.4 + Math.random() * 2;
    nace({
      tipo: 'confeti',
      x: Math.random() * innerWidth,
      y: -20 - Math.random() * innerHeight * 0.5,
      vx: (Math.random() - 0.5) * 120,
      vy: 90 + Math.random() * 160,
      grav: 120, roce: 0.998,
      r: 8 + Math.random() * 7,
      color: PALETA.fiesta[(Math.random() * PALETA.fiesta.length) | 0],
      giro: Math.random() * 6, vgiro: (Math.random() - 0.5) * 10,
      vida: vd, vidaMax: vd,
    });
  }
  arrancar();
}

/* ------------------------------ números flotantes ------------------------------ */

/**
 * Número que sube y se desvanece sobre un elemento o punto.
 * @param {Element|{x,y}} donde
 * @param {string} texto
 * @param {'sube'|'baja'|'neutro'} tipo
 */
export function flotante(donde, texto, tipo = 'neutro') {
  const p = donde instanceof Element ? centroDe(donde) : donde;
  const el = document.createElement('span');
  el.className = 'fx-flotante fx-flotante--' + tipo;
  el.textContent = texto;
  el.style.left = p.x + 'px';
  el.style.top = p.y + 'px';
  el.style.setProperty('--desvio', ((Math.random() - 0.5) * 40).toFixed(1) + 'px');
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 2200);
  return el;
}

/* ------------------------------ pantalla ------------------------------ */

let sacudidaHasta = 0;

/** Sacude la pantalla. fuerza 1 = golpecito, 3 = catástrofe. */
export function sacudir(fuerza = 1) {
  if (reduce.matches) return;
  const ms = 220 + fuerza * 90;
  document.body.style.setProperty('--sacudida', (fuerza * 4).toFixed(1) + 'px');
  document.body.classList.remove('fx-sacude');
  void document.body.offsetWidth;            // reinicia la animación
  document.body.classList.add('fx-sacude');
  sacudidaHasta = performance.now() + ms;
  setTimeout(() => {
    if (performance.now() >= sacudidaHasta - 20) document.body.classList.remove('fx-sacude');
  }, ms);
}

/** Destello de color sobre toda la pantalla. */
export function destello(color = 'rgba(255,255,255,.35)', ms = 420) {
  if (reduce.matches) return;
  const d = document.createElement('div');
  d.className = 'fx-destello';
  d.style.background = color;
  d.style.animationDuration = ms + 'ms';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), ms + 60);
}

/* Viñeta de color en los bordes: tensión sin tapar el tablero. */
export function vineta(color, ms = 900) {
  if (reduce.matches) return;
  const d = document.createElement('div');
  d.className = 'fx-vineta';
  d.style.setProperty('--v', color);
  d.style.animationDuration = ms + 'ms';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), ms + 60);
}

/* ------------------------------ contadores ------------------------------ */

const contando = new WeakMap();

/**
 * Lleva el texto de un elemento de un número a otro, contando.
 * Cancela cualquier conteo anterior del mismo elemento.
 */
export function contar(el, desde, hasta, ms = 700, formato = (v) => '$' + v) {
  if (!el) return;
  const previo = contando.get(el);
  if (previo) cancelAnimationFrame(previo);
  if (reduce.matches || desde === hasta) { el.textContent = formato(hasta); return; }
  const t0 = performance.now();
  const tic = (ahora) => {
    const k = Math.min(1, (ahora - t0) / ms);
    const suave = 1 - Math.pow(1 - k, 3);
    el.textContent = formato(Math.round(desde + (hasta - desde) * suave));
    if (k < 1) contando.set(el, requestAnimationFrame(tic));
    else contando.delete(el);
  };
  contando.set(el, requestAnimationFrame(tic));
}

/* ------------------------------ realces ------------------------------ */

/** Aplica una clase de animación y la quita al terminar (repetible). */
export function pulsa(el, clase = 'fx-pulso', ms = 600) {
  if (!el || reduce.matches) return;
  el.classList.remove(clase);
  void el.offsetWidth;
  el.classList.add(clase);
  setTimeout(() => el.classList.remove(clase), ms);
}

/** Estela de un punto a otro: dinero que cambia de manos. */
export function transferencia(desde, hasta, color = '#59d98c', n = 8) {
  if (reduce.matches) return;
  const a = desde instanceof Element ? centroDe(desde) : desde;
  const b = hasta instanceof Element ? centroDe(hasta) : hasta;
  for (let i = 0; i < n; i++) {
    const el = document.createElement('span');
    el.className = 'fx-vuela';
    el.style.setProperty('--x0', a.x + 'px');
    el.style.setProperty('--y0', a.y + 'px');
    el.style.setProperty('--x1', b.x + 'px');
    el.style.setProperty('--y1', b.y + 'px');
    el.style.setProperty('--arco', ((Math.random() - 0.5) * 120).toFixed(0) + 'px');
    el.style.background = color;
    el.style.animationDelay = (i * 45) + 'ms';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900 + i * 45);
  }
}
