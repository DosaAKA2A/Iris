/* QUIEBRA — servidor de partidas en Cloudflare Workers
   ---------------------------------------------------------------------------
   Un Durable Object (SQLite) por sala: idFromName(código). El servidor es la
   única autoridad: dados, cartas, rentas, rankings de minijuego y timers.
   Los sockets usan la API de hibernación; el estado vive en ctx.storage y se
   recarga bajo demanda, así la partida sobrevive a hibernaciones y deploys.
   Los timers (anti-AFK, deadline de minijuego, limpieza) usan alarms.

   Desplegar:  npx wrangler deploy   (desde quiebra/worker/)
   Salud:      GET /health -> "ok"
   Sala nueva: GET /new    -> {"sala":"ABCD"}
*/
import {
  CONFIG, CASILLAS, PERSONAJES, CARTAS, MINIJUEGOS, rentaDe, patrimonio,
} from '../shared/data.js';

const MAX_MSG = 16 * 1024;
const TILE_SIESTA = 6, TILE_BACHE = 10;
const LIMPIEZA_MS = 2 * 60 * 60 * 1000;   // sala sin actividad 2 h -> se borra
const AFK_OFFLINE_MS = 3000;              // turno de un desconectado: resolución rápida

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok', { headers: CORS });
    if (url.pathname === '/new') {
      const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O: se confunden con 1 y 0
      let code = '';
      for (let i = 0; i < 4; i++) code += abc[Math.floor(Math.random() * abc.length)];
      return new Response(JSON.stringify({ sala: code }),
        { headers: { 'Content-Type': 'application/json', ...CORS } });
    }
    if (url.pathname === '/ws') {
      const code = String(url.searchParams.get('sala') || '').toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) return new Response('sala invalida', { status: 400 });
      return env.SALA.get(env.SALA.idFromName(code)).fetch(request);
    }
    return new Response('QUIEBRA server — iris.it.com/quiebra/', { headers: CORS });
  },
};

export class Sala {
  constructor(ctx) {
    this.ctx = ctx;
    this.g = null;       // estado de la partida (se carga perezoso desde storage)
    this.tokens = null;  // token secreto -> pid (nunca viaja en el estado)
  }

  /* ------------------------------ estado ------------------------------ */

  async load() {
    if (!this.g) {
      this.g = (await this.ctx.storage.get('g')) || null;
      this.tokens = (await this.ctx.storage.get('tokens')) || {};
    }
  }

  async save() {
    this.g.lastActive = Date.now();
    await this.ctx.storage.put('g', this.g);
    await this.ctx.storage.put('tokens', this.tokens);
    await this.programarAlarma();
  }

  nuevoJuego(code) {
    return {
      code, phase: 'lobby', hostId: null,
      players: [],           // {id,name,char,cash,pos,cards,trophies,frozen,seguro,lona,online}
      turnIdx: 0, round: 1, maxRounds: CONFIG.RONDAS_DEF,
      bote: 0, props: {},
      turn: null,            // {awaiting,dice,trick,cardPlayed,reformado,canBuy,deadline}
      mini: null,            // {kind,seed,deadline,results,porJugador}
      lastMini: null,
      seq: 0, log: [],
      lastActive: Date.now(),
    };
  }

  logea(txt) {
    this.g.seq++;
    this.g.log.push({ s: this.g.seq, txt });
    if (this.g.log.length > 40) this.g.log.shift();
  }

  /* ------------------------------ sockets ------------------------------ */

  async fetch(request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  meta(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch { /* socket muerto */ } }

  socketsDe(pid) {
    return this.ctx.getWebSockets().filter((w) => this.meta(w).pid === pid);
  }

  /* Estado personalizado: cada jugador ve su mano; de los demás, solo cuántas. */
  vista(pid) {
    const g = this.g;
    return {
      ...g,
      players: g.players.map((p) => p.id === pid
        ? p
        : { ...p, cards: p.cards.length }),
    };
  }

  broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      const m = this.meta(ws);
      if (m.pid) this.send(ws, { t: 'state', you: m.pid, g: this.vista(m.pid) });
    }
  }

  fx(obj) {
    const str = JSON.stringify({ t: 'fx', ...obj });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(str); } catch { /* nada */ }
    }
  }

  err(ws, msg) { this.send(ws, { t: 'err', msg }); }

  /* ------------------------------ mensajes ------------------------------ */

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > MAX_MSG) return;
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    await this.load();

    if (m.t === 'join') return this.onJoin(ws, m);

    const meta = this.meta(ws);
    if (!meta.pid || !this.g) return;
    const pl = this.g.players.find((p) => p.id === meta.pid);
    if (!pl) return;

    const H = {
      pick: () => this.onPick(pl, m),
      config: () => this.onConfig(pl, m),
      start: () => this.onStart(pl),
      card: () => this.onCard(pl, m),
      roll: () => this.onRoll(pl),
      buy: () => this.onBuy(pl, true),
      skipbuy: () => this.onBuy(pl, false),
      reforma: () => this.onReforma(pl, m),
      mudanza: () => this.onMudanza(pl, m),
      fin: () => this.onFin(pl),
      mg: () => this.onScore(pl, m),
      chatq: () => this.fx({ kind: 'chat', pid: pl.id, id: String(m.id || '').slice(0, 24) }),
      react: () => this.fx({ kind: 'react', pid: pl.id, id: String(m.id || '').slice(0, 24) }),
    };
    if (H[m.t]) { await H[m.t](); await this.save(); this.broadcast(); }
  }

  async onJoin(ws, m) {
    const code = String(m.sala || '').toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) return this.err(ws, 'Código de sala inválido.');
    if (!this.g) this.g = this.nuevoJuego(code);
    const g = this.g;
    const token = String(m.token || '').slice(0, 64);
    const name = String(m.name || 'anon').trim().slice(0, 14) || 'anon';
    if (!token) return this.err(ws, 'Falta el token.');

    let pid = this.tokens[token];
    let pl = pid && g.players.find((p) => p.id === pid);

    if (!pl) {
      if (g.phase !== 'lobby') return this.err(ws, 'La partida ya empezó.');
      if (g.players.length >= 4) return this.err(ws, 'Sala llena (4 jugadores).');
      pid = 'p' + (g.seq + 1) + Math.floor(Math.random() * 1000);
      pl = {
        id: pid, name, char: null, cash: CONFIG.START_CASH, pos: 0,
        cards: [], trophies: 0, frozen: 0, seguro: false, lona: false, online: true,
      };
      g.players.push(pl);
      this.tokens[token] = pid;
      if (!g.hostId) g.hostId = pid;
      this.logea(`${name} entró a la sala.`);
    } else {
      pl.online = true; // conserva su nombre original: es la misma persona
      this.logea(`${pl.name} volvió.`);
    }
    ws.serializeAttachment({ pid: pl.id });
    await this.save();
    this.broadcast();
  }

  onPick(pl, m) {
    const g = this.g;
    if (g.phase !== 'lobby') return;
    const c = String(m.char || '');
    if (!PERSONAJES[c]) return;
    if (g.players.some((p) => p.char === c && p.id !== pl.id)) return;
    pl.char = c;
    this.logea(`${pl.name} será ${PERSONAJES[c].nombre}.`);
  }

  onConfig(pl, m) {
    const g = this.g;
    if (g.phase !== 'lobby' || pl.id !== g.hostId) return;
    const r = Number(m.rounds);
    if (CONFIG.RONDAS.includes(r)) g.maxRounds = r;
  }

  onStart(pl) {
    const g = this.g;
    if (g.phase !== 'lobby' || pl.id !== g.hostId) return;
    if (g.players.length < 2) return this.logea('Hacen falta al menos 2 jugadores.');
    if (g.players.some((p) => !p.char)) return this.logea('Todos deben elegir personaje.');
    // Orden de juego al azar
    for (let i = g.players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [g.players[i], g.players[j]] = [g.players[j], g.players[i]];
    }
    g.phase = 'turn';
    g.turnIdx = 0; g.round = 1;
    this.iniciarTurno();
    this.logea(`Empieza la partida a ${g.maxRounds} rondas. Abre ${g.players[0].name}.`);
    this.fx({ kind: 'start' });
  }

  /* ------------------------------ turnos ------------------------------ */

  actual() { return this.g.players[this.g.turnIdx]; }

  deadline(pl) {
    return Date.now() + (pl && !pl.online ? AFK_OFFLINE_MS : CONFIG.TURNO_MS);
  }

  iniciarTurno() {
    const g = this.g;
    const pl = this.actual();
    g.turn = {
      awaiting: 'roll', dice: null, trick: null, cardPlayed: false,
      reformado: false, canBuy: null, deadline: this.deadline(pl),
    };
  }

  onCard(pl, m) {
    const g = this.g;
    if (g.phase !== 'turn' || this.actual().id !== pl.id) return;
    if (g.turn.awaiting !== 'roll' || g.turn.cardPlayed) return;
    const id = String(m.id || '');
    const i = pl.cards.indexOf(id);
    if (i < 0 || !CARTAS[id]) return;

    const rivales = g.players.filter((p) => p.id !== pl.id && !p.lona);
    const conSeguro = (obj) => {
      if (obj.seguro) {
        obj.seguro = false;
        this.logea(`El SEGURO de ${obj.name} anuló la carta de ${pl.name}.`);
        return true;
      }
      return false;
    };

    if (id === 'dado') {
      const v = Math.max(2, Math.min(12, Number(m.value) || 7));
      g.turn.trick = v;
      this.logea(`${pl.name} jugó DADO TRUCADO: sacará ${v}.`);
    } else if (id === 'mudanzaf') {
      const t = rivales.find((p) => p.id === m.target);
      if (!t) return;
      if (!conSeguro(t)) {
        t.pos = TILE_BACHE;
        this.pagar(t, 'bote', CONFIG.BACHE_MULTA);
        this.logea(`${pl.name} mandó a ${t.name} a EL BACHE.`);
      }
    } else if (id === 'congelado') {
      pl.frozen = g.round + 1;
      this.logea(`${pl.name} congeló sus alquileres por una ronda.`);
    } else if (id === 'imprev') {
      const rico = rivales.slice().sort((a, b) => b.cash - a.cash)[0];
      if (!rico) return;
      if (!conSeguro(rico)) {
        const monto = Math.round(rico.cash * 0.15);
        this.pagar(rico, pl, monto);
        this.logea(`${pl.name} le expropió $${monto} a ${rico.name}.`);
      }
    } else if (id === 'okupa') {
      const idx = Number(m.target);
      const prop = g.props[idx];
      const dueno = prop && prop.owner && g.players.find((p) => p.id === prop.owner);
      if (!dueno || dueno.id === pl.id) return;
      if (!conSeguro(dueno)) {
        prop.okupa = pl.id;
        this.logea(`${pl.name} okupó ${CASILLAS[idx].nombre}: la próxima renta es suya.`);
      }
    } else if (id === 'seguro') {
      pl.seguro = true;
      this.logea(`${pl.name} contrató un SEGURO.`);
    } else return;

    pl.cards.splice(i, 1);
    g.turn.cardPlayed = true;
    this.fx({ kind: 'card', pid: pl.id, id });
  }

  onRoll(pl) {
    const g = this.g;
    if (g.phase !== 'turn' || this.actual().id !== pl.id || g.turn.awaiting !== 'roll') return;
    let d1, d2;
    if (g.turn.trick) {
      const v = g.turn.trick;
      d1 = Math.min(6, Math.max(1, v - 6 + Math.floor(Math.random() * 3)));
      if (v - d1 < 1 || v - d1 > 6) d1 = Math.max(1, v - 6);
      d2 = v - d1;
    } else {
      d1 = 1 + Math.floor(Math.random() * 6);
      d2 = 1 + Math.floor(Math.random() * 6);
    }
    g.turn.dice = [d1, d2];
    this.fx({ kind: 'dice', pid: pl.id, dice: [d1, d2] });
    this.mover(pl, d1 + d2);
  }

  mover(pl, pasos) {
    const g = this.g;
    const desde = pl.pos;
    pl.pos = (pl.pos + pasos) % 24;
    if (pl.pos < desde || pasos >= 24) {
      const pago = pl.char === 'rata' ? 280 : CONFIG.SALIDA_PAGO;
      pl.cash += pago;
      this.logea(`${pl.name} pasó por SALIDA y cobró $${pago}.`);
    }
    this.resolver(pl);
  }

  resolver(pl) {
    const g = this.g;
    const c = CASILLAS[pl.pos];

    // POLILLA roba al caer sobre rivales
    if (pl.char === 'polilla') {
      for (const r of g.players) {
        if (r.id !== pl.id && !r.lona && r.pos === pl.pos) {
          this.pagar(r, pl, 40);
          this.logea(`${pl.name} (POLILLA) le robó $40 a ${r.name}.`);
        }
      }
    }

    if (c.t === 'negocio') {
      const prop = g.props[pl.pos];
      if (!prop || !prop.owner) {
        const precio = this.precioPara(pl, c.precio);
        if (pl.cash >= precio) {
          g.turn.awaiting = 'buy';
          g.turn.canBuy = pl.pos;
          g.turn.deadline = this.deadline(pl);
          return;
        }
        this.logea(`${pl.name} no puede pagar ${c.nombre} ($${precio}).`);
      } else if (prop.owner !== pl.id) {
        const dueno = g.players.find((p) => p.id === prop.owner);
        if (dueno && !dueno.lona) {
          if (pl.frozen >= g.round) {
            this.logea(`${pl.name} tiene el alquiler CONGELADO: no paga en ${c.nombre}.`);
          } else {
            const renta = rentaDe(g, pl.pos);
            let cobra = dueno;
            if (prop.okupa && prop.okupa !== prop.owner) {
              const ok = g.players.find((p) => p.id === prop.okupa);
              if (ok && !ok.lona) { cobra = ok; this.logea(`El OKUPA cobra esta renta.`); }
              prop.okupa = null;
            }
            this.pagar(pl, cobra, renta);
            this.logea(`${pl.name} pagó $${renta} de renta en ${c.nombre} a ${cobra.name}.`);
          }
        }
      }
    } else if (c.t === 'azar') {
      this.robarCarta(pl);
      if (pl.char === 'polilla' && Math.random() < 0.25) {
        this.logea(`${pl.name} (POLILLA) mete la mano dos veces.`);
        this.robarCarta(pl);
      }
    } else if (c.t === 'mini') {
      this.iniciarMini();
      return;
    } else if (c.t === 'bache') {
      this.pagar(pl, 'bote', CONFIG.BACHE_MULTA);
      this.logea(`${pl.name} cayó en EL BACHE: $${CONFIG.BACHE_MULTA} al bote.`);
    } else if (c.t === 'bote') {
      if (g.bote > 0) {
        pl.cash += g.bote;
        this.logea(`${pl.name} se llevó EL BOTE: $${g.bote}.`);
        this.fx({ kind: 'bote', pid: pl.id, monto: g.bote });
        g.bote = 0;
      } else this.logea(`${pl.name} encontró EL BOTE vacío.`);
    } else if (c.t === 'impuestos') {
      const monto = Math.max(CONFIG.IMPUESTO_MIN, Math.round(pl.cash * CONFIG.IMPUESTO_PCT));
      this.pagar(pl, 'bote', monto);
      this.logea(`${pl.name} pagó $${monto} de IMPUESTOS (van al bote).`);
    } else if (c.t === 'mudanza') {
      g.turn.awaiting = 'mudanza';
      g.turn.deadline = this.deadline(pl);
      return;
    } else if (c.t === 'siesta') {
      this.logea(`${pl.name} se echa una SIESTA.`);
    }

    if (pl.lona) return this.siguienteTurno(); // quebró en su propio turno
    g.turn.awaiting = 'fin';
    g.turn.deadline = this.deadline(pl);
  }

  precioPara(pl, precio) {
    return Math.round(precio * (pl.char === 'pulpo' ? 0.85 : 1));
  }

  robarCarta(pl) {
    const g = this.g;
    const ids = Object.keys(CARTAS);
    const pesoTotal = ids.reduce((s, k) => s + CARTAS[k].peso, 0);
    let r = Math.random() * pesoTotal, id = ids[0];
    for (const k of ids) { r -= CARTAS[k].peso; if (r <= 0) { id = k; break; } }
    const c = CARTAS[id];

    if (c.inst) {
      if (id === 'propina') { pl.cash += 120; this.logea(`AZAR: ${pl.name} recibe PROPINA de $120.`); }
      else if (id === 'multa') { this.pagar(pl, 'bote', 80); this.logea(`AZAR: ${pl.name} paga MULTA de $80.`); }
      else if (id === 'cumple') {
        this.logea(`AZAR: hoy es el CUMPLEAÑOS de ${pl.name}.`);
        for (const r2 of g.players) if (r2.id !== pl.id && !r2.lona) this.pagar(r2, pl, 40);
      } else if (id === 'apagon') {
        pl.pos = TILE_SIESTA;
        this.logea(`AZAR: APAGÓN. ${pl.name} amanece en SIESTA.`);
      }
      this.fx({ kind: 'azar', pid: pl.id, id });
    } else if (pl.cards.length < CONFIG.MANO_MAX) {
      pl.cards.push(id);
      this.logea(`${pl.name} robó una carta de AZAR.`);
      this.fx({ kind: 'azar', pid: pl.id, id: 'mano' });
    } else {
      this.logea(`${pl.name} tiene la mano llena: la carta se descarta.`);
    }
  }

  onBuy(pl, compra) {
    const g = this.g;
    if (g.phase !== 'turn' || this.actual().id !== pl.id || g.turn.awaiting !== 'buy') return;
    const idx = g.turn.canBuy;
    const c = CASILLAS[idx];
    if (compra) {
      const precio = this.precioPara(pl, c.precio);
      if (pl.cash >= precio) {
        pl.cash -= precio;
        g.props[idx] = { owner: pl.id, reforma: false, okupa: null };
        this.logea(`${pl.name} compró ${c.nombre} por $${precio}.`);
        this.fx({ kind: 'buy', pid: pl.id, tile: idx });
      }
    } else this.logea(`${pl.name} no quiso ${c.nombre}.`);
    g.turn.canBuy = null;
    g.turn.awaiting = 'fin';
    g.turn.deadline = this.deadline(pl);
  }

  onReforma(pl, m) {
    const g = this.g;
    if (g.phase !== 'turn' || this.actual().id !== pl.id) return;
    if (g.turn.awaiting !== 'fin' || g.turn.reformado) return;
    const idx = Number(m.tile);
    const c = CASILLAS[idx]; const prop = g.props[idx];
    if (!c || c.t !== 'negocio' || !prop || prop.owner !== pl.id || prop.reforma) return;
    const costo = this.precioPara(pl, Math.round(c.precio * CONFIG.REFORMA_PCT));
    if (pl.cash < costo) return;
    pl.cash -= costo;
    prop.reforma = true;
    g.turn.reformado = true;
    this.logea(`${pl.name} reformó ${c.nombre} por $${costo}: renta ×2.5.`);
    this.fx({ kind: 'reforma', pid: pl.id, tile: idx });
  }

  onMudanza(pl, m) {
    const g = this.g;
    if (g.phase !== 'turn' || this.actual().id !== pl.id || g.turn.awaiting !== 'mudanza') return;
    const idx = Number(m.tile);
    const c = CASILLAS[idx];
    if (!c || c.t !== 'negocio') return;
    const prop = g.props[idx];
    if (prop && prop.owner && prop.owner !== pl.id) return; // libre o tuyo
    pl.pos = idx;
    this.logea(`${pl.name} se mudó a ${c.nombre}.`);
    this.resolver(pl);
  }

  onFin(pl) {
    const g = this.g;
    if (g.phase !== 'turn' || this.actual().id !== pl.id || g.turn.awaiting === 'roll') return;
    if (g.turn.awaiting === 'buy') this.onBuy(pl, false);
    this.siguienteTurno();
  }

  siguienteTurno() {
    const g = this.g;
    const vivos = g.players.filter((p) => !p.lona);
    if (vivos.length <= 1) return this.terminar();
    let i = g.turnIdx;
    do {
      i = (i + 1) % g.players.length;
      if (i === 0) {
        g.round++;
        if (g.round > g.maxRounds) return this.terminar();
        this.logea(`— Ronda ${g.round} de ${g.maxRounds} —`);
      }
    } while (g.players[i].lona);
    g.turnIdx = i;
    this.iniciarTurno();
  }

  /* ------------------------------ dinero ------------------------------ */

  /* Cobra `monto` a `de`. `a` es un jugador, 'bote' o null (se esfuma).
     Si no alcanza, liquida reformas y negocios al 50%; si aún así no, quiebra. */
  pagar(de, a, monto) {
    const g = this.g;
    monto = Math.max(0, Math.round(monto));
    if (de.cash < monto) this.liquidar(de, monto);
    const pagado = Math.min(de.cash, monto);
    de.cash -= pagado;
    if (a === 'bote') g.bote += pagado;
    else if (a && a.cash !== undefined) a.cash += pagado;
    if (pagado < monto) this.quebrar(de);
    return pagado;
  }

  liquidar(pl, objetivo) {
    const g = this.g;
    const mias = Object.entries(g.props).filter(([, p]) => p.owner === pl.id);
    for (const [idx, p] of mias) {
      if (pl.cash >= objetivo) break;
      if (p.reforma) {
        const v = Math.round(CASILLAS[idx].precio * CONFIG.REFORMA_PCT * CONFIG.LIQUIDACION_PCT);
        p.reforma = false; pl.cash += v;
        this.logea(`${pl.name} malvendió la reforma de ${CASILLAS[idx].nombre} por $${v}.`);
      }
    }
    for (const [idx, p] of mias) {
      if (pl.cash >= objetivo) break;
      const v = Math.round(CASILLAS[idx].precio * CONFIG.LIQUIDACION_PCT);
      delete g.props[idx]; pl.cash += v;
      this.logea(`${pl.name} malvendió ${CASILLAS[idx].nombre} por $${v}.`);
    }
  }

  quebrar(pl) {
    const g = this.g;
    if (pl.lona) return;
    pl.lona = true; pl.cash = 0; pl.cards = [];
    for (const [idx, p] of Object.entries(g.props)) {
      if (p.owner === pl.id) delete g.props[idx];
    }
    this.logea(`${pl.name} QUEBRÓ. Queda en la lona mirando la partida.`);
    this.fx({ kind: 'quiebra', pid: pl.id });
  }

  /* ------------------------------ minijuegos ------------------------------ */

  iniciarMini() {
    const g = this.g;
    const kinds = Object.keys(MINIJUEGOS).filter((k) => k !== g.lastMini);
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    g.lastMini = kind;
    g.phase = 'mini';
    g.mini = {
      kind,
      seed: Math.floor(Math.random() * 0xffffffff),
      deadline: Date.now() + MINIJUEGOS[kind].dur + 9000, // 3 s de intro + margen
      results: {},
    };
    this.logea(`MINIJUEGO para todos: ${MINIJUEGOS[kind].nombre}.`);
    this.fx({ kind: 'mini', mini: kind });
  }

  onScore(pl, m) {
    const g = this.g;
    if (g.phase !== 'mini' || !g.mini || pl.lona) return;
    if (g.mini.results[pl.id] !== undefined) return; // solo un envío
    const s = Number(m.score);
    g.mini.results[pl.id] = Number.isFinite(s) ? Math.round(s) : 0;
    const vivos = g.players.filter((p) => !p.lona);
    if (vivos.every((p) => g.mini.results[p.id] !== undefined)) this.resolverMini();
  }

  resolverMini() {
    const g = this.g;
    if (!g.mini) return;
    const vivos = g.players.filter((p) => !p.lona);
    const orden = vivos.slice().sort((a, b) => {
      const sa = g.mini.results[a.id] ?? -1e15;
      const sb = g.mini.results[b.id] ?? -1e15;
      if (sb !== sa) return sb - sa;
      if (a.char === 'cabra') return -1;         // la CABRA gana los empates
      if (b.char === 'cabra') return 1;
      return a.id < b.id ? -1 : 1;
    });
    const podio = [];
    orden.forEach((p, i) => {
      let premio = CONFIG.MINI_PREMIOS[i] || 0;
      if (p.char === 'cabra') premio = Math.round(premio * 1.5);
      p.cash += premio;
      if (i === 0) p.trophies++;
      podio.push({ pid: p.id, name: p.name, score: g.mini.results[p.id] ?? null, premio });
    });
    this.logea(`Minijuego: gana ${orden[0].name} (+$${podio[0].premio} y trofeo).`);
    this.fx({ kind: 'podio', podio, mini: g.mini.kind });
    g.mini = null;
    g.phase = 'turn';
    g.turn.awaiting = 'fin';
    g.turn.deadline = this.deadline(this.actual());
  }

  /* ------------------------------ final ------------------------------ */

  terminar() {
    const g = this.g;
    g.phase = 'end';
    g.turn = null; g.mini = null;
    const tabla = g.players.map((p) => ({
      pid: p.id, name: p.name, char: p.char, lona: p.lona,
      patrimonio: p.lona ? 0 : patrimonio(g, p.id),
      trophies: p.trophies, cash: p.cash,
    })).sort((a, b) => b.patrimonio - a.patrimonio || b.trophies - a.trophies || b.cash - a.cash);
    g.final = tabla;
    this.logea(`FIN. Gana ${tabla[0].name} con un patrimonio de $${tabla[0].patrimonio}.`);
    this.fx({ kind: 'fin', tabla });
  }

  /* ------------------------------ timers ------------------------------ */

  async programarAlarma() {
    const g = this.g;
    let cuando = g.lastActive + LIMPIEZA_MS;
    if (g.phase === 'turn' && g.turn) cuando = g.turn.deadline;
    else if (g.phase === 'mini' && g.mini) cuando = g.mini.deadline;
    await this.ctx.storage.setAlarm(cuando);
  }

  async alarm() {
    await this.load();
    if (!this.g) return;
    const g = this.g;
    const now = Date.now();

    if (g.phase === 'mini' && g.mini && now >= g.mini.deadline) {
      this.resolverMini();
    } else if (g.phase === 'turn' && g.turn && now >= g.turn.deadline) {
      const pl = this.actual();
      if (g.turn.awaiting === 'roll') { this.logea(`${pl.name} tarda: el dado rueda solo.`); this.onRoll(pl); }
      else if (g.turn.awaiting === 'buy') this.onBuy(pl, false);
      else if (g.turn.awaiting === 'mudanza') { this.logea(`${pl.name} no se mudó.`); g.turn.awaiting = 'fin'; this.siguienteTurno(); }
      else this.siguienteTurno();
    } else if (now - g.lastActive >= LIMPIEZA_MS) {
      await this.ctx.storage.deleteAll();
      this.g = null; this.tokens = null;
      return;
    }
    await this.save();
    this.broadcast();
  }

  /* ------------------------------ cierres ------------------------------ */

  async webSocketClose(ws) { await this.despedir(ws); }
  async webSocketError(ws) { await this.despedir(ws); }

  async despedir(ws) {
    const m = this.meta(ws);
    if (!m.pid) return;
    await this.load();
    if (!this.g) return;
    ws.serializeAttachment({});
    if (this.socketsDe(m.pid).length > 0) return; // le queda otra pestaña
    const pl = this.g.players.find((p) => p.id === m.pid);
    if (!pl) return;
    if (this.g.phase === 'lobby') {
      this.g.players = this.g.players.filter((p) => p.id !== m.pid);
      for (const [tok, pid] of Object.entries(this.tokens)) if (pid === m.pid) delete this.tokens[tok];
      if (this.g.hostId === m.pid) this.g.hostId = this.g.players[0]?.id || null;
      this.logea(`${pl.name} se fue de la sala.`);
    } else {
      pl.online = false;
      this.logea(`${pl.name} se desconectó (su turno se juega solo).`);
      if (this.g.phase === 'turn' && this.actual()?.id === pl.id && this.g.turn) {
        this.g.turn.deadline = Math.min(this.g.turn.deadline, Date.now() + AFK_OFFLINE_MS);
      }
    }
    await this.save();
    this.broadcast();
  }
}
