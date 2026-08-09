/* QUIEBRA — los 4 minijuegos. Corren en el cliente con la semilla del servidor:
   los 4 jugadores ven exactamente la misma partida. El score viaja al servidor,
   que rankea al vencer el deadline. Score: cuanto más alto, mejor.

   Toda la aleatoriedad que afecta al juego sale de rng(seed). Lo único que usa
   Math.random es la decoración (chispas, partículas), que no cambia el resultado.

   Los estilos viven en minijuegos.css (clases mj__*, mj-*, cl-*, sf-*, mm-*, cz-*). */

import { MINIJUEGOS, rng } from '../shared/data.js';
import { S } from './sonido.js';
import { ico } from './iconos.js';

/* ============================ utilidades ============================ */

/** ¿El sistema pide menos movimiento? Se consulta al vuelo, no se cachea. */
function reducido() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** Dispara un sonido sin romper el minijuego si la muestra no está lista. */
function son(nombre, ...args) {
  try {
    const f = S && S[nombre];
    if (typeof f === 'function') f.apply(S, args);
  } catch { /* sin audio */ }
}

const limita = (v, a, b) => (v < a ? a : v > b ? b : v);
const suaveSalida = (k) => 1 - Math.pow(1 - k, 3);

/** Animación corta con la API de animaciones web; se ignora en modo reducido. */
function anima(el, cuadros, ms, easing = 'cubic-bezier(.2,1.5,.4,1)') {
  if (!el || reducido() || typeof el.animate !== 'function') return null;
  try { return el.animate(cuadros, { duration: ms, easing, fill: 'none' }); } catch { return null; }
}

/* Ciclo de vida: timers, listeners y bucles de animación en un solo sitio,
   para que limpiar() no deje nada suelto cuando se cierra el overlay. */
function crearCiclo() {
  let vivo = true;
  let raf = 0;
  let previo = 0;
  const timers = new Set();
  const oyentes = [];
  const bucles = new Set();

  const paso = (t) => {
    if (!vivo) { raf = 0; return; }
    const dt = Math.min(0.05, (t - previo) / 1000);
    previo = t;
    for (const f of [...bucles]) if (bucles.has(f)) f(dt, t);
    raf = bucles.size ? requestAnimationFrame(paso) : 0;
  };

  return {
    vivo: () => vivo,
    /** setTimeout que se cancela solo al limpiar y no corre si ya se cerró. */
    espera(fn, ms) {
      const id = setTimeout(() => { timers.delete(id); if (vivo) fn(); }, ms);
      timers.add(id);
      return id;
    },
    /** Añade una función al bucle de cuadros. Devuelve su cancelador. */
    bucle(fn) {
      bucles.add(fn);
      if (!raf) { previo = performance.now(); raf = requestAnimationFrame(paso); }
      return () => bucles.delete(fn);
    },
    pararBucles() { bucles.clear(); },
    escucha(el, ev, fn, op) {
      el.addEventListener(ev, fn, op);
      oyentes.push([el, ev, fn, op]);
    },
    limpiar() {
      vivo = false;
      timers.forEach(clearTimeout); timers.clear();
      bucles.clear();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (const [el, ev, fn, op] of oyentes) el.removeEventListener(ev, fn, op);
      oyentes.length = 0;
    },
  };
}

/* ---------------------------- lienzo y partículas ---------------------------- */

/** Canvas superpuesto con DPR correcto. Se remide al cambiar el tamaño. */
function crearLienzo(cont, c) {
  const cv = document.createElement('canvas');
  cv.className = 'mj__lienzo';
  cv.setAttribute('aria-hidden', 'true');
  cont.appendChild(cv);
  const cx = cv.getContext('2d');
  let an = 1, al = 1;

  const medir = () => {
    const r = cont.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    an = Math.max(1, r.width);
    al = Math.max(1, r.height);
    cv.width = Math.round(an * dpr);
    cv.height = Math.round(al * dpr);
    cv.style.width = an + 'px';
    cv.style.height = al + 'px';
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  medir();
  c.escucha(window, 'resize', medir);

  return {
    cx,
    medir,
    ancho: () => an,
    alto: () => al,
    /** Pasa un punto de la pantalla a coordenadas del lienzo. */
    local(el) {
      const rb = el.getBoundingClientRect();
      const rc = cv.getBoundingClientRect();
      return { x: rb.left + rb.width / 2 - rc.left, y: rb.top + rb.height / 2 - rc.top };
    },
  };
}

/** Motor mínimo de partículas: chispas con gravedad y anillos de choque. */
function crearParticulas(lienzo, c) {
  const ps = [];
  let sucio = false;

  const chispas = (x, y, n, color, fuerza = 1) => {
    if (reducido()) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (60 + Math.random() * 210) * fuerza;
      ps.push({
        t: 'c', x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 60 * fuerza,
        g: 900, r: 1.6 + Math.random() * 2.6,
        vida: 0, max: 0.42 + Math.random() * 0.4, color,
      });
    }
  };

  const anillo = (x, y, color, r0, r1, max = 0.42, grosor = 4) => {
    if (reducido()) return;
    ps.push({ t: 'a', x, y, r0, r1, vida: 0, max, color, grosor });
  };

  c.bucle((dt) => {
    const cx = lienzo.cx;
    if (!ps.length) {
      if (sucio) { cx.clearRect(0, 0, lienzo.ancho(), lienzo.alto()); sucio = false; }
      return;
    }
    sucio = true;
    cx.clearRect(0, 0, lienzo.ancho(), lienzo.alto());
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.vida += dt;
      const k = p.vida / p.max;
      if (k >= 1) { ps.splice(i, 1); continue; }
      cx.globalAlpha = 1 - k * k;
      if (p.t === 'c') {
        p.vy += p.g * dt;
        p.vx *= 1 - 1.8 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        cx.fillStyle = p.color;
        cx.beginPath();
        cx.arc(p.x, p.y, p.r * (1 - k * 0.7), 0, 6.2832);
        cx.fill();
      } else {
        const r = p.r0 + (p.r1 - p.r0) * suaveSalida(k);
        cx.strokeStyle = p.color;
        cx.lineWidth = p.grosor * (1 - k);
        cx.beginPath();
        cx.arc(p.x, p.y, r, 0, 6.2832);
        cx.stroke();
      }
    }
    cx.restore();
  });

  return { chispas, anillo, vaciar() { ps.length = 0; } };
}

/* ============================ armazón común ============================ */

export function jugarMini(caja, kind, seed, onScore) {
  const c = crearCiclo();
  const def = MINIJUEGOS[kind] || { nombre: 'MINIJUEGO', desc: '', dur: 8000 };
  const R = rng(seed);
  let enviado = false;

  caja.classList.add('mj');
  caja.innerHTML = `
    <p class="mini__label mj__label">Minijuego para todos</p>
    <h2 class="mini__titulo mj__titulo">${def.nombre}</h2>
    <p class="mini__desc mj__desc">${def.desc}</p>
    <div class="mini__zona mj__zona"></div>
    <div class="mj__hud">
      <div class="mj__barra"><i class="mj__barra-luz"></i></div>
      <p class="mj__crono">Preparados</p>
    </div>`;

  const zona = caja.querySelector('.mj__zona');
  const hud = caja.querySelector('.mj__hud');
  const barra = caja.querySelector('.mj__barra');
  const luz = caja.querySelector('.mj__barra-luz');
  const crono = caja.querySelector('.mj__crono');

  /* El envío es único: la primera llamada gana y cierra el minijuego. */
  const enviar = (score, op = {}) => {
    if (enviado || !c.vivo()) return;
    enviado = true;
    onScore(score);
    c.pararBucles();
    remate(zona, hud, crono, op, c);
  };

  const api = { zona, hud, barra, luz, crono, R, def, enviar, c };
  const arranca = (JUEGOS[kind] || JUEGOS.clics)(api);
  cuentaAtras(zona, c, () => { if (c.vivo()) arranca(); });

  return () => { c.limpiar(); caja.classList.remove('mj'); };
}

/* ---------------------------- cuenta regresiva ---------------------------- */

function cuentaAtras(zona, c, alTerminar) {
  const cap = document.createElement('div');
  cap.className = 'mj-cuenta';
  cap.innerHTML = '<span class="mj-cuenta__n"></span>';
  zona.appendChild(cap);
  const n = cap.querySelector('.mj-cuenta__n');

  const pinta = (txt, ya) => {
    n.textContent = txt;
    n.classList.toggle('mj-cuenta__n--ya', !!ya);
    anima(n, [
      { transform: 'scale(2.1)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1, offset: 0.35 },
      { transform: 'scale(1)', opacity: 1 },
    ], ya ? 460 : 640, 'cubic-bezier(.15,.9,.25,1)');
  };

  son('mini');
  pinta('3'); son('cuenta', 3);
  c.espera(() => { pinta('2'); son('cuenta', 2); }, 700);
  c.espera(() => { pinta('1'); son('cuenta', 1); }, 1400);
  c.espera(() => { pinta('YA', true); son('cuenta', 0); }, 2100);
  c.espera(() => { cap.remove(); alTerminar(); }, 2560);
}

/* ---------------------------- cronómetro (barra) ---------------------------- */

/** Barra que se vacía y se pone roja al final. Devuelve su cancelador. */
function cronometro(api, ms, alFinal) {
  const { barra, luz, crono, c } = api;
  barra.classList.add('mj__barra--activa');
  barra.classList.remove('mj__barra--rojo');
  const fin = performance.now() + ms;
  let ultimoSeg = Math.ceil(ms / 1000);

  const parar = c.bucle(() => {
    const falta = fin - performance.now();
    const f = limita(falta / ms, 0, 1);
    luz.style.transform = 'scaleX(' + f.toFixed(4) + ')';
    if (f <= 0.28) barra.classList.add('mj__barra--rojo');
    const seg = Math.max(0, falta / 1000);
    crono.textContent = seg.toFixed(1) + ' s';
    const ent = Math.ceil(seg);
    if (ent < ultimoSeg) {
      ultimoSeg = ent;
      if (ent > 0 && ent <= 3) son('tic');
    }
    if (falta <= 0) { parar(); alFinal(); }
  });
  return parar;
}

/* ---------------------------- remate del envío ---------------------------- */

/* Panel final: la cifra sube contando, cae el sello y queda la espera. */
function remate(zona, hud, crono, op, c) {
  const {
    cifra = null, unidad = '', decimales = 0,
    titulo = '', sello = '', tono = 'bien',
  } = op;

  hud.classList.add('mj__hud--fin');
  crono.textContent = 'Marca enviada';
  zona.classList.add('mj__zona--fin');
  zona.innerHTML = `
    <div class="mj-fin mj-fin--${tono}" role="status">
      <div class="mj-fin__destello"></div>
      ${cifra === null ? '' : `<p class="mj-fin__cifra">
        <span class="mj-fin__num">0</span><span class="mj-fin__uni">${unidad}</span>
      </p>`}
      <p class="mini__marcador mj-fin__texto">${titulo}</p>
      <div class="mj-fin__sello">${sello}</div>
      <p class="mini__espera mj-fin__espera">
        ${ico('reloj', 'mj-fin__ico')}<span>Esperando a los demás…</span>
      </p>
    </div>`;

  const num = zona.querySelector('.mj-fin__num');
  const sel = zona.querySelector('.mj-fin__sello');

  if (num && cifra !== null) {
    const dur = reducido() ? 1 : 720;
    const t0 = performance.now();
    const parar = c.bucle(() => {
      const k = limita((performance.now() - t0) / dur, 0, 1);
      num.textContent = (cifra * suaveSalida(k)).toFixed(decimales);
      if (k >= 1) { parar(); anima(num, [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], 240); }
    });
    for (let i = 1; i <= 3; i++) c.espera(() => son('tic'), (dur / 4) * i);
  }

  c.espera(() => {
    sel.classList.add('mj-fin__sello--puesto');
    son('golpe');
    anima(zona.querySelector('.mj-fin'), [
      { transform: 'translateY(2px)' }, { transform: 'translateY(0)' },
    ], 180, 'ease-out');
  }, reducido() ? 0 : 780);
}

/* ============================ los cuatro juegos ============================ */
/* Cada uno monta su escena de inmediato (para que se vea durante la cuenta
   regresiva) y devuelve la función que arranca la partida. */

const JUEGOS = {

  /* --------------------- DUELO DE CLICS --------------------- */
  clics(api) {
    const { zona, crono, def, enviar, c } = api;
    zona.innerHTML = `
      <div class="cl">
        <div class="cl__marcador">
          <p class="cl__num">0</p>
          <p class="cl__ritmo"><span class="cl__cps">0.0</span> clics por segundo</p>
        </div>
        <button class="cl__boton" type="button" aria-label="Golpea el botón sin parar">
          <span class="cl__aura"></span>
          <span class="cl__cara">
            <span class="cl__brillo"></span>
            <span class="cl__texto">GOLPEA</span>
          </span>
        </button>
      </div>`;

    const cl = zona.querySelector('.cl');
    const btn = zona.querySelector('.cl__boton');
    const num = zona.querySelector('.cl__num');
    const cps = zona.querySelector('.cl__cps');
    const lienzo = crearLienzo(cl, c);
    const par = crearParticulas(lienzo, c);

    let n = 0;
    let jugando = false;
    let calor = 0;
    const golpes = [];               // marcas de tiempo del último segundo
    const COLORES = ['#ffd76a', '#ffb14d', '#ff7a5d', '#fff2c4'];

    crono.textContent = 'Prepara el dedo';

    const golpe = (e) => {
      if (e) e.preventDefault();
      if (!jugando) return;
      n++;
      num.textContent = n;
      golpes.push(performance.now());
      son('clic');

      anima(num, [{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], 220);
      btn.classList.add('cl__boton--hundido');
      c.espera(() => btn.classList.remove('cl__boton--hundido'), 80);

      const p = lienzo.local(btn);
      const rb = btn.getBoundingClientRect();
      par.anillo(p.x, p.y, calor > 0.6 ? '#ff8a5c' : '#a99bff', rb.width * 0.42, rb.width * 0.78, 0.38, 5);
      par.chispas(p.x, p.y, 5 + Math.round(calor * 7), COLORES[n % COLORES.length], 0.7 + calor * 0.9);
    };

    c.escucha(btn, 'pointerdown', golpe);
    c.escucha(btn, 'keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') golpe(e);
    });

    /* El calor sube con el ritmo y baja solo: tiñe el botón de violeta a rojo. */
    c.bucle(() => {
      const ahora = performance.now();
      while (golpes.length && ahora - golpes[0] > 1000) golpes.shift();
      const ritmo = golpes.length;
      cps.textContent = ritmo.toFixed(1);
      const objetivo = limita(ritmo / 11, 0, 1);
      calor += (objetivo - calor) * 0.12;
      cl.style.setProperty('--calor', calor.toFixed(3));
      cl.style.setProperty('--oro-op', limita((calor - 0.2) * 1.9, 0, 1).toFixed(3));
      cl.style.setProperty('--rojo-op', limita((calor - 0.58) * 2.4, 0, 1).toFixed(3));
      cl.classList.toggle('cl--ardiendo', calor > 0.68);
    });

    return () => {
      jugando = true;
      cl.classList.add('cl--vivo');
      cronometro(api, def.dur, () => {
        jugando = false;
        const ritmo = n / (def.dur / 1000);
        const titulo =
          n < 18 ? 'Te faltó ritmo' :
          n < 32 ? 'Buen pulso' :
          n < 46 ? 'Dedos rápidos' : 'Le rompiste el botón';
        son(n >= 32 ? 'bien' : 'selec');
        const p = lienzo.local(btn);
        par.chispas(p.x, p.y, 26, '#ffd76a', 1.5);
        enviar(n, {
          cifra: n, unidad: 'clics', titulo: titulo + ' — ' + ritmo.toFixed(1) + ' por segundo',
          sello: 'TIEMPO', tono: 'bien',
        });
      });
    };
  },

  /* --------------------- SEMÁFORO --------------------- */
  semaforo(api) {
    const { zona, crono, R, enviar, c } = api;
    zona.innerHTML = `
      <div class="sf">
        <button class="sf__campo" type="button" aria-label="Toca en cuanto se encienda el verde">
          <span class="sf__caja">
            <i class="sf__foco sf__foco--rojo"></i>
            <i class="sf__foco sf__foco--ambar"></i>
            <i class="sf__foco sf__foco--verde"></i>
          </span>
          <span class="sf__pie"></span>
          <span class="sf__pista">Prepárate</span>
        </button>
        <div class="sf__flash"></div>
      </div>`;

    const sf = zona.querySelector('.sf');
    const campo = zona.querySelector('.sf__campo');
    const pista = zona.querySelector('.sf__pista');

    /* Misma espera en los 4 clientes: sale de la semilla del servidor. */
    const espera = 2000 + Math.floor(R() * 4000);
    let verdeEn = 0;

    sf.classList.add('sf--listo');
    crono.textContent = 'Espera el verde';

    const tocar = (e) => {
      if (e) e.preventDefault();
      if (!sf.classList.contains('sf--rojo') && !sf.classList.contains('sf--verde')) return;

      if (!verdeEn) {                       // salida en falso
        sf.classList.add('sf--falso');
        son('mal');
        anima(sf, [
          { transform: 'translateX(-9px)' }, { transform: 'translateX(8px)' },
          { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' },
        ], 260, 'ease-out');
        enviar(-1000000, {
          cifra: null, titulo: 'Te adelantaste a la luz verde',
          sello: 'SALIDA EN FALSO', tono: 'mal',
        });
        return;
      }

      const ms = Math.round(performance.now() - verdeEn);
      son('moneda');
      const escala =
        ms <= 180 ? 'Reflejos de gato' :
        ms <= 250 ? 'Muy rápido' :
        ms <= 330 ? 'Buen tiempo' :
        ms <= 450 ? 'Normal' : 'Estabas dormido';
      enviar(-ms, {
        cifra: ms, unidad: 'ms', titulo: escala,
        sello: 'VÁLIDO', tono: 'bien',
      });
    };

    c.escucha(campo, 'pointerdown', tocar);
    c.escucha(campo, 'keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') tocar(e); });

    return () => {
      sf.classList.remove('sf--listo');
      sf.classList.add('sf--rojo');
      pista.textContent = 'No te adelantes';
      crono.textContent = 'Rojo';

      /* Tic tenue de tensión mientras dura el rojo. */
      const tic = () => {
        if (verdeEn) return;
        son('tic');
        c.espera(tic, 780);
      };
      c.espera(tic, 500);

      c.espera(() => {
        sf.classList.remove('sf--rojo');
        sf.classList.add('sf--verde');
        verdeEn = performance.now();
        pista.textContent = 'AHORA';
        crono.textContent = 'VERDE';
        son('golpe');
        anima(sf, [
          { transform: 'scale(1.05)' }, { transform: 'scale(.99)' }, { transform: 'scale(1)' },
        ], 240);
        /* Ventana de reacción: si no toca, la barra se vacía y se cierra. */
        cronometro(api, 4000, () => enviar(-999000, {
          cifra: null, titulo: 'La luz se puso verde y no reaccionaste',
          sello: 'SIN REACCIÓN', tono: 'mal',
        }));
      }, espera);
    };
  },

  /* --------------------- MEMORIA --------------------- */
  memoria(api) {
    const { zona, crono, R, enviar, c } = api;
    const PASOS = 6;
    const COLORES = ['cobre', 'jade', 'violeta', 'oro'];
    const SONIDOS = ['tic', 'selec', 'carta', 'moneda'];
    const seq = Array.from({ length: PASOS }, () => Math.floor(R() * 4));

    zona.innerHTML = `
      <div class="mm">
        <div class="mm__cab">
          <span class="mm__fase">MIRA</span>
          <div class="mm__puntos" aria-hidden="true">
            ${Array.from({ length: PASOS }, () => '<i class="mm__punto"></i>').join('')}
          </div>
        </div>
        <div class="mm__tablero">
          ${COLORES.map((col, i) => `
            <button class="mm__pad" type="button" data-n="${i}" data-color="${col}"
                    aria-label="Luz ${i + 1}">
              <span class="mm__pad-cara"></span>
            </button>`).join('')}
        </div>
      </div>`;

    const mm = zona.querySelector('.mm');
    const fase = zona.querySelector('.mm__fase');
    const puntos = [...zona.querySelectorAll('.mm__punto')];
    const pads = [...zona.querySelectorAll('.mm__pad')];

    let etapa = 'mira';
    let paso = 0;
    let inicio = 0;
    let cerrando = false;

    crono.textContent = 'Mira la secuencia';

    const prende = (n, ms, extra) => {
      const p = pads[n];
      if (!p) return;
      p.classList.add('mm__pad--on');
      if (extra) p.classList.add(extra);
      son(SONIDOS[n]);
      c.espera(() => {
        p.classList.remove('mm__pad--on');
        if (extra) p.classList.remove(extra);
      }, Math.max(90, ms - 70));
    };

    const marcaPunto = (i, cls) => {
      if (puntos[i]) puntos[i].className = 'mm__punto ' + cls;
    };

    const tocar = (e, p) => {
      e.preventDefault();
      if (etapa !== 'repite' || cerrando) return;
      const n = Number(p.dataset.n);
      prende(n, 240);

      if (n === seq[paso]) {
        marcaPunto(paso, 'mm__punto--bien');
        paso++;
        if (paso === PASOS) {
          cerrando = true;
          const ms = Math.round(performance.now() - inicio);
          son('bien');
          mm.classList.add('mm--completa');
          enviar(paso * 1000000 - ms, {
            cifra: ms / 1000, unidad: 's', decimales: 1,
            titulo: 'Secuencia completa sin fallar',
            sello: 'COMPLETA', tono: 'bien',
          });
        }
        return;
      }

      /* Fallo: sacudida, pad en rojo y un vistazo a la luz correcta. */
      cerrando = true;
      etapa = 'fin';
      son('mal');
      p.classList.add('mm__pad--mal');
      mm.classList.add('mm--fallo');
      anima(mm, [
        { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' },
        { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' },
      ], 280, 'ease-out');
      fase.textContent = 'ERA ESTA';
      c.espera(() => prende(seq[paso], 320, 'mm__pad--correcto'), 220);
      c.espera(() => prende(seq[paso], 320, 'mm__pad--correcto'), 640);
      c.espera(() => enviar(paso * 1000000 - 999999, {
        cifra: paso, unidad: 'de ' + PASOS, titulo: 'Fallaste en el paso ' + (paso + 1),
        sello: 'FALLASTE', tono: 'mal',
      }), 1050);
    };

    pads.forEach((p) => {
      c.escucha(p, 'pointerdown', (e) => tocar(e, p));
      c.escucha(p, 'keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') tocar(e, p); });
    });

    return () => {
      const PASO_MS = 640;
      const ARRANQUE = 480;

      seq.forEach((n, i) => c.espera(() => {
        prende(n, 420);
        marcaPunto(i, 'mm__punto--visto');
      }, ARRANQUE + i * PASO_MS));

      const finMira = ARRANQUE + PASOS * PASO_MS + 220;

      c.espera(() => {
        etapa = 'repite';
        inicio = performance.now();
        fase.textContent = 'REPITE';
        mm.classList.add('mm--repite');
        puntos.forEach((p) => { p.className = 'mm__punto'; });
        son('turno');
        anima(fase, [{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], 320);
        /* La ventana total (21 s) es la misma de siempre; la barra sólo la muestra. */
        cronometro(api, 21000 - finMira, () => {
          if (cerrando) return;
          etapa = 'fin';
          son('mal');
          enviar(paso * 1000000 - 999998, {
            cifra: paso, unidad: 'de ' + PASOS, titulo: 'Se acabó el tiempo',
            sello: 'TIEMPO', tono: 'mal',
          });
        });
      }, finMira);
    };
  },

  /* --------------------- CAZAMONEDAS --------------------- */
  monedas(api) {
    const { zona, crono, R, def, enviar, c } = api;
    const TOTAL = 14;
    const AVISO = 320;      // el aro se cierra antes de que la moneda exista
    const VIVA = 1000;      // tiempo cazable
    const CAIDA = 420;      // se escapa y se desvanece

    zona.innerHTML = `
      <div class="cz">
        <div class="cz__mesa">
          <div class="cz__campo"></div>
          <div class="cz__flotantes" aria-hidden="true"></div>
        </div>
        <p class="cz__hud">
          ${ico('monedas', 'cz__ico')}
          <span class="cz__num">0</span><span class="cz__de">/ ${TOTAL}</span>
          <span class="cz__combo"></span>
        </p>
      </div>`;

    const mesa = zona.querySelector('.cz__mesa');
    const campo = zona.querySelector('.cz__campo');
    const flotantes = zona.querySelector('.cz__flotantes');
    const marcador = zona.querySelector('.cz__num');
    const combo = zona.querySelector('.cz__combo');
    const lienzo = crearLienzo(mesa, c);
    const par = crearParticulas(lienzo, c);

    let n = 0;
    let racha = 0;
    let ultima = 0;

    crono.textContent = 'Vigila la mesa';

    const flotante = (x, y, txt, cls) => {
      const s = document.createElement('span');
      s.className = 'cz__flota ' + (cls || '');
      s.textContent = txt;
      s.style.left = x + '%';
      s.style.top = y + '%';
      flotantes.appendChild(s);
      c.espera(() => s.remove(), 800);
    };

    /* Posiciones y tiempos deterministas: los 4 ven las mismas monedas. */
    for (let i = 0; i < TOTAL; i++) {
      const x = 9 + R() * 78;
      const y = 12 + R() * 70;
      const cuando = 260 + i * ((def.dur - 1700) / TOTAL) + R() * 130;

      c.espera(() => {
        const m = document.createElement('button');
        m.className = 'cz-moneda cz-moneda--aviso';
        m.type = 'button';
        m.style.left = x + '%';
        m.style.top = y + '%';
        m.setAttribute('aria-label', 'Atrapar moneda');
        m.innerHTML = `
          <span class="cz-moneda__aro"></span>
          <span class="cz-moneda__sombra"></span>
          <span class="cz-moneda__disco">${ico('moneda', 'cz-moneda__ico')}</span>`;
        campo.appendChild(m);

        let viva = false;
        c.espera(() => {
          m.classList.remove('cz-moneda--aviso');
          m.classList.add('cz-moneda--viva');
          viva = true;
        }, AVISO);

        c.escucha(m, 'pointerdown', (e) => {
          e.preventDefault();
          if (!viva) return;
          viva = false;
          n++;
          marcador.textContent = n;
          son('moneda');

          const ahora = performance.now();
          racha = ahora - ultima < 900 ? racha + 1 : 1;
          ultima = ahora;

          const p = lienzo.local(m);
          par.anillo(p.x, p.y, '#ffd76a', 12, 46, 0.4, 4);
          par.chispas(p.x, p.y, 16 + racha * 2, '#ffd76a', 1 + racha * 0.12);
          flotante(x, y, racha >= 2 ? '+1  x' + racha : '+1', racha >= 2 ? 'cz__flota--combo' : '');

          if (racha >= 2) {
            combo.textContent = 'x' + racha;
            combo.classList.add('cz__combo--vivo');
            anima(combo, [{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], 260);
          }
          anima(marcador, [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], 220);
          m.remove();
        });

        /* Se escapa: cae, se apaga y corta la racha. */
        c.espera(() => {
          if (!m.isConnected) return;
          viva = false;
          m.classList.add('cz-moneda--cae');
          racha = 0;
          combo.classList.remove('cz__combo--vivo');
          c.espera(() => m.remove(), CAIDA);
        }, AVISO + VIVA);
      }, cuando);
    }

    return () => {
      zona.querySelector('.cz').classList.add('cz--vivo');
      cronometro(api, def.dur, () => {
        const titulo =
          n <= 3 ? 'Se te escaparon casi todas' :
          n <= 7 ? 'Te faltó vista' :
          n <= 11 ? 'Buena mano' : 'Barriste la mesa';
        son(n >= 8 ? 'bien' : 'selec');
        enviar(n, {
          cifra: n, unidad: 'de ' + TOTAL, titulo,
          sello: 'TIEMPO', tono: 'bien',
        });
      });
    };
  },
};
