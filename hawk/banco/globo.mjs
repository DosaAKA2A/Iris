#!/usr/bin/env node
/* HAWK — globo en proyeccion ortografica.
   ---------------------------------------------------------------------------
   Las costas de costas.mjs son un plano (equirectangular): valen para mapas,
   pero puestas en un circulo se ven mal, porque la Tierra no es un poster.
   Aqui se proyecta de verdad: se mira el planeta desde fuera, se descarta la
   cara oculta y se recortan los trozos que cruzan el borde.

   Uso:  node globo.mjs [lon0] [lat0] [salida.svg]
         node globo.mjs -40 18            (Atlantico: America, Africa y Europa)

   Sale a ../assets/globo.svg, viewBox -100 -100 200 200 y radio 100.
*/
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTE = path.join(AQUI, 'datos', 'paises.geojson');

const LON0 = Number(process.argv[2] ?? -40);
const LAT0 = Number(process.argv[3] ?? 18);
const SALIDA = path.join(AQUI, '..', 'assets', process.argv[4] || 'globo.svg');

const R = 100;
const AREA_MINIMA = 6;      // el globo es pequeño: las islas chicas sobran
const TOLERANCIA = 0.8;

if (!existsSync(FUENTE)) {
  console.error('Falta datos/paises.geojson. Lanza antes:  node construir.js --resumen');
  process.exit(1);
}

const rad = (g) => (g * Math.PI) / 180;
const l0 = rad(LON0), f0 = rad(LAT0);

/* Ortografica. Devuelve null si el punto cae en la cara oculta. */
function proyecta([lon, lat]) {
  const l = rad(lon), f = rad(lat);
  const cosc = Math.sin(f0) * Math.sin(f) + Math.cos(f0) * Math.cos(f) * Math.cos(l - l0);
  if (cosc < 0) return null;                       // al otro lado del planeta
  return [
    R * Math.cos(f) * Math.sin(l - l0),
    -R * (Math.cos(f0) * Math.sin(f) - Math.sin(f0) * Math.cos(f) * Math.cos(l - l0)),
  ];
}

function alSegmento([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  if (!dx && !dy) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

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

for (const f of geo.features) {
  const g = f.geometry;
  if (!g) continue;
  const piezas = g.type === 'Polygon' ? [g.coordinates]
    : g.type === 'MultiPolygon' ? g.coordinates : [];

  for (const pieza of piezas) {
    const contorno = pieza[0];
    if (areaBbox(contorno) < AREA_MINIMA) continue;
    const suave = simplifica(contorno, TOLERANCIA);

    /* Un contorno puede entrar y salir de la cara visible. Se parte en tramos
       y cada tramo va como una figura suelta. */
    let tramo = [];
    for (const p of suave) {
      const xy = proyecta(p);
      if (xy) { tramo.push(xy); continue; }
      if (tramo.length > 2) trozos.push(tramo);
      tramo = [];
    }
    if (tramo.length > 2) trozos.push(tramo);
  }
}

const d = trozos
  .map((t) => 'M' + t.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z')
  .join('');

await writeFile(SALIDA,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-${R} -${R} ${R * 2} ${R * 2}" fill="none">\n`
  + `  <path id="globo" d="${d}" fill="currentColor"/>\n</svg>\n`);

console.log(`centro ${LON0}, ${LAT0} | ${trozos.length} tramos visibles`);
console.log(`${d.length.toLocaleString('es')} caracteres | ${path.relative(process.cwd(), SALIDA)}`);
