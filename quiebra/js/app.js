/* QUIEBRA — cliente. Pinta el estado que manda el servidor y pide acciones.
   Nada de lógica de juego aquí: dados, rentas y rankings los decide el worker. */

import { CONFIG, CASILLAS, BARRIOS, PERSONAJES, CARTAS, MINIJUEGOS } from '../shared/data.js';
import { cara, peon, ICONOS } from './personajes.js';
import { jugarMini } from './minijuegos.js';
import { S } from './sonido.js';

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
let eligiendo = null;    // {carta, ...} flujo de elección de objetivo
let cashPrevio = {};
let ultimoSeqLog = 0;
let miTurnoPrevio = false;

const $ = (id) => document.getElementById(id);
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
  $('bt-empezar').addEventListener('click', () => enviar({ t: 'start' }));
  $('sel-rondas').addEventListener('change', (e) => enviar({ t: 'config', rounds: Number(e.target.value) }));
  document.body.addEventListener('pointerdown', () => S.despertar(), { once: true });

  construirTablero();
  construirFrases();

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
window.QUIEBRA = { enviar: (o) => enviar(o), estado: () => g, quien: () => yo };

function miNombre() {
  const n = $('in-nombre').value.trim().slice(0, 14);
  if (n) localStorage.setItem('quiebra:nombre', n);
  return n;
}

async function crearSala() {
  const n = miNombre();
  if (!n) return errPortada('Ponte un nombre primero.');
  try {
    const r = await fetch(httpBase() + '/new');
    const j = await r.json();
    entrar(j.sala);
  } catch {
    errPortada('No se pudo crear la sala. ¿Sin conexión?');
  }
}

function entrar(codigo) {
  const n = miNombre();
  if (!n) return errPortada('Ponte un nombre primero.');
  codigo = String(codigo || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (codigo.length !== 4) return errPortada('El código tiene 4 letras.');
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
  const previo = g;
  g = nuevo;
  const qs = new URLSearchParams(location.search);
  qs.set('sala', sala);
  history.replaceState(null, '', '?' + qs.toString());

  if (g.phase === 'lobby') { pantalla('scr-sala'); pintarSala(); return; }

  pantalla('scr-juego');
  pintarJuego(previo);

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
      <button class="ficha ${mia ? 'ficha--mia' : ''} ${tomada ? 'ficha--tomada' : ''}" data-char="${id}" ${tomada ? 'disabled' : ''}>
        ${cara(id, 'ficha__cara')}
        <span class="ficha__nombre" style="color:${c.color}">${c.nombre}</span>
        <span class="ficha__apodo">${c.apodo}</span>
        <span class="ficha__desc">${c.desc}</span>
        ${quien ? `<span class="ficha__quien">${mia ? 'Eres tú' : escapa(quien.name)}</span>` : ''}
      </button>`);
  }
  fichas.querySelectorAll('.ficha').forEach((b) =>
    b.addEventListener('click', () => { S.clic(); enviar({ t: 'pick', char: b.dataset.char }); }));

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

function copiarEnlace() {
  const url = location.origin + location.pathname + '?sala=' + sala;
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
  mini: ICONOS.dado, azar: ICONOS.carta, bache: ICONOS.calavera,
  impuestos: ICONOS.billete, bote: ICONOS.billete,
};

function construirTablero() {
  const t = $('tablero');
  t.innerHTML = '';
  CASILLAS.forEach((c, i) => {
    const [fila, col] = idxACelda(i);
    const esquina = [0, 6, 12, 18].includes(i);
    const clases = ['casilla'];
    if (esquina) clases.push('casilla--esquina');
    if (c.t === 'negocio') clases.push('casilla--negocio');
    else if (!esquina) clases.push('casilla--especial', 'casilla--' + c.t);
    const div = document.createElement('div');
    div.className = clases.join(' ');
    div.id = 'cas-' + i;
    div.style.gridArea = `${fila + 1} / ${col + 1}`;
    if (c.barrio) div.style.setProperty('--neon', BARRIOS[c.barrio].color);
    div.innerHTML = `
      ${!esquina && ICONO_CASILLA[c.t] ? `<span class="casilla__icono" style="color:var(--muted)">${ICONO_CASILLA[c.t]}</span>` : ''}
      <span class="casilla__nombre">${c.nombre}</span>
      ${c.precio ? `<span class="casilla__precio">$${c.precio}</span>` : ''}
      <span class="casilla__extras"></span>`;
    div.addEventListener('click', () => clicCasilla(i));
    t.appendChild(div);
  });
}

function pintarTablero() {
  CASILLAS.forEach((c, i) => {
    const div = $('cas-' + i);
    const extras = div.querySelector('.casilla__extras');
    extras.innerHTML = '';
    div.style.removeProperty('--pcolor');
    const prop = g.props[i];
    if (prop && prop.owner) {
      const dueno = g.players.find((p) => p.id === prop.owner);
      if (dueno) {
        div.style.setProperty('--pcolor', PERSONAJES[dueno.char]?.color || '#888');
        extras.insertAdjacentHTML('beforeend', `<span class="casilla__dueno" style="--pcolor:${PERSONAJES[dueno.char]?.color}"></span>`);
      }
      if (prop.reforma) extras.insertAdjacentHTML('beforeend', `<span class="casilla__reforma">${ICONOS.reforma}</span>`);
      if (prop.okupa) extras.insertAdjacentHTML('beforeend', `<span class="casilla__okupa">${ICONOS.okupa}</span>`);
    }
    div.classList.toggle('casilla--activa', esCasillaElegible(i));
  });
  pintarPeones();
}

function esCasillaElegible(i) {
  if (!esMiTurno()) return false;
  const c = CASILLAS[i];
  if (eligiendo && eligiendo.carta === 'okupa') {
    const p = g.props[i];
    return !!(p && p.owner && p.owner !== yo);
  }
  if (g.turn?.awaiting === 'mudanza') {
    if (c.t !== 'negocio') return false;
    const p = g.props[i];
    return !p || !p.owner || p.owner === yo;
  }
  if (g.turn?.awaiting === 'fin' && !g.turn.reformado) {
    const p = g.props[i];
    const jug = jugador(yo);
    if (p && p.owner === yo && !p.reforma && c.precio) {
      return jug.cash >= precioPara(jug, Math.round(c.precio * CONFIG.REFORMA_PCT));
    }
  }
  return false;
}

function clicCasilla(i) {
  if (!esCasillaElegible(i)) return;
  S.clic();
  if (eligiendo && eligiendo.carta === 'okupa') {
    enviar({ t: 'card', id: 'okupa', target: i });
    eligiendo = null;
    pintarAcciones();
    return;
  }
  if (g.turn?.awaiting === 'mudanza') { enviar({ t: 'mudanza', tile: i }); return; }
  if (g.turn?.awaiting === 'fin') enviar({ t: 'reforma', tile: i });
}

function pintarPeones() {
  const capa = $('peones');
  const unidad = 100 / 7.7; // pistas: 1.35 + 5×1 + 1.35
  const centro = (k) => (k === 0 ? 1.35 / 2 : k === 6 ? 7.7 - 1.35 / 2 : 1.35 + (k - 1) + 0.5) * unidad;
  g.players.forEach((p, pi) => {
    let el = $('peon-' + p.id);
    if (!el) {
      el = document.createElement('div');
      el.id = 'peon-' + p.id;
      el.className = 'peon';
      el.innerHTML = peon(p.char, PERSONAJES[p.char]?.color || '#888');
      capa.appendChild(el);
    }
    const [fila, col] = idxACelda(p.pos);
    const enMismaCasilla = g.players.filter((q) => q.pos === p.pos);
    const k = enMismaCasilla.findIndex((q) => q.id === p.id);
    const off = enMismaCasilla.length > 1 ? (k - (enMismaCasilla.length - 1) / 2) * 3.2 : 0;
    el.style.left = centro(col) + off + '%';
    el.style.top = centro(fila) + (enMismaCasilla.length > 2 ? (k % 2) * 3 - 1.5 : 0) + '%';
    el.style.display = p.lona ? 'none' : '';
    el.classList.toggle('peon--turno', g.phase === 'turn' && actual()?.id === p.id);
  });
}

/* ------------------------------ juego ------------------------------ */

function jugador(pid) { return g.players.find((p) => p.id === pid); }
function actual() { return g.players[g.turnIdx]; }
function esMiTurno() { return g.phase === 'turn' && actual()?.id === yo; }
function precioPara(pl, precio) { return Math.round(precio * (pl.char === 'pulpo' ? 0.85 : 1)); }

function pintarJuego(previo) {
  pintarTablero();
  pintarPanelistas();
  pintarAcciones();
  pintarMano();
  pintarRegistro();
  pintarMesa();

  const esMio = esMiTurno();
  if (esMio && !miTurnoPrevio) S.turno();
  miTurnoPrevio = esMio;
}

function pintarMesa() {
  $('mesa-ronda').textContent = g.phase === 'end' ? 'FIN' : `RONDA ${g.round} / ${g.maxRounds}`;
  $('mesa-bote').textContent = g.bote > 0 ? `BOTE $${g.bote}` : '';
  const dados = $('mesa-dados');
  if (g.turn?.dice) {
    dados.innerHTML = g.turn.dice.map((d) => `<div class="dado">${d}</div>`).join('');
  } else if (!dados.querySelector('.dado--rueda')) {
    dados.innerHTML = '';
  }
  const quien = actual();
  $('mesa-aviso').textContent =
    g.phase === 'mini' ? 'MINIJUEGO EN CURSO' :
    g.phase === 'turn' && quien ? (quien.id === yo ? 'Tu turno' : `Turno de ${quien.name}`) : '';
}

function pintarPanelistas() {
  const cont = $('panelistas');
  const antes = { ...cashPrevio };
  cont.innerHTML = '';
  for (const p of g.players) {
    const props = Object.values(g.props).filter((x) => x.owner === p.id).length;
    const nCartas = p.id === yo ? p.cards.length : p.cards;
    const clase = [
      'panelista',
      g.phase === 'turn' && actual()?.id === p.id ? 'panelista--turno' : '',
      p.lona ? 'panelista--lona' : '',
      !p.online ? 'panelista--off' : '',
    ].join(' ');
    const dir = antes[p.id] !== undefined && antes[p.id] !== p.cash ? (p.cash > antes[p.id] ? 'sube' : 'baja') : '';
    cont.insertAdjacentHTML('beforeend', `
      <div class="${clase}" id="panelista-${p.id}" style="--pcolor:${PERSONAJES[p.char]?.color || '#888'}">
        ${cara(p.char, 'panelista__cara')}
        <div>
          <p class="panelista__nombre">${escapa(p.name)}${p.id === yo ? ' (tú)' : ''}</p>
          <p class="panelista__detalle">${props} neg · ${nCartas} cartas · ${p.trophies} trofeos</p>
        </div>
        <p class="panelista__cash ${dir}">${p.lona ? 'EN LA LONA' : '$' + p.cash}</p>
      </div>`);
    cashPrevio[p.id] = p.cash;
  }
}

/* ------------------------------ acciones ------------------------------ */

function pintarAcciones() {
  const cont = $('acciones');
  cont.innerHTML = '';
  const html = (s) => cont.insertAdjacentHTML('beforeend', s);
  const boton = (texto, fn, primario = false) => {
    const b = document.createElement('button');
    b.className = 'btn' + (primario ? ' btn--primario' : '');
    b.textContent = texto;
    b.addEventListener('click', () => { S.clic(); fn(); });
    cont.appendChild(b);
    return b;
  };

  if (g.phase === 'end') { html('<p class="acciones__estado">Partida terminada.</p>'); return; }
  if (g.phase === 'mini') { html('<p class="acciones__estado">Minijuego en curso…</p>'); return; }
  const q = actual();
  if (!q) return;

  if (q.id !== yo) {
    html(`<p class="acciones__estado">Turno de <strong>${escapa(q.name)}</strong>. ${textoEspera()}</p>`);
    ponTimer(cont);
    return;
  }

  if (eligiendo) {
    if (eligiendo.carta === 'dado') {
      html('<p class="acciones__estado">DADO TRUCADO: elige tu tirada.</p>');
      for (let v = 2; v <= 12; v++) boton(String(v), () => { enviar({ t: 'card', id: 'dado', value: v }); eligiendo = null; pintarAcciones(); });
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
    html(`<p class="acciones__estado">Tu turno.${t.cardPlayed ? '' : ' Puedes jugar una carta antes de tirar.'}</p>`);
    boton(t.trick ? `Tirar (saldrá ${t.trick})` : 'Tirar los dados', () => enviar({ t: 'roll' }), true);
  } else if (t.awaiting === 'buy') {
    const c = CASILLAS[t.canBuy];
    const precio = precioPara(jugador(yo), c.precio);
    html(`<p class="acciones__estado">¿Comprar <strong>${c.nombre}</strong> por $${precio}?</p>`);
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
  return !g.turn.reformado && p && p.owner === yo && !p.reforma && c.precio &&
    jug.cash >= precioPara(jug, Math.round(c.precio * CONFIG.REFORMA_PCT));
}

function textoEspera() {
  const t = g.turn;
  if (!t) return '';
  return { roll: 'Está por tirar.', buy: 'Decide una compra.', mudanza: 'Elige mudanza.', fin: 'Cierra su turno.' }[t.awaiting] || '';
}

let timerInt = null;
function ponTimer(cont) {
  const span = document.createElement('span');
  span.className = 'acciones__timer';
  cont.appendChild(span);
  clearInterval(timerInt);
  timerInt = setInterval(() => {
    const dl = g.phase === 'mini' ? g.mini?.deadline : g.turn?.deadline;
    if (!dl) { span.textContent = ''; return; }
    const s = Math.max(0, Math.ceil((dl - Date.now()) / 1000));
    span.textContent = s + ' s';
    span.classList.toggle('acciones__timer--rojo', s <= 10);
  }, 400);
}

/* ------------------------------ mano ------------------------------ */

function pintarMano() {
  const cont = $('mano');
  cont.innerHTML = '';
  const p = jugador(yo);
  if (!p || p.lona || !Array.isArray(p.cards)) return;
  const puedo = esMiTurno() && g.turn.awaiting === 'roll' && !g.turn.cardPlayed;
  for (const id of p.cards) {
    const c = CARTAS[id];
    const b = document.createElement('button');
    b.className = 'carta';
    b.disabled = !puedo;
    b.innerHTML = `<span class="carta__nombre">${c.nombre}</span><span class="carta__desc">${c.desc}</span>`;
    b.addEventListener('click', () => {
      S.carta();
      if (id === 'dado' || id === 'mudanzaf' || id === 'okupa') {
        eligiendo = { carta: id };
        pintarAcciones();
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
  cont.innerHTML = g.log.map((l) => `<p>${escapa(l.txt)}</p>`).join('');
  cont.scrollTop = cont.scrollHeight;
  if (g.log.length) ultimoSeqLog = g.log[g.log.length - 1].s;
}

function construirFrases() {
  const cont = $('charla-frases');
  for (const [id, txt] of Object.entries(FRASES)) {
    const b = document.createElement('button');
    b.className = 'btn btn--mini';
    b.textContent = txt;
    b.addEventListener('click', () => enviar({ t: 'chatq', id }));
    cont.appendChild(b);
  }
  for (const [id, svg] of [['billete', ICONOS.billete], ['risa', ICONOS.risa], ['calavera', ICONOS.calavera]]) {
    const b = document.createElement('button');
    b.className = 'btn btn--mini';
    b.innerHTML = `<span style="display:inline-block;width:1.1em;height:1.1em;vertical-align:-.2em">${svg}</span>`;
    b.setAttribute('aria-label', 'Reacción ' + id);
    b.addEventListener('click', () => enviar({ t: 'react', id }));
    cont.appendChild(b);
  }
}

/* ------------------------------ efectos ------------------------------ */

function recibirFx(m) {
  if (m.kind === 'dice') {
    S.dado();
    $('mesa-dados').innerHTML = m.dice.map((d) => `<div class="dado dado--rueda">${d}</div>`).join('');
  } else if (m.kind === 'chat') {
    burbuja(m.pid, FRASES[m.id] || '…');
  } else if (m.kind === 'react') {
    const svg = { billete: ICONOS.billete, risa: ICONOS.risa, calavera: ICONOS.calavera }[m.id];
    if (svg) burbuja(m.pid, `<span style="display:inline-block;width:1.3em;height:1.3em;vertical-align:-.25em">${svg}</span>`, true);
  } else if (m.kind === 'buy' || m.kind === 'bote') { S.dinero(); }
  else if (m.kind === 'card' || m.kind === 'azar') { S.carta(); }
  else if (m.kind === 'reforma') { S.bien(); }
  else if (m.kind === 'quiebra') { S.quiebra(); brindar('Alguien quedó EN LA LONA.'); }
  else if (m.kind === 'mini') { S.mini(); }
  else if (m.kind === 'podio') { mostrarPodio(m); }
  else if (m.kind === 'fin') { S.fanfarria(); }
  else if (m.kind === 'start') { S.fanfarria(); }
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
  $('velo-mini').classList.add('oculta');
}

function mostrarPodio(m) {
  if (miniLimpiar) { miniLimpiar(); miniLimpiar = null; }
  podioHasta = Date.now() + 3600;
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
  setTimeout(() => { if (Date.now() >= podioHasta) cerrarMini(); }, 3700);
}

/* ------------------------------ final ------------------------------ */

function pintarFinal() {
  cerrarMini();
  $('velo-final').classList.remove('oculta');
  const tabla = g.final || [];
  const uno = tabla[0];
  $('final-caja').innerHTML = `
    <p class="mini__label">Fin de la partida</p>
    <h2 class="final__titulo">${uno && uno.pid === yo ? 'GANASTE' : 'GANA'} <span class="final__ganador">${uno ? escapa(uno.name) : ''}</span></h2>
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
  $('bt-otra').addEventListener('click', () => {
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
