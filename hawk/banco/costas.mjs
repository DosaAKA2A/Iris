#!/usr/bin/env node
/* HAWK — costas del mundo a un trazado SVG.
   ---------------------------------------------------------------------------
   Saca las lineas de costa de Natural Earth (las mismas que ya usa el banco)
   a un unico path en proyeccion equirectangular, con viewBox 0 0 360 180: la
   longitud entra tal cual y la latitud se invierte.

   La gracia de ese encuadre es que recortar un continente no cuesta nada: el
   trazado se pinta una sola vez en la pagina y cada tarjeta lo referencia con
   su propio viewBox. Europa es "150 20 60 45" y ya esta.

   Uso:  node costas.mjs [tolerancia] [area-minima]
         node costas.mjs 0.6 2.5    (por defecto: para tarjetas)
         node costas.mjs 0.25 0.9   (mas fino, para laminas grandes)

   Sale a ../assets/mundo.svg. Necesita datos/paises.geojson, que baja solo la
   primera vez que se ejecuta construir.js.
*/
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTE = path.join(AQUI, 'datos', 'paises.geojson');
const SALIDA = path.join(AQUI, '..', 'assets', 'mundo.svg');

const TOLERANCIA = Number(process.argv[2]) || 0.6;   // grados
const AREA_MINIMA = Number(process.argv[3]) || 2.5;  // grados cuadrados

if (!existsSync(FUENTE)) {
  console.error('Falta datos/paises.geojson. Lanza antes:  node construir.js --resumen');
  process.exit(1);
}

/* Distancia de un punto al segmento a-b. */
function alSegmento([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  if (!dx && !dy) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/* Douglas-Peucker: tira los vertices que no cambian la silueta. */
function simplifica(pts, tol) {
  if (pts.length < 4) return pts;
  let peor = 0, corte = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = alSegmento(pts[i], pts[0], pts[pts.length - 1]);
    if (d > peor) { peor = d; corte = i; }
  }
  if (peor <= tol) return [pts[0], pts[pts.length - 1]];
  return [
    ...simplifica(pts.slice(0, corte + 1), tol).slice(0, -1),
    ...simplifica(pts.slice(corte), tol),
  ];
}

const areaBbox = (pts) => {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return (x1 - x0) * (y1 - y0);
};

const geo = JSON.parse(await readFile(FUENTE, 'utf8'));
const trozos = [];
let anillos = 0;

for (const f of geo.features) {
  const g = f.geometry;
  if (!g) continue;
  const piezas = g.type === 'Polygon' ? [g.coordinates]
    : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const pieza of piezas) {
    const contorno = pieza[0];
    if (areaBbox(contorno) < AREA_MINIMA) continue;      // isla invisible a este tamaño
    const s = simplifica(contorno, TOLERANCIA);
    if (s.length < 4) continue;
    anillos++;
    trozos.push('M' + s.map(([lon, lat]) =>
      `${(lon + 180).toFixed(1)} ${(90 - lat).toFixed(1)}`).join('L') + 'Z');
  }
}

const d = trozos.join('');
await writeFile(SALIDA,
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180" fill="none">\n'
  + `  <path id="costas" d="${d}" fill="currentColor"/>\n</svg>\n`);

console.log(`tolerancia ${TOLERANCIA}, area minima ${AREA_MINIMA}`);
console.log(`${anillos} anillos | ${d.length.toLocaleString('es')} caracteres de trazado`);
console.log(`escrito en ${path.relative(process.cwd(), SALIDA)}`);
