/* MOOVIN — generador de QR minimo, sin dependencias.
   ---------------------------------------------------------------------------
   Solo hace falta para una cosa: pintar en la tele el enlace que abre el mando
   en el movil. Va vendorizado a proposito — un <script> a un CDN seria una
   peticion a un tercero desde el salon de casa, y ademas el QR dejaria de
   pintarse el dia que ese CDN caiga.

   Alcance deliberadamente corto: modo byte, nivel de correccion M y versiones
   1 a 9 (hasta 122 bytes). Un enlace de mando ocupa unos 32, asi que sobra.
   Si algun dia hace falta mas, se amplia la tabla BLOQUES.

   Uso:  MoovinQR.svg('https://moovin.live/mando/AB12CD', { borde: 2 })  */
(function () {
  'use strict';

  /* Bloques de datos y correccion por version, nivel M: [n bloques, total, datos].
     Sale de la tabla de caracteristicas de correccion de la norma. */
  var BLOQUES = {
    1: [[1, 26, 16]], 2: [[1, 44, 28]], 3: [[1, 70, 44]],
    4: [[2, 50, 32]], 5: [[2, 67, 43]], 6: [[4, 43, 27]],
    7: [[4, 49, 31]], 8: [[2, 60, 38], [2, 61, 39]], 9: [[3, 58, 36], [2, 59, 37]]
  };
  /* Centros de los patrones de alineacion. */
  var ALINEA = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46]
  };
  /* Bits sobrantes al final de la zona de datos. */
  var RESTO = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0 };

  /* --- Aritmetica en GF(256), el campo de Reed-Solomon --- */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function mul(a, b) { return (a && b) ? EXP[LOG[a] + LOG[b]] : 0; }

  /* Polinomio generador de grado n: el producto de (x - a^i). */
  function generador(n) {
    var g = [1], i, j, k;
    for (i = 0; i < n; i++) {
      var nueva = new Array(g.length + 1);
      for (k = 0; k < nueva.length; k++) nueva[k] = 0;
      for (j = 0; j < g.length; j++) {
        nueva[j] ^= g[j];
        nueva[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = nueva;
    }
    return g;
  }
  /* Division sintetica: el resto son las palabras de correccion. */
  function correccion(datos, n) {
    var g = generador(n), r = new Uint8Array(datos.length + n), i, j;
    r.set(datos);
    for (i = 0; i < datos.length; i++) {
      var c = r[i];
      if (!c) continue;
      for (j = 0; j <= n; j++) r[i + j] ^= mul(g[j], c);
    }
    return r.slice(datos.length);
  }

  /* --- BCH de la informacion de formato y de version --- */
  function bitsFormato(mascara) {
    var datos = (0 /* nivel M */ << 3) | mascara, r = datos << 10, i;
    for (i = 14; i >= 10; i--) if ((r >> i) & 1) r ^= 0x537 << (i - 10);
    return (((datos << 10) | r) ^ 0x5412) >>> 0;
  }
  function bitsVersion(v) {
    var r = v << 12, i;
    for (i = 17; i >= 12; i--) if ((r >> i) & 1) r ^= 0x1f25 << (i - 12);
    return ((v << 12) | r) >>> 0;
  }

  var MASCARAS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return ((i * j) % 2) + ((i * j) % 3) === 0; },
    function (i, j) { return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0; },
    function (i, j) { return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0; }
  ];

  /* La trama: ojos, separadores, tiempo, alineacion y las zonas reservadas.
     `fija` marca lo que NO puede llevar datos ni mascara. */
  function trama(v) {
    var n = 17 + 4 * v;
    var mod = new Uint8Array(n * n);
    var fija = new Uint8Array(n * n);
    var i, j, e, dy, dx;
    function pon(y, x, val) { mod[y * n + x] = val ? 1 : 0; fija[y * n + x] = 1; }

    var esquinas = [[0, 0], [0, n - 7], [n - 7, 0]];
    for (e = 0; e < 3; e++) {
      var oy = esquinas[e][0], ox = esquinas[e][1];
      for (i = -1; i <= 7; i++) for (j = -1; j <= 7; j++) {
        var y = oy + i, x = ox + j;
        if (y < 0 || x < 0 || y >= n || x >= n) continue;
        var dentro = i >= 0 && i <= 6 && j >= 0 && j <= 6;
        var anillo = dentro && (i === 0 || i === 6 || j === 0 || j === 6);
        var centro = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        pon(y, x, anillo || centro);
      }
    }
    for (i = 8; i < n - 8; i++) { pon(6, i, i % 2 === 0); pon(i, 6, i % 2 === 0); }

    var pos = ALINEA[v];
    for (i = 0; i < pos.length; i++) for (j = 0; j < pos.length; j++) {
      var cy = pos[i], cx = pos[j];
      if ((cy <= 8 && cx <= 8) || (cy <= 8 && cx >= n - 9) || (cy >= n - 9 && cx <= 8)) continue;
      for (dy = -2; dy <= 2; dy++) for (dx = -2; dx <= 2; dx++) {
        pon(cy + dy, cx + dx, Math.max(Math.abs(dy), Math.abs(dx)) !== 1);
      }
    }
    /* Reserva del formato: se rellena al final, ya con la mascara elegida.
       La segunda copia son ocho modulos en la fila 8 por la derecha y siete
       bajando por la columna 8; el (n-8, 8) de esa columna es el modulo que
       siempre va oscuro. */
    for (i = 0; i < 9; i++) { if (i !== 6) { pon(8, i, 0); pon(i, 8, 0); } }
    for (i = 0; i < 8; i++) { pon(8, n - 1 - i, 0); pon(n - 1 - i, 8, 0); }
    pon(n - 8, 8, 1);
    if (v >= 7) {
      var bv = bitsVersion(v);
      for (i = 0; i < 18; i++) {
        var b = (bv >> i) & 1, a = Math.floor(i / 3), c = i % 3;
        pon(n - 11 + c, a, b);
        pon(a, n - 11 + c, b);
      }
    }
    return { n: n, mod: mod, fija: fija };
  }

  /* Zigzag de dos columnas, de abajo a arriba, saltando la columna 6 (la
     linea de tiempo vertical). */
  function coloca(t, bits) {
    var n = t.n, k = 0, arriba = true, x, y, col, f, d;
    for (col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (f = 0; f < n; f++) {
        y = arriba ? n - 1 - f : f;
        for (d = 0; d < 2; d++) {
          x = col - d;
          if (t.fija[y * n + x]) continue;
          t.mod[y * n + x] = k < bits.length ? bits[k] : 0;
          k++;
        }
      }
      arriba = !arriba;
    }
  }

  function penaliza(t) {
    var n = t.n, mod = t.mod, total = 0, oscuros = 0, i, j;
    var fila = function (a, b) { return mod[a * n + b]; };
    var col = function (a, b) { return mod[b * n + a]; };
    /* 1: rachas de cinco o mas del mismo color. */
    function racha(get) {
      var p = 0, a, b, run, ant, c;
      for (a = 0; a < n; a++) {
        run = 1; ant = get(a, 0);
        for (b = 1; b < n; b++) {
          c = get(a, b);
          if (c === ant) run++;
          else { if (run >= 5) p += 3 + (run - 5); run = 1; ant = c; }
        }
        if (run >= 5) p += 3 + (run - 5);
      }
      return p;
    }
    total += racha(fila) + racha(col);
    /* 2: cuadrados de 2x2 del mismo color. */
    for (i = 0; i < n - 1; i++) for (j = 0; j < n - 1; j++) {
      var v0 = mod[i * n + j];
      if (v0 === mod[i * n + j + 1] && v0 === mod[(i + 1) * n + j] && v0 === mod[(i + 1) * n + j + 1]) total += 3;
    }
    /* 3: el patron que se confunde con un ojo. */
    var A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function busca(get) {
      var p = 0, a, b, k, c, okA, okB;
      for (a = 0; a < n; a++) for (b = 0; b + 11 <= n; b++) {
        okA = true; okB = true;
        for (k = 0; k < 11; k++) {
          c = get(a, b + k);
          if (c !== A[k]) okA = false;
          if (c !== B[k]) okB = false;
        }
        if (okA) p += 40;
        if (okB) p += 40;
      }
      return p;
    }
    total += busca(fila) + busca(col);
    /* 4: desequilibrio entre claros y oscuros. */
    for (i = 0; i < mod.length; i++) if (mod[i]) oscuros++;
    total += 10 * Math.floor(Math.abs((oscuros * 100) / mod.length - 50) / 5);
    return total;
  }

  function ponFormato(t, mascara) {
    var n = t.n, f = bitsFormato(mascara), i, b;
    for (i = 0; i < 15; i++) {
      /* El primer modulo colocado lleva el bit MAS ALTO de los quince. */
      b = (f >> (14 - i)) & 1;
      /* Copia de la esquina de arriba a la izquierda. */
      if (i < 6) t.mod[8 * n + i] = b;
      else if (i === 6) t.mod[8 * n + 7] = b;
      else if (i === 7) t.mod[8 * n + 8] = b;
      else if (i === 8) t.mod[7 * n + 8] = b;
      else t.mod[(14 - i) * n + 8] = b;
      /* Copia repartida entre las otras dos esquinas. */
      if (i < 8) t.mod[(n - 1 - i) * n + 8] = b;
      else t.mod[8 * n + (n - 15 + i)] = b;
    }
    t.mod[(n - 8) * n + 8] = 1;
  }

  function aBytes(texto) {
    var s = unescape(encodeURIComponent(String(texto)));
    var b = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
    return b;
  }

  function matriz(texto) {
    var datos = aBytes(texto), v, grupos, capacidad = 0, i, j;
    for (v = 1; v <= 9; v++) {
      grupos = BLOQUES[v];
      capacidad = 0;
      for (i = 0; i < grupos.length; i++) capacidad += grupos[i][0] * grupos[i][2];
      if (4 + 8 + datos.length * 8 <= capacidad * 8) break;
    }
    if (v > 9) throw new Error('el texto no cabe en un QR de version 9');

    /* Flujo de bits: modo byte, longitud, datos, terminador y relleno. */
    var bits = [];
    function mete(val, n) { for (var b = n - 1; b >= 0; b--) bits.push((val >> b) & 1); }
    mete(4, 4);
    mete(datos.length, 8);
    for (i = 0; i < datos.length; i++) mete(datos[i], 8);
    var tope = capacidad * 8;
    for (i = 0; i < 4 && bits.length < tope; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var relleno = [0xec, 0x11], r = 0;
    while (bits.length < tope) { mete(relleno[r % 2], 8); r++; }
    var palabras = new Uint8Array(capacidad);
    for (i = 0; i < capacidad; i++) {
      var byte = 0;
      for (j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j];
      palabras[i] = byte;
    }

    /* Reparto en bloques y correccion de cada uno. */
    var bloquesDatos = [], bloquesEc = [], p = 0, nb, nTotal, nDatos, d;
    for (i = 0; i < grupos.length; i++) {
      nb = grupos[i][0]; nTotal = grupos[i][1]; nDatos = grupos[i][2];
      for (j = 0; j < nb; j++) {
        d = palabras.slice(p, p + nDatos); p += nDatos;
        bloquesDatos.push(d);
        bloquesEc.push(correccion(d, nTotal - nDatos));
      }
    }
    /* Entrelazado: primero los datos, luego la correccion. */
    var salida = [];
    function entrelaza(lista) {
      var largo = 0, a, b, c;
      for (a = 0; a < lista.length; a++) largo = Math.max(largo, lista[a].length);
      for (c = 0; c < largo; c++) for (b = 0; b < lista.length; b++) {
        if (c < lista[b].length) salida.push(lista[b][c]);
      }
    }
    entrelaza(bloquesDatos);
    entrelaza(bloquesEc);

    var flujo = [];
    for (i = 0; i < salida.length; i++) for (j = 7; j >= 0; j--) flujo.push((salida[i] >> j) & 1);
    for (i = 0; i < RESTO[v]; i++) flujo.push(0);

    /* Se prueban las ocho mascaras y gana la de menos penalizacion. */
    var mejor = null, mejorPuntos = Infinity, mejorMasc = 0, m, t, fn, puntos;
    for (m = 0; m < 8; m++) {
      t = trama(v);
      coloca(t, flujo);
      fn = MASCARAS[m];
      for (i = 0; i < t.n; i++) for (j = 0; j < t.n; j++) {
        if (!t.fija[i * t.n + j] && fn(i, j)) t.mod[i * t.n + j] ^= 1;
      }
      ponFormato(t, m);
      puntos = penaliza(t);
      if (puntos < mejorPuntos) { mejorPuntos = puntos; mejor = t; mejorMasc = m; }
    }
    return { n: mejor.n, mod: mejor.mod, version: v, mascara: mejorMasc };
  }

  /* SVG en una cadena: se pinta con innerHTML, no necesita canvas y asi
     tambien vale en la tele, donde el canvas va lento. */
  function svg(texto, op) {
    op = op || {};
    var q = matriz(texto), n = q.n, borde = op.borde === undefined ? 2 : op.borde;
    var lado = n + borde * 2, d = '', i, j, ini;
    for (i = 0; i < n; i++) {
      j = 0;
      while (j < n) {
        if (!q.mod[i * n + j]) { j++; continue; }
        ini = j;
        while (j < n && q.mod[i * n + j]) j++;
        d += 'M' + (ini + borde) + ' ' + (i + borde) + 'h' + (j - ini) + 'v1h-' + (j - ini) + 'z';
      }
    }
    return '<svg viewBox="0 0 ' + lado + ' ' + lado + '" width="100%" height="100%" '
      + 'shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">'
      + '<rect width="' + lado + '" height="' + lado + '" fill="' + (op.fondo || '#fff') + '"/>'
      + '<path d="' + d + '" fill="' + (op.tinta || '#000') + '"/></svg>';
  }

  window.MoovinQR = { matriz: matriz, svg: svg };
})();
