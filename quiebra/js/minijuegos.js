/* QUIEBRA — los 4 minijuegos. Corren en el cliente con la semilla del servidor:
   los 4 jugadores ven exactamente la misma partida. El score viaja al servidor,
   que rankea al vencer el deadline. Score: cuanto más alto, mejor. */

import { MINIJUEGOS, rng } from '../shared/data.js';
import { S } from './sonido.js';

export function jugarMini(caja, kind, seed, onScore) {
  const timers = [];
  let vivo = true;
  const later = (fn, ms) => { const id = setTimeout(() => { if (vivo) fn(); }, ms); timers.push(id); return id; };
  const limpiar = () => { vivo = false; timers.forEach(clearTimeout); };

  const def = MINIJUEGOS[kind];
  const R = rng(seed);
  let enviado = false;
  const enviar = (score, texto) => {
    if (enviado || !vivo) return;
    enviado = true;
    onScore(score);
    caja.querySelector('.mini__zona').innerHTML =
      `<div><p class="mini__marcador">${texto}</p><p class="mini__espera">Esperando a los demás…</p></div>`;
  };

  caja.innerHTML = `
    <p class="mini__label">Minijuego para todos</p>
    <h2 class="mini__titulo">${def.nombre}</h2>
    <p class="mini__desc">${def.desc}</p>
    <div class="mini__zona"><p class="mini__cuenta">3</p></div>
    <p class="mini__crono" id="mini-crono"></p>`;
  const zona = caja.querySelector('.mini__zona');
  const crono = caja.querySelector('#mini-crono');

  // Cuenta regresiva de 3 y arranca
  S.mini();
  const cuenta = zona.querySelector('.mini__cuenta');
  later(() => { cuenta.textContent = '2'; S.tic(); }, 800);
  later(() => { cuenta.textContent = '1'; S.tic(); }, 1600);
  later(() => { S.bien(); JUEGOS[kind]({ zona, crono, R, def, enviar, later, vivo: () => vivo }); }, 2400);

  return limpiar;
}

function cronometro(crono, ms, later, alFinal) {
  const fin = Date.now() + ms;
  const tick = () => {
    const falta = fin - Date.now();
    if (falta <= 0) { crono.textContent = '0.0 s'; alFinal(); return; }
    crono.textContent = (falta / 1000).toFixed(1) + ' s';
    later(tick, 100);
  };
  tick();
}

const JUEGOS = {
  /* --------------------- DUELO DE CLICS --------------------- */
  clics({ zona, crono, def, enviar, later }) {
    let n = 0;
    zona.innerHTML = `<button class="clics__boton" type="button">CLIC<br><span style="font-size:1.6em">0</span></button>`;
    const btn = zona.querySelector('button');
    const num = btn.querySelector('span');
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); n++; num.textContent = n; S.clic(); });
    cronometro(crono, def.dur, later, () => enviar(n, `${n} clics`));
  },

  /* --------------------- SEMÁFORO --------------------- */
  semaforo({ zona, crono, R, enviar, later }) {
    const espera = 2000 + Math.floor(R() * 4000); // 2–6 s, igual para los 4
    zona.innerHTML = `<button class="semaforo__luz semaforo__luz--roja" type="button" aria-label="Semáforo"></button>`;
    const luz = zona.querySelector('button');
    let verdeEn = 0;
    crono.textContent = 'Rojo…';
    later(() => {
      luz.classList.remove('semaforo__luz--roja');
      luz.classList.add('semaforo__luz--verde');
      verdeEn = performance.now();
      crono.textContent = 'VERDE';
      S.bien();
    }, espera);
    luz.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!verdeEn) { S.mal(); enviar(-1000000, 'Te adelantaste: descalificado'); return; }
      const ms = Math.round(performance.now() - verdeEn);
      S.moneda();
      enviar(-ms, `Reaccionaste en ${ms} ms`);
    });
    // Si nunca cliquea, el servidor lo puntúa como 0 ausente al vencer el plazo.
    later(() => enviar(-999000, 'No cliqueaste'), espera + 4000);
  },

  /* --------------------- MEMORIA --------------------- */
  memoria({ zona, crono, R, enviar, later }) {
    const seq = Array.from({ length: 6 }, () => Math.floor(R() * 4));
    zona.innerHTML = `<div class="memoria">${[0, 1, 2, 3].map((n) =>
      `<button class="memoria__pad" type="button" data-n="${n}" aria-label="Luz ${n + 1}"></button>`).join('')}</div>`;
    const pads = [...zona.querySelectorAll('.memoria__pad')];
    let fase = 'mira';    // mira -> repite
    let paso = 0;
    let inicio = 0;
    crono.textContent = 'Mira la secuencia…';

    const prende = (n, ms) => {
      pads[n].classList.add('on'); S.tic();
      later(() => pads[n].classList.remove('on'), ms - 80);
    };
    seq.forEach((n, i) => later(() => prende(n, 520), 500 + i * 560));
    later(() => {
      fase = 'repite';
      inicio = performance.now();
      crono.textContent = 'Repite la secuencia';
    }, 500 + seq.length * 560 + 200);

    pads.forEach((p) => p.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (fase !== 'repite') return;
      const n = Number(p.dataset.n);
      prende(n, 260);
      if (n === seq[paso]) {
        paso++;
        if (paso === seq.length) {
          const ms = Math.round(performance.now() - inicio);
          S.bien();
          enviar(paso * 1000000 - ms, `Secuencia completa en ${(ms / 1000).toFixed(1)} s`);
        }
      } else {
        S.mal();
        enviar(paso * 1000000 - 999999, `Fallaste en el paso ${paso + 1} (${paso} bien)`);
      }
    }));
    later(() => enviar(paso * 1000000 - 999998, `Se acabó el tiempo (${paso} bien)`), 21000);
  },

  /* --------------------- CAZAMONEDAS --------------------- */
  monedas({ zona, crono, R, def, enviar, later }) {
    let n = 0;
    zona.innerHTML = `<div class="monedas"></div>`;
    const campo = zona.querySelector('.monedas');
    const total = 14;
    for (let i = 0; i < total; i++) {
      const x = 6 + R() * 82;    // % dentro del campo
      const y = 6 + R() * 74;
      const cuando = 300 + i * ((def.dur - 1600) / total) + R() * 120;
      later(() => {
        const m = document.createElement('button');
        m.className = 'moneda';
        m.type = 'button';
        m.style.left = x + '%';
        m.style.top = y + '%';
        m.setAttribute('aria-label', 'Moneda');
        m.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          n++; S.moneda(); m.remove();
        }, { once: true });
        campo.appendChild(m);
        later(() => m.remove(), 1100);
      }, cuando);
    }
    cronometro(crono, def.dur, later, () => enviar(n, `${n} de ${total} monedas`));
  },
};
