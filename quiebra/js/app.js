/* QUIEBRA — cliente. Pinta el estado que manda el servidor y pide acciones.
   Nada de lógica de juego aquí: dados, rentas y rankings los decide el worker.

   Lo que sí vive aquí es la puesta en escena. El servidor manda el resultado
   de golpe (dados + posición + dinero); el cliente lo reparte en el tiempo:
   primero ruedan los dados, después el peón salta casilla a casilla, y solo
   cuando llega se revelan las cartas y se mueve el dinero. Para eso los avisos
   de efecto (fx) se guardan en un buzón y se consumen en una cola de animación
   cuando llega el estado que los acompaña. */

import { CONFIG, CASILLAS, BARRIOS, PERSONAJES, CARTAS, MINIJUEGOS } from '../shared/data.js';
import { cara, peon, ICONOS } from './personajes.js';
import { ico } from './iconos.js';
import { jugarMini } from './minijuegos.js';
import { S } from './sonido.js';
import * as FX from './fx.js';

/* ------------------------------ servidor ------------------------------ */

const PROD = 'quiebra.studio-iris2026.workers.dev';
function servidor() {
  const p = new URLSearchParams(location.search).get('srv');
  if (p) return p;
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return '127.0.0.1:8787';
  return PROD;
}
const esLocal = () => !servidor().includes('workers.dev');
const httpBase = () => (esLocal() ? 'http://' : 'https://') + servidor();
const wsBase = () => (esLocal() ? 'ws://' : 'wss://') + servidor();

/* ------------------------------ estado local ------------------------------ */

let ws = null;
let g = null;            // último estado del servidor
let yo = null;           // mi pid
let sala = null;         // código
let reintento = null;
let cerreYo = false;

let miniLimpiar = null;  // cleanup del minijuego en curso
let miniSeed = null;
let podioHasta = 0;
let eligiendo = null;    // {carta} flujo de elección de objetivo
let ultimoSeqLog = 0;
let turnoAnunciado = '';

const posVisual = {};    // pid -> casilla donde está DIBUJADO el peón
const cashMostrado = {}; // pid -> dinero que se está enseñando ahora mismo
let fxBuzon = [];        // efectos a la espera del estado que los explica
let cola = Promise.resolve();
let escena = 0;          // >0 mientras hay coreografía en marcha

const $ = (id) => document.getElementById(id);

let escenaDesde = 0;
/* Espera de puesta en escena. Se salta entera si la pestaña está en segundo
   plano (Chrome estrangula los setTimeout y la partida se quedaría colgada)
   o si la escena ya se alargó demasiado: más vale ir al grano que perder el
   turno mirando una animación. */
const esperar = (ms) => (
  document.hidden || (escenaDesde && performance.now() - escenaDesde > 9000)
    ? Promise.resolve()
    : new Promise((r) => setTimeout(r, ms))
);
function encolar(fn) { cola = cola.then(fn).catch(() => { /* que un fallo no atasque la cola */ }); }

const FRASES = {
  jaja: 'JAJAJA', paga: 'Págame.', dolio: 'Eso dolió.', lona: 'Te veo en la lona.',
  mercado: 'Perdón, es el mercado.', ni: 'Ni se te ocurra.',
};

/* ------------------------------ arranque ------------------------------ */

document.addEventListener('DOMContentLoaded', () => {
  const nombreGuardado = localStorage.getItem('quiebra:nombre');
  if (nombreGuardado) $('in-nombre').value = nombreGuardado;
  const url = new URLSearchParams(location.search);
  if (url.get('sala')) $('in-codigo').value = url.get('sala').toUpperCase();

  $('bt-crear').addEventListener('click', crearSala);
  $('bt-entrar').addEventListener('click', () => entrar($('in-codigo').value));
  $('in-codigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar($('in-codigo').value); });
  $('in-nombre').addEventListener('keydown', (e) => { if (e.key === 'Enter') crearSala(); });
  $('bt-copiar').addEventListener('click', copiarEnlace);
  $('bt-empezar').addEventListener('click', () => { S.clic(); enviar({ t: 'start' }); });
  $('sel-rondas').addEventListener('change', (e) => enviar({ t: 'config', rounds: Number(e.target.value) }));
  document.body.addEventListener('pointerdown', () => S.despertar(), { once: true });

  pintarBotonSonido();
  $('bt-sonido').addEventListener('click', () => { S.toggle(); pintarBotonSonido(); });

  construirTablero();
  construirFrases();
  construirElenco();

  // Reconexión directa: si ya tienes token de esta sala, entras sin pasar por el botón.
  const cod = (url.get('sala') || '').toUpperCase();
  if (/^[A-Z]{4}$/.test(cod)) {
    const disc = url.get('tok');
    if (localStorage.getItem('quiebra:token:' + cod + (disc ? ':' + disc : ''))) {
      sala = cod;
      conectar();
    }
  }
});

/* Gancho de depuración/pruebas: enviar mensajes crudos y leer el estado. */
window.QUIEBRA = { enviar: (o) => enviar(o), estado: () => g, quien: () => yo, fx: FX };

function pintarBotonSonido() {
  const b = $('bt-sonido');
  b.innerHTML = S.mudo ? ICONOS.mudo : ICONOS.sonido;
  b.setAttribute('aria-label', S.mudo ? 'Activar sonido' : 'Silenciar');
  b.title = b.getAttribute('aria-label');
}

function miNombre() {
  const n = $('in-nombre').value.trim().slice(0, 14);
  if (n) localStorage.setItem('quiebra:nombre', n);
  return n;
}

async function crearSala() {
  const n = miNombre();
  if (!n) return errPortada('Ponte un nombre primero.');
  S.clic();
  try {
    const r = await fetch(httpBase() + '/new');
    const j = await r.json();
    entrar(j.sala);
  } catch {
    S.mal();
    errPortada('No se pudo crear la sala. ¿Sin conexión?');
  }
}

function entrar(codigo) {
  const n = miNombre();
  if (!n) return errPortada('Ponte un nombre primero.');
  codigo = String(codigo || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (codigo.length !== 4) return errPortada('El código tiene 4 letras.');
  S.clic();
  sala = codigo;
  conectar();
}

function errPortada(msg) { $('portada-err').textContent = msg; }

/* ------------------------------ websocket ------------------------------ */

function token() {
  // ?tok=algo separa jugadores dentro de un mismo navegador (pruebas, 2 en 1 PC)
  const disc = new URLSearchParams(location.search).get('tok');
  const k = 'quiebra:token:' + sala + (disc ? ':' + disc : '');
  let t = localStorage.getItem(k);
  if (!t) {
    t = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(k, t);
  }
  return t;
}

function conectar() {
  clearTimeout(reintento);
  cerreYo = false;
  try { ws && ws.close(); } catch { /* nada */ }
  ws = new WebSocket(wsBase() + '/ws?sala=' + sala);
  ws.onopen = () => enviar({ t: 'join', sala, name: miNombre() || 'anon', token: token() });
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'state') { yo = m.you; recibirEstado(m.g); }
    else if (m.t === 'fx') recibirFx(m);
    else if (m.t === 'err') { errPortada(m.msg); brindar(m.msg); }
  };
  ws.onclose = () => {
    if (cerreYo) return;
    if (g && g.phase !== 'lobby' && g.phase !== 'end') {
      brindar('Conexión perdida. Reintentando…');
      reintento = setTimeout(conectar, 2000);
    }
  };
}

function enviar(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

/* ------------------------------ pantallas ------------------------------ */

function pantalla(id) {
  for (const s of ['scr-portada', 'scr-sala', 'scr-juego']) $(s).classList.toggle('oculta', s !== id);
}

function recibirEstado(nuevo) {
  const primeraVez = !g;
  g = nuevo;
  const qs = new URLSearchParams(location.search);
  qs.set('sala', sala);
  history.replaceState(null, '', '?' + qs.toString());

  if (g.phase === 'lobby') { pantalla('scr-sala'); pintarSala(); return; }

  pantalla('scr-juego');

  // Al entrar (o reconectar) no hay nada que animar: se coloca todo tal cual.
  if (primeraVez || Object.keys(posVisual).length === 0) {
    for (const p of g.players) { posVisual[p.id] = p.pos; cashMostrado[p.id] = p.cash; }
  }

  const fxs = fxBuzon;
  fxBuzon = [];

  // Si hay algo que representar, el panel de acciones espera: enseñar
  // "¿comprar tal negocio?" mientras el peón sigue saltando destripa el final.
  const hayEscena = fxs.some((f) => f.kind === 'dice') ||
    g.players.some((p) => posVisual[p.id] !== undefined && posVisual[p.id] !== p.pos);
  if (hayEscena) escena++;

  pintarJuego();

  encolar(async () => {
    try {
      await representar(fxs);
    } finally {
      if (hayEscena) {
        escena = Math.max(0, escena - 1);
        if (escena === 0) { pintarAcciones(); pintarMano(); }
      }
    }
  });
}

/* La coreografía: dados, movimiento, dinero, cartas y remates, en ese orden. */
async function representar(fxs) {
  escenaDesde = performance.now();
  try {
    await escenificar(fxs);
  } finally {
    escenaDesde = 0;
  }
}

async function escenificar(fxs) {
  const dados = fxs.find((f) => f.kind === 'dice');
  if (dados) await tirarDados(dados.dice);

  await caminarPeones();
  aplicarDeltas();

  for (const f of fxs) {
    if (f.kind === 'dice') continue;
    await efecto(f);
  }

  // El aviso de "te toca" va al final: primero se ve terminar al anterior.
  if (g.phase === 'turn') {
    const clave = `${g.round}:${g.turnIdx}`;
    if (esMiTurno() && clave !== turnoAnunciado) {
      turnoAnunciado = clave;
      await anunciarMiTurno();
    }
  }

  if (g.phase === 'mini' && g.mini && g.mini.seed !== miniSeed) {
    miniSeed = g.mini.seed;
    abrirMini();
  }
  if (g.phase !== 'mini' && Date.now() > podioHasta) cerrarMini();
  if (g.phase === 'end') pintarFinal();
}

/* ------------------------------ sala de espera ------------------------------ */

function pintarSala() {
  $('sala-codigo').textContent = g.code;
  const cont = $('sala-jugadores');
  cont.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = g.players[i];
    if (!p) {
      cont.insertAdjacentHTML('beforeend', `<div class="asiento asiento--libre">Asiento libre</div>`);
      continue;
    }
    const esHost = p.id === g.hostId;
    cont.insertAdjacentHTML('beforeend', `
      <div class="asiento ${esHost ? 'asiento--host' : ''}">
        ${p.char ? cara(p.char, 'asiento__cara') : '<svg class="asiento__cara" viewBox="0 0 64 64"><circle cx="32" cy="34" r="22" fill="#232838"/><text x="32" y="41" text-anchor="middle" font-size="20" fill="#8b90a3">?</text></svg>'}
        <span class="asiento__nombre">${escapa(p.name)}${p.id === yo ? ' (tú)' : ''}</span>
        <span class="asiento__estado">${esHost ? 'ANFITRIÓN' : p.char ? 'LISTO' : 'ELIGIENDO'}</span>
      </div>`);
  }

  const fichas = $('sala-fichas');
  fichas.innerHTML = '';
  for (const [id, c] of Object.entries(PERSONAJES)) {
    const quien = g.players.find((p) => p.char === id);
    const mia = quien && quien.id === yo;
    const tomada = quien && !mia;
    fichas.insertAdjacentHTML('beforeend', `
      <button class="ficha ${mia ? 'ficha--mia' : ''} ${tomada ? 'ficha--tomada' : ''}" data-char="${id}" style="--pc:${c.color}" ${tomada ? 'disabled' : ''}>
        ${cara(id, 'ficha__cara')}
        <span class="ficha__nombre" style="color:${c.color}">${c.nombre}</span>
        <span class="ficha__apodo">${c.apodo}</span>
        <span class="ficha__desc">${c.desc}</span>
        ${quien ? `<span class="ficha__quien">${mia ? 'Eres tú' : escapa(quien.name)}</span>` : ''}
      </button>`);
  }
  fichas.querySelectorAll('.ficha').forEach((b) =>
    b.addEventListener('click', () => { S.selec(); enviar({ t: 'pick', char: b.dataset.char }); }));

  const soyHost = g.hostId === yo;
  $('sala-rondas-wrap').style.display = soyHost ? '' : 'none';
  $('sel-rondas').value = String(g.maxRounds);
  const listos = g.players.length >= 2 && g.players.every((p) => p.char);
  $('bt-empezar').classList.toggle('oculta', !soyHost);
  $('bt-empezar').disabled = !listos;
  $('sala-nota').textContent = soyHost
    ? (listos ? 'Todo listo. Dale a Empezar.' : g.players.length < 2 ? 'Comparte el enlace: faltan jugadores.' : 'Falta que todos elijan personaje.')
    : `Rondas: ${g.maxRounds}. El anfitrión da la salida.`;
}

/* Los cuatro personajes en la portada: enseña qué se está eligiendo antes
   de entrar y le quita el vacío a la pantalla de inicio. */
function construirElenco() {
  const cont = $('portada-elenco');
  if (!cont) return;
  cont.innerHTML = Object.entries(PERSONAJES).map(([id, c]) => `
    <div class="elenco__ficha" style="--pc:${c.color}">
      ${cara(id, 'elenco__cara')}
      <p class="elenco__nombre">${c.nombre}</p>
      <p class="elenco__apodo">${c.apodo}</p>
      <p class="elenco__desc">${c.desc}</p>
    </div>`).join('');
}

function copiarEnlace() {
  const url = location.origin + location.pathname + '?sala=' + sala;
  S.clic();
  navigator.clipboard?.writeText(url).then(() => brindar('Enlace copiado. Mándaselo a tus amigos.'))
    .catch(() => brindar(url));
}

/* ------------------------------ tablero ------------------------------ */

function idxACelda(i) {
  if (i === 0) return [6, 6];
  if (i <= 5) return [6, 6 - i];
  if (i === 6) return [6, 0];
  if (i <= 11) return [6 - (i - 6), 0];
  if (i === 12) return [0, 0];
  if (i <= 17) return [0, i - 12];
  if (i === 18) return [0, 6];
  return [i - 18, 6];
}

const ICONO_CASILLA = {
  salida: 'salida', mini: 'mini', azar: 'azar', bache: 'bache',
  impuestos: 'impuestos', bote: 'bote', siesta: 'siesta', mudanza: 'mudanza',
};

/* Cada negocio tiene su dibujo. Va por índice de casilla porque el icono es
   cosa del cliente: `shared/data.js` la comparte el worker y no le interesa. */
const ICONO_NEGOCIO = {
  1: 'empanadas', 3: 'lavanderia', 5: 'ciber',
  7: 'gimnasio', 9: 'barberia', 11: 'cafeteria',
  13: 'sushi', 15: 'arcade', 17: 'rooftop',
  19: 'torre', 21: 'casino', 23: 'helipuerto',
};

/* De qué lado del tablero cuelga la casilla: manda hacia dónde mira la cinta
   de color (siempre al centro de la mesa, como en un tablero de verdad). */
function ladoDe(fila, col) {
  if (fila === 6) return 'abajo';
  if (fila === 0) return 'arriba';
  if (col === 0) return 'izq';
  return 'der';
}

function construirTablero() {
  const t = $('tablero');
  t.innerHTML = '';
  CASILLAS.forEach((c, i) => {
    const [fila, col] = idxACelda(i);
    const esquina = [0, 6, 12, 18].includes(i);
    const clases = ['casilla', 'casilla--' + ladoDe(fila, col)];
    if (esquina) clases.push('casilla--esquina', 'casilla--' + c.t);
    else if (c.t === 'negocio') clases.push('casilla--negocio');
    else clases.push('casilla--especial', 'casilla--' + c.t);
    const div = document.createElement('div');
    div.className = clases.join(' ');
    div.id = 'cas-' + i;
    div.style.gridArea = `${fila + 1} / ${col + 1}`;
    if (c.barrio) div.style.setProperty('--neon', BARRIOS[c.barrio].color);
    const icono = ICONO_NEGOCIO[i] || ICONO_CASILLA[c.t];
    div.innerHTML = `
      <span class="casilla__cinta"></span>
      ${icono ? ico(icono, 'casilla__icono') : ''}
      <span class="casilla__nombre">${c.nombre}</span>
      ${c.precio ? `<span class="casilla__precio">$${c.precio}</span>` : ''}
      <span class="casilla__extras"></span>`;
    div.addEventListener('click', () => clicCasilla(i));
    t.appendChild(div);
  });
}

const firmaCasilla = {};   // evita repintar (y reanimar) casillas que no cambiaron

function pintarTablero() {
  CASILLAS.forEach((c, i) => {
    const div = $('cas-' + i);
    const prop = g.props[i];
    const dueno = prop && prop.owner ? g.players.find((p) => p.id === prop.owner) : null;
    const color = dueno ? PERSONAJES[dueno.char]?.color || '#888' : '';
    const firma = `${dueno ? dueno.id : ''}|${prop?.reforma ? 1 : 0}|${prop?.okupa ? 1 : 0}`;

    if (firmaCasilla[i] !== firma) {
      firmaCasilla[i] = firma;
      const extras = div.querySelector('.casilla__extras');
      extras.innerHTML = '';
      div.classList.toggle('casilla--propia', !!dueno);
      if (color) div.style.setProperty('--pcolor', color);
      else div.style.removeProperty('--pcolor');
      if (dueno) {
        extras.insertAdjacentHTML('beforeend', `<span class="casilla__dueno"></span>`);
        if (prop.reforma) extras.insertAdjacentHTML('beforeend', ico('reforma', 'casilla__reforma'));
        if (prop.okupa) extras.insertAdjacentHTML('beforeend', ico('okupa', 'casilla__okupa'));
      }
    }
    div.classList.toggle('casilla--activa', esCasillaElegible(i));
  });
}

function esCasillaElegible(i) {
  if (!esMiTurno()) return false;
  const c = CASILLAS[i];
  if (eligiendo && eligiendo.carta === 'okupa') {
    const p = g.props[i];
    return !!(p && p.owner && p.owner !== yo);
  }
  if (eligiendo) return false;
  if (g.turn?.awaiting === 'mudanza') {
    if (c.t !== 'negocio') return false;
    const p = g.props[i];
    return !p || !p.owner || p.owner === yo;
  }
  if (g.turn?.awaiting === 'fin') return esCasillaElegibleReforma(i);
  return false;
}

function clicCasilla(i) {
  if (!esCasillaElegible(i)) return;
  S.selec();
  if (eligiendo && eligiendo.carta === 'okupa') {
    enviar({ t: 'card', id: 'okupa', target: i });
    eligiendo = null;
    pintarAcciones();
    return;
  }
  if (g.turn?.awaiting === 'mudanza') { enviar({ t: 'mudanza', tile: i }); return; }
  if (g.turn?.awaiting === 'fin') enviar({ t: 'reforma', tile: i });
}

/* ------------------------------ peones ------------------------------ */

function elPeon(p) {
  let el = $('peon-' + p.id);
  if (!el) {
    el = document.createElement('div');
    el.id = 'peon-' + p.id;
    el.className = 'peon';
    el.style.setProperty('--pcolor', PERSONAJES[p.char]?.color || '#888');
    el.innerHTML = peon(p.char, PERSONAJES[p.char]?.color || '#888');
    $('peones').appendChild(el);
  }
  return el;
}

/* Coloca un peón según posVisual. Se mide la casilla real en vez de calcular
   la retícula a mano: así el peón sigue cuadrado aunque cambien las pistas.
   Los peones caminan por el carril exterior para no taparle el nombre ni el
   dibujo a la casilla, y se reparten a lo largo del lado si comparten sitio. */
function colocarPeon(p, lento = false) {
  const el = elPeon(p);
  const cas = $('cas-' + posVisual[p.id]);
  if (!cas) return;
  const [fila, col] = idxACelda(posVisual[p.id]);
  const lado = ladoDe(fila, col);
  const vertical = lado === 'izq' || lado === 'der';

  // El carril es el relleno que la casilla deja libre en su borde exterior.
  // Se lee del estilo ya calculado para que nunca se desfase con el CSS.
  const est = getComputedStyle(cas);
  let x = cas.offsetLeft + cas.offsetWidth / 2;
  let y = cas.offsetTop + cas.offsetHeight / 2;
  if (lado === 'abajo') y = cas.offsetTop + cas.offsetHeight - parseFloat(est.paddingBottom) / 2;
  else if (lado === 'arriba') y = cas.offsetTop + parseFloat(est.paddingTop) / 2;
  else if (lado === 'izq') x = cas.offsetLeft + parseFloat(est.paddingLeft) / 2;
  else x = cas.offsetLeft + cas.offsetWidth - parseFloat(est.paddingRight) / 2;

  const juntos = g.players.filter((q) => posVisual[q.id] === posVisual[p.id] && !q.lona);
  if (juntos.length > 1) {
    const k = juntos.findIndex((q) => q.id === p.id);
    const largo = vertical ? cas.offsetHeight : cas.offsetWidth;
    const paso = Math.min(20, largo / (juntos.length + 0.6));
    const desvio = (k - (juntos.length - 1) / 2) * paso;
    if (vertical) y += desvio; else x += desvio;
  }

  el.classList.toggle('peon--lento', lento);
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.display = p.lona ? 'none' : '';
  el.classList.toggle('peon--turno', g.phase === 'turn' && actual()?.id === p.id);
}

function pintarPeones() {
  for (const p of g.players) colocarPeon(p);
}

/* Lleva cada peón desde donde está dibujado hasta donde dice el servidor.
   Hasta 12 pasos (una tirada) se recorren saltando; más que eso es un
   teletransporte (mudanza, apagón) y se resuelve con un planeo. */
async function caminarPeones() {
  for (const p of g.players) {
    if (posVisual[p.id] === undefined) posVisual[p.id] = p.pos;
    if (p.lona) { posVisual[p.id] = p.pos; colocarPeon(p); continue; }

    const de = posVisual[p.id];
    const a = p.pos;
    if (de === a) continue;
    const pasos = (a - de + 24) % 24;
    const el = elPeon(p);

    if (pasos >= 1 && pasos <= 12) {
      for (let i = 1; i <= pasos; i++) {
        posVisual[p.id] = (de + i) % 24;
        colocarPeon(p);
        FX.pulsa(el, 'peon--salta', 180);
        S.ficha();
        if (posVisual[p.id] === 0 && i < pasos) destelloSalida();
        await esperar(150);
      }
    } else {
      posVisual[p.id] = a;
      colocarPeon(p, true);
      await esperar(560);
      el.classList.remove('peon--lento');
    }
    await aterrizar(p);
  }
  // Los que no se movieron pueden haber cambiado de turno o de apilamiento.
  pintarPeones();
}

function destelloSalida() {
  const cas = $('cas-0');
  FX.pulsa(cas, 'casilla--brilla', 700);
  FX.estallido(FX.centroDe(cas), { tipo: 'moneda', n: 6, paleta: 'oro', fuerza: 240, r: 5 });
}

async function aterrizar(p) {
  const el = elPeon(p);
  FX.pulsa(el, 'peon--llega', 440);
  const cas = $('cas-' + p.pos);
  FX.pulsa(cas, 'casilla--brilla', 700);
  const c = CASILLAS[p.pos];
  const punto = FX.centroDe(cas);
  FX.estallido(punto, { tipo: 'humo', n: 7, paleta: ['#6b7390'], fuerza: 110, grav: -60, vida: .5, r: 7 });

  if (c.t === 'bache') { S.golpe(); FX.sacudir(2); FX.vineta('rgba(255,93,93,.45)'); }
  else if (c.t === 'bote') FX.estallido(punto, { tipo: 'moneda', n: 14, paleta: 'oro', fuerza: 340, r: 6 });
  else if (c.t === 'mini') FX.estallido(punto, { tipo: 'chispa', n: 20, paleta: 'violeta', fuerza: 300 });
  await esperar(230);
}

/* ------------------------------ dados ------------------------------ */

/* Qué giro deja cada cara mirando al jugador. */
const ORIENTA = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
const PUNTOS = {
  1: ['p-c'],
  2: ['p-si', 'p-id'],
  3: ['p-si', 'p-c', 'p-id'],
  4: ['p-si', 'p-sd', 'p-ii', 'p-id'],
  5: ['p-si', 'p-sd', 'p-c', 'p-ii', 'p-id'],
  6: ['p-si', 'p-sd', 'p-mi', 'p-md', 'p-ii', 'p-id'],
};

function caraDado(v) {
  return `<div class="dado__cara dado__cara--${v}">${PUNTOS[v].map((p) => `<span class="dado__punto ${p}"></span>`).join('')}</div>`;
}

function nuevoDado(trucado) {
  const d = document.createElement('div');
  d.className = 'dado' + (trucado ? ' dado--trucado' : '');
  d.innerHTML = [1, 2, 3, 4, 5, 6].map(caraDado).join('');
  return d;
}

/* Los dados salen despedidos, dan varias vueltas y caen en su cara. */
async function tirarDados(valores) {
  const caja = $('mesa-dados');
  caja.innerHTML = '';
  const trucado = !!(g.turn && g.turn.trick);
  const dados = valores.map(() => {
    const d = nuevoDado(trucado);
    caja.appendChild(d);
    return d;
  });

  S.dadoAgita();
  await esperar(260);
  S.dadoTira();

  dados.forEach((d, i) => {
    const [rx, ry] = ORIENTA[valores[i]] || [0, 0];
    const vueltasX = 720 + Math.floor(Math.random() * 3) * 360;
    const vueltasY = 720 + Math.floor(Math.random() * 3) * 360;
    d.style.transition = 'none';
    d.style.transform = `rotateX(${rx - vueltasX}deg) rotateY(${ry - vueltasY}deg)`;
    void d.offsetWidth;
    d.style.transition = '';
    d.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    d.classList.add('dado--salta');
  });

  await esperar(900);
  S.dadoCae(valores.length);
  const suma = valores.reduce((a, b) => a + b, 0);
  const sp = document.createElement('span');
  sp.className = 'dados__suma';
  sp.textContent = suma;
  caja.appendChild(sp);
  if (suma === 12 || valores[0] === valores[1]) {
    FX.estallido(FX.centroDe(caja), { tipo: 'chispa', n: 16, paleta: 'oro', fuerza: 260 });
  }
  await esperar(320);
}

/* ------------------------------ juego ------------------------------ */

function jugador(pid) { return g.players.find((p) => p.id === pid); }
function actual() { return g.players[g.turnIdx]; }
function esMiTurno() { return g.phase === 'turn' && actual()?.id === yo; }
function precioPara(pl, precio) { return Math.round(precio * (pl.char === 'pulpo' ? 0.85 : 1)); }

function pintarJuego() {
  pintarTablero();
  pintarPanelistas();
  pintarAcciones();
  pintarMano();
  pintarRegistro();
  pintarMesa();
  pintarPeones();
}

function anunciarMiTurno() {
  const p = jugador(yo);
  banda('TU TURNO', 'mueve ficha', PERSONAJES[p?.char]?.color || 'var(--billete)');
  S.turno();
  return esperar(650);
}

function banda(texto, sub, color) {
  const cont = document.createElement('div');
  cont.className = 'banda';
  cont.style.setProperty('--pcolor', color);
  cont.innerHTML = `<div class="banda__cinta"><p class="banda__texto">${texto}</p><p class="banda__sub">${sub}</p></div>`;
  document.body.appendChild(cont);
  setTimeout(() => cont.remove(), 1600);
}

function pintarMesa() {
  $('mesa-ronda').textContent = g.phase === 'end' ? 'FIN' : `RONDA ${g.round} / ${g.maxRounds}`;
  const bote = $('mesa-bote');
  bote.innerHTML = g.bote > 0 ? `${ico('bote')}<span>$${g.bote}</span>` : '';
  if (!g.turn?.dice) $('mesa-dados').innerHTML = '';
  const quien = actual();
  $('mesa-aviso').textContent =
    g.phase === 'mini' ? 'MINIJUEGO EN CURSO' :
    g.phase === 'turn' && quien ? (quien.id === yo ? 'Tu turno' : `Turno de ${quien.name}`) : '';
}

/* ------------------------------ panelistas ------------------------------ */

function pintarPanelistas() {
  const cont = $('panelistas');
  for (const p of g.players) {
    let el = $('panelista-' + p.id);
    if (!el) {
      el = document.createElement('div');
      el.id = 'panelista-' + p.id;
      el.innerHTML = `
        ${cara(p.char, 'panelista__cara')}
        <div>
          <p class="panelista__nombre"></p>
          <p class="panelista__detalle"></p>
        </div>
        <p class="panelista__cash"></p>`;
      cont.appendChild(el);
      if (cashMostrado[p.id] === undefined) cashMostrado[p.id] = p.cash;
    }
    const props = Object.values(g.props).filter((x) => x.owner === p.id).length;
    const nCartas = p.id === yo ? p.cards.length : p.cards;
    el.className = [
      'panelista',
      g.phase === 'turn' && actual()?.id === p.id ? 'panelista--turno' : '',
      p.lona ? 'panelista--lona' : '',
      !p.online ? 'panelista--off' : '',
    ].filter(Boolean).join(' ');
    el.style.setProperty('--pcolor', PERSONAJES[p.char]?.color || '#888');
    el.querySelector('.panelista__nombre').textContent = p.name + (p.id === yo ? ' (tú)' : '');
    el.querySelector('.panelista__detalle').innerHTML =
      `<span>${ico('negocio')}${props}</span><span>${ico('carta')}${nCartas}</span><span>${ico('trofeo')}${p.trophies}</span>`;
    const cash = el.querySelector('.panelista__cash');
    if (p.lona) { cash.textContent = 'EN LA LONA'; cashMostrado[p.id] = 0; }
    else cash.textContent = '$' + (cashMostrado[p.id] ?? p.cash);
  }
}

/* Enseña el dinero que cambió de manos: número flotante, monedas y conteo. */
function aplicarDeltas() {
  for (const p of g.players) {
    const antes = cashMostrado[p.id];
    if (antes === undefined) { cashMostrado[p.id] = p.cash; continue; }
    if (antes === p.cash || p.lona) { cashMostrado[p.id] = p.cash; continue; }

    const el = $('panelista-' + p.id);
    const cash = el?.querySelector('.panelista__cash');
    const sube = p.cash > antes;
    const dif = Math.abs(p.cash - antes);

    if (el) {
      FX.flotante(el, (sube ? '+$' : '-$') + dif, sube ? 'sube' : 'baja');
      FX.pulsa(el);
      const punto = FX.centroDe(el);
      if (sube) FX.estallido(punto, { tipo: 'moneda', n: Math.min(16, 5 + Math.round(dif / 40)), paleta: 'oro', fuerza: 300, r: 5 });
      else FX.estallido(punto, { tipo: 'chispa', n: 12, paleta: 'peligro', fuerza: 260 });
    }
    if (cash) {
      cash.classList.remove('sube', 'baja');
      void cash.offsetWidth;
      cash.classList.add(sube ? 'sube' : 'baja');
      FX.contar(cash, antes, p.cash, 780);
      setTimeout(() => cash.classList.remove('sube', 'baja'), 1100);
    }
    if (p.id === yo) sube ? S.cobro() : S.pago();
    else if (dif >= 150) sube ? S.cobro() : S.pago();
    cashMostrado[p.id] = p.cash;
  }
}

/* ------------------------------ acciones ------------------------------ */

function pintarAcciones() {
  const cont = $('acciones');
  cont.innerHTML = '';
  cont.classList.toggle('acciones--mio', esMiTurno());
  const html = (s) => cont.insertAdjacentHTML('beforeend', s);
  const boton = (texto, fn, primario = false, clase = '') => {
    const b = document.createElement('button');
    b.className = 'btn' + (primario ? ' btn--primario' : '') + (clase ? ' ' + clase : '');
    b.textContent = texto;
    b.addEventListener('click', () => { S.clic(); fn(); });
    cont.appendChild(b);
    return b;
  };

  if (g.phase === 'end') { html('<p class="acciones__estado">Partida terminada.</p>'); return; }
  if (g.phase === 'mini') { html('<p class="acciones__estado">Minijuego en curso…</p>'); return; }
  const q = actual();
  if (!q) return;

  if (escena > 0) {
    html(`<p class="acciones__estado">${escapa(q.name)} avanza…</p>`);
    ponTimer(cont);
    return;
  }

  if (q.id !== yo) {
    html(`<p class="acciones__estado">Turno de <strong>${escapa(q.name)}</strong>. ${textoEspera()}</p>`);
    ponTimer(cont);
    return;
  }

  if (eligiendo) {
    if (eligiendo.carta === 'dado') {
      html('<p class="acciones__estado">DADO TRUCADO: elige tu tirada.</p><div class="acciones__nums" id="acc-nums"></div>');
      const nums = $('acc-nums');
      for (let v = 2; v <= 12; v++) {
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = String(v);
        b.addEventListener('click', () => { S.clic(); enviar({ t: 'card', id: 'dado', value: v }); eligiendo = null; pintarAcciones(); });
        nums.appendChild(b);
      }
      boton('Cancelar', () => { eligiendo = null; pintarAcciones(); });
    } else if (eligiendo.carta === 'mudanzaf') {
      html('<p class="acciones__estado">MUDANZA FORZOSA: ¿a quién mandas a EL BACHE?</p>');
      g.players.filter((p) => p.id !== yo && !p.lona).forEach((p) =>
        boton(p.name, () => { enviar({ t: 'card', id: 'mudanzaf', target: p.id }); eligiendo = null; pintarAcciones(); }));
      boton('Cancelar', () => { eligiendo = null; pintarAcciones(); });
    } else if (eligiendo.carta === 'okupa') {
      html('<p class="acciones__estado">OKUPA: toca un negocio rival en el tablero.</p>');
      boton('Cancelar', () => { eligiendo = null; pintarAcciones(); pintarTablero(); });
    }
    return;
  }

  const t = g.turn;
  if (t.awaiting === 'roll') {
    html(`<p class="acciones__estado">Te toca.${t.cardPlayed ? '' : ' Puedes jugar una carta antes de tirar.'}</p>`);
    boton(t.trick ? `Tirar (saldrá ${t.trick})` : 'Tirar los dados', () => enviar({ t: 'roll' }), true);
  } else if (t.awaiting === 'buy') {
    const c = CASILLAS[t.canBuy];
    const precio = precioPara(jugador(yo), c.precio);
    html(`<p class="acciones__estado">¿Comprar <strong>${escapa(c.nombre)}</strong> por $${precio}? Renta base $${c.renta}.</p>`);
    boton(`Comprar ($${precio})`, () => enviar({ t: 'buy' }), true);
    boton('Pasar', () => enviar({ t: 'skipbuy' }));
  } else if (t.awaiting === 'mudanza') {
    html('<p class="acciones__estado">MUDANZA: toca un negocio libre (o tuyo) en el tablero.</p>');
    boton('Quedarme aquí', () => enviar({ t: 'fin' }));
  } else if (t.awaiting === 'fin') {
    const puedeReformar = CASILLAS.some((c, i) => esCasillaElegibleReforma(i));
    html(`<p class="acciones__estado">${puedeReformar ? 'Puedes reformar un negocio (tócalo en el tablero) o cerrar el turno.' : 'Cierra el turno cuando quieras.'}</p>`);
    boton('Terminar turno', () => enviar({ t: 'fin' }), true);
  }
  ponTimer(cont);
}

function esCasillaElegibleReforma(i) {
  const p = g.props[i]; const c = CASILLAS[i]; const jug = jugador(yo);
  return !!(g.turn && !g.turn.reformado && p && p.owner === yo && !p.reforma && c.precio && jug &&
    jug.cash >= precioPara(jug, Math.round(c.precio * CONFIG.REFORMA_PCT)));
}

function textoEspera() {
  const t = g.turn;
  if (!t) return '';
  return { roll: 'Está por tirar.', buy: 'Decide una compra.', mudanza: 'Elige mudanza.', fin: 'Cierra su turno.' }[t.awaiting] || '';
}

let timerInt = null;
let avisoTimer = 0;
function ponTimer(cont) {
  const span = document.createElement('span');
  span.className = 'acciones__timer';
  cont.appendChild(span);
  const barra = document.createElement('span');
  barra.className = 'acciones__barra';
  cont.appendChild(barra);

  clearInterval(timerInt);
  timerInt = setInterval(() => {
    const dl = g.phase === 'mini' ? g.mini?.deadline : g.turn?.deadline;
    if (!dl) { span.textContent = ''; barra.style.transform = 'scaleX(0)'; return; }
    const falta = Math.max(0, dl - Date.now());
    const s = Math.ceil(falta / 1000);
    span.textContent = s + ' s';
    span.classList.toggle('acciones__timer--rojo', s <= 10);
    barra.classList.toggle('acciones__barra--rojo', s <= 10);
    barra.style.transform = 'scaleX(' + Math.min(1, falta / CONFIG.TURNO_MS) + ')';
    // Aviso sonoro solo en mi turno y en los últimos segundos.
    if (esMiTurno() && s <= 5 && s > 0 && s !== avisoTimer) { avisoTimer = s; S.tic(); }
  }, 300);
}

/* ------------------------------ mano ------------------------------ */

let firmaMano = '';
function pintarMano() {
  const cont = $('mano');
  const p = jugador(yo);
  const puedo = escena === 0 && esMiTurno() && g.turn?.awaiting === 'roll' && !g.turn.cardPlayed && !eligiendo;
  const cartas = p && !p.lona && Array.isArray(p.cards) ? p.cards : [];
  const firma = cartas.join(',') + '|' + puedo;
  if (firma === firmaMano) return;
  firmaMano = firma;

  cont.innerHTML = '';
  for (const id of cartas) {
    const c = CARTAS[id];
    const b = document.createElement('button');
    b.className = 'carta';
    b.disabled = !puedo;
    b.innerHTML = `<span class="carta__nombre">${c.nombre}</span><span class="carta__desc">${c.desc}</span>`;
    b.addEventListener('click', () => {
      S.cartaJuega();
      if (id === 'dado' || id === 'mudanzaf' || id === 'okupa') {
        eligiendo = { carta: id };
        pintarAcciones();
        pintarMano();
        if (id === 'okupa') pintarTablero();
      } else enviar({ t: 'card', id });
    });
    cont.appendChild(b);
  }
}

/* ------------------------------ registro y charla ------------------------------ */

function pintarRegistro() {
  const cont = $('registro');
  const nuevos = g.log.filter((l) => l.s > ultimoSeqLog);
  if (!nuevos.length && cont.children.length) return;
  if (!cont.children.length) {
    cont.innerHTML = g.log.map((l) => `<p>${escapa(l.txt)}</p>`).join('');
  } else {
    for (const l of nuevos) cont.insertAdjacentHTML('beforeend', `<p class="nuevo">${escapa(l.txt)}</p>`);
    while (cont.children.length > 60) cont.firstElementChild.remove();
  }
  cont.scrollTop = cont.scrollHeight;
  if (g.log.length) ultimoSeqLog = g.log[g.log.length - 1].s;
}

function construirFrases() {
  const cont = $('charla-frases');
  for (const [id, txt] of Object.entries(FRASES)) {
    const b = document.createElement('button');
    b.className = 'btn btn--mini';
    b.textContent = txt;
    b.addEventListener('click', () => { S.clic(); enviar({ t: 'chatq', id }); });
    cont.appendChild(b);
  }
  for (const [id, svg] of [['billete', ICONOS.billete], ['risa', ICONOS.risa], ['calavera', ICONOS.calavera]]) {
    const b = document.createElement('button');
    b.className = 'btn btn--mini';
    b.innerHTML = svg;
    b.setAttribute('aria-label', 'Reacción ' + id);
    b.addEventListener('click', () => { S.clic(); enviar({ t: 'react', id }); });
    cont.appendChild(b);
  }
}

/* ------------------------------ efectos ------------------------------ */

/* Los efectos se guardan hasta que llega el estado: así se pueden repartir
   en el tiempo en vez de dispararse todos a la vez. */
function recibirFx(m) {
  if (m.kind === 'chat') return burbuja(m.pid, FRASES[m.id] || '…');
  if (m.kind === 'react') {
    const svg = { billete: ICONOS.billete, risa: ICONOS.risa, calavera: ICONOS.calavera }[m.id];
    if (svg) burbuja(m.pid, `<span class="burbuja__ico">${svg}</span>`, true);
    return;
  }
  if (m.kind === 'podio') return mostrarPodio(m);
  fxBuzon.push(m);
}

const ICONO_CARTA = {
  propina: 'moneda', multa: 'impuestos', cumple: 'cartas', apagon: 'siesta',
  dado: 'dado', mudanzaf: 'mudanza', congelado: 'candado', imprev: 'bomba',
  okupa: 'okupa', seguro: 'candado',
};

async function efecto(m) {
  const quien = m.pid ? jugador(m.pid) : null;
  switch (m.kind) {
    case 'azar':
      if (m.id === 'mano') { volarCarta(); S.cartaRoba(); await esperar(420); }
      else await revelarCarta(m.id, quien ? `AZAR para ${quien.name}` : 'AZAR');
      break;
    case 'card':
      await revelarCarta(m.id, quien ? `${quien.name} juega` : 'Carta jugada');
      break;
    case 'buy': {
      const cas = $('cas-' + m.tile);
      S.compra();
      FX.pulsa(cas, 'casilla--brilla', 700);
      FX.estallido(FX.centroDe(cas), { tipo: 'moneda', n: 12, paleta: 'dinero', fuerza: 300, r: 5 });
      await esperar(200);
      break;
    }
    case 'reforma': {
      const cas = $('cas-' + m.tile);
      S.bien();
      FX.pulsa(cas, 'casilla--brilla', 700);
      FX.estallido(FX.centroDe(cas), { tipo: 'chispa', n: 18, paleta: 'oro', fuerza: 280 });
      await esperar(200);
      break;
    }
    case 'bote':
      S.cobro();
      FX.lluviaMonedas(FX.centroDe($('mesa')), 18);
      FX.destello('rgba(232,185,60,.28)');
      await esperar(400);
      break;
    case 'quiebra':
      S.quiebra();
      FX.sacudir(3);
      FX.destello('rgba(255,93,93,.35)', 500);
      FX.vineta('rgba(255,93,93,.6)', 1200);
      brindar(`${quien ? quien.name : 'Alguien'} quedó EN LA LONA.`);
      await esperar(700);
      break;
    case 'mini':
      S.mini();
      FX.destello('rgba(123,105,255,.3)');
      await esperar(260);
      break;
    case 'start':
      S.baraja();
      banda('QUE EMPIECE', 'ronda 1', 'var(--billete)');
      await esperar(900);
      break;
    case 'fin':
      S.gana();
      break;
    default:
      break;
  }
}

/* Carta que sale del mazo central y aterriza en tu mano. */
function volarCarta() {
  const a = FX.centroDe($('mesa'));
  const b = FX.centroDe($('mano'));
  const el = document.createElement('div');
  el.className = 'vuela-carta';
  el.style.left = a.x + 'px';
  el.style.top = a.y + 'px';
  el.style.setProperty('--dx', (b.x - a.x) + 'px');
  el.style.setProperty('--dy', (b.y - a.y) + 'px');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 820);
}

/* La carta se da la vuelta en el centro de la pantalla y se lee sola. */
async function revelarCarta(id, quienTxt) {
  const c = CARTAS[id];
  if (!c) return;
  S.cartaJuega();
  const cont = document.createElement('div');
  cont.className = 'revela';
  cont.innerHTML = `
    <div class="revela__carta">
      ${ico(ICONO_CARTA[id] || 'carta', 'revela__ico')}
      <p class="revela__label">Carta de azar</p>
      <p class="revela__nombre">${c.nombre}</p>
      <p class="revela__desc">${c.desc}</p>
      <p class="revela__quien">${escapa(quienTxt)}</p>
    </div>`;
  document.body.appendChild(cont);
  setTimeout(() => cont.remove(), 2000);
  await esperar(1250);
}

function burbuja(pid, html, esHtml = false) {
  const panel = $('panelista-' + pid);
  if (!panel) return;
  const b = document.createElement('span');
  b.className = 'panelista__burbuja';
  if (esHtml) b.innerHTML = html; else b.textContent = html;
  panel.appendChild(b);
  setTimeout(() => b.remove(), 2600);
}

function brindar(txt) {
  const p = document.createElement('p');
  p.textContent = txt;
  $('brindis').appendChild(p);
  setTimeout(() => p.remove(), 3000);
}

/* ------------------------------ minijuego ------------------------------ */

function abrirMini() {
  cerrarMini();
  S.abre();
  FX.limpiar();
  $('velo-mini').classList.remove('oculta');
  const p = jugador(yo);
  if (p && p.lona) {
    $('mini-caja').innerHTML = `<p class="mini__label">Minijuego</p><h2 class="mini__titulo">${MINIJUEGOS[g.mini.kind].nombre}</h2><p class="mini__desc">Estás en la lona: solo miras.</p>`;
    return;
  }
  miniLimpiar = jugarMini($('mini-caja'), g.mini.kind, g.mini.seed, (score) => enviar({ t: 'mg', score }));
}

function cerrarMini() {
  if (miniLimpiar) { miniLimpiar(); miniLimpiar = null; }
  const velo = $('velo-mini');
  if (!velo.classList.contains('oculta')) S.cierra();
  velo.classList.add('oculta');
}

function mostrarPodio(m) {
  if (miniLimpiar) { miniLimpiar(); miniLimpiar = null; }
  podioHasta = Date.now() + 3600;
  FX.limpiar();
  $('velo-mini').classList.remove('oculta');
  const filas = m.podio.map((f, i) => `
    <div class="podio__fila ${i === 0 ? 'podio__fila--oro' : ''}">
      <span class="podio__pos">${i + 1}</span>
      <span>${escapa(f.name)}</span>
      <span class="podio__premio">${f.premio ? '+$' + f.premio : '—'}</span>
    </div>`).join('');
  $('mini-caja').innerHTML = `
    <p class="mini__label">Resultado</p>
    <h2 class="mini__titulo">${MINIJUEGOS[m.mini].nombre}</h2>
    <div class="podio">${filas}</div>`;
  S.bien();
  if (m.podio[0] && m.podio[0].pid === yo) { FX.confeti(60); S.gana(); }
  setTimeout(() => { if (Date.now() >= podioHasta) cerrarMini(); }, 3700);
}

/* ------------------------------ final ------------------------------ */

function pintarFinal() {
  cerrarMini();
  if (!$('velo-final').classList.contains('oculta')) return;
  FX.limpiar();
  $('velo-final').classList.remove('oculta');
  const tabla = g.final || [];
  const uno = tabla[0];
  const gane = uno && uno.pid === yo;
  $('final-caja').innerHTML = `
    ${ico('corona', 'final__corona')}
    <p class="mini__label">Fin de la partida</p>
    <h2 class="final__titulo">${gane
      ? '<span class="final__ganador">GANASTE</span>'
      : `GANA <span class="final__ganador">${uno ? escapa(uno.name) : ''}</span>`}</h2>
    <div class="final__tabla">
      ${tabla.map((f, i) => `
        <div class="final__fila ${i === 0 ? 'final__fila--uno' : ''}">
          <span class="podio__pos">${i + 1}</span>
          ${cara(f.char, '')}
          <span>
            ${escapa(f.name)}${f.pid === yo ? ' (tú)' : ''}
            <span class="final__sub">${f.lona ? 'quebró' : f.trophies + ' trofeos'}</span>
          </span>
          <span class="final__patrimonio">$${f.patrimonio}</span>
        </div>`).join('')}
    </div>
    <button class="btn btn--primario" id="bt-otra">Volver a la portada</button>`;

  if (gane) { FX.confeti(150); S.gana(); }
  else { S.pierde(); }

  $('bt-otra').addEventListener('click', () => {
    S.clic();
    cerreYo = true;
    try { ws && ws.close(); } catch { /* nada */ }
    localStorage.removeItem('quiebra:token:' + sala);
    location.href = location.pathname;
  });
}

/* ------------------------------ util ------------------------------ */

function escapa(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
