/* HAWK — países: polígonos, punto-en-país y cupos.
   ---------------------------------------------------------------------------
   Los polígonos salen de Natural Earth (dominio público, escala 1:50m). Se
   bajan una sola vez a datos/ y se reutilizan; el repo no los versiona.

   Aquí se decide algo que manda mucho en el juego: el CUPO de cada país. La
   cobertura de Mapillary está brutalmente sesgada (Suecia o Alemania tienen
   más fotos que medio mundo junto), así que si dejáramos que el banco fuera
   proporcional a las fotos disponibles, el jugador aprendería a adivinar por
   dónde hay cobertura en vez de por lo que ve. El cupo lo aplana: cada país
   aporta un número acotado de puntos, con un empujón suave por superficie
   para que Rusia no valga lo mismo que Luxemburgo.
*/
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DATOS = path.join(AQUI, 'datos');
const CACHE = path.join(DATOS, 'paises.geojson');

const FUENTE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector'
  + '/master/geojson/ne_50m_admin_0_countries.geojson';

/* Cupo: entre 60 y 500 puntos por país. La raíz de la superficie comprime la
   escala (Rusia es 66.000 veces Malta, pero solo debe valer unas 8 veces más). */
const CUPO_MIN = 60;
const CUPO_MAX = 500;
const CUPO_BASE = 60;
const CUPO_AREA = 3.0;    // puntos por cada raíz de mil km²

export function cupoDe(areaKm2) {
  const extra = Math.sqrt(Math.max(areaKm2, 0) / 1000) * CUPO_AREA;
  return Math.round(Math.min(CUPO_MAX, Math.max(CUPO_MIN, CUPO_BASE + extra)));
}

/* ------------------------------ carga ------------------------------ */

export async function cargarPaises() {
  if (!existsSync(CACHE)) {
    await mkdir(DATOS, { recursive: true });
    process.stdout.write('Bajando polígonos de Natural Earth… ');
    const r = await fetch(FUENTE);
    if (!r.ok) throw new Error(`Natural Earth respondió ${r.status}`);
    await writeFile(CACHE, Buffer.from(await r.arrayBuffer()));
    process.stdout.write('listo\n');
  }
  const geo = JSON.parse(await readFile(CACHE, 'utf8'));

  const paises = [];
  for (const f of geo.features) {
    const p = f.properties;
    const iso = elegir(p.ISO_A2_EH, p.ISO_A2, p.WB_A2);
    if (!iso || iso === '-99') continue;                 // territorios sin código
    if (p.TYPE === 'Dependency' && !p.NAME_ES) continue;

    const anillos = aAnillos(f.geometry);
    if (!anillos.length) continue;

    paises.push({
      iso,
      nombre: elegir(p.NAME_ES, p.NAME_ES_ALT, p.NAME_LONG, p.NAME) || iso,
      continente: p.CONTINENT || '—',
      areaKm2: estimarArea(anillos),
      bbox: bboxDe(anillos),
      anillos,
    });
  }
  // Un mismo ISO puede venir partido en varias entradas; se funden.
  const porIso = new Map();
  for (const p of paises) {
    const ya = porIso.get(p.iso);
    if (!ya) { porIso.set(p.iso, p); continue; }
    ya.anillos.push(...p.anillos);
    ya.areaKm2 += p.areaKm2;
    ya.bbox = unirBbox(ya.bbox, p.bbox);
  }
  const lista = [...porIso.values()];
  for (const p of lista) p.cupo = cupoDe(p.areaKm2);
  lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return lista;
}

const elegir = (...v) => v.find((x) => typeof x === 'string' && x.trim() && x !== '-99');

/* Polygon y MultiPolygon se aplanan al mismo formato: lista de piezas, cada
   pieza con su contorno exterior y sus huecos. */
function aAnillos(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates.slice();
  return [];
}

/* ------------------------------ geometría ------------------------------ */

export function bboxDe(anillos) {
  let oe = 180, su = 90, es = -180, no = -90;
  for (const pieza of anillos) {
    for (const [lon, lat] of pieza[0]) {
      if (lon < oe) oe = lon;
      if (lon > es) es = lon;
      if (lat < su) su = lat;
      if (lat > no) no = lat;
    }
  }
  return [oe, su, es, no];
}

const unirBbox = (a, b) => [
  Math.min(a[0], b[0]), Math.min(a[1], b[1]),
  Math.max(a[2], b[2]), Math.max(a[3], b[3]),
];

/* Área aproximada por la fórmula del área esférica excedente. No hace falta
   precisión cartográfica: solo alimenta el cupo. */
function estimarArea(anillos) {
  const R = 6371.0088;
  let total = 0;
  for (const pieza of anillos) {
    for (let i = 0; i < pieza.length; i++) {
      const signo = i === 0 ? 1 : -1;     // el primer anillo suma, los huecos restan
      total += signo * Math.abs(areaAnillo(pieza[i], R));
    }
  }
  return total;
}

function areaAnillo(puntos, R) {
  let suma = 0;
  for (let i = 0, n = puntos.length; i < n; i++) {
    const [lon1, lat1] = puntos[i];
    const [lon2, lat2] = puntos[(i + 1) % n];
    suma += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return (suma * R * R) / 2;
}

const rad = (g) => (g * Math.PI) / 180;

/* Lanzamiento de rayo. Un punto cuenta si está dentro del contorno exterior de
   alguna pieza y fuera de todos sus huecos. */
export function dentroDe(pais, lon, lat) {
  const [oe, su, es, no] = pais.bbox;
  if (lon < oe || lon > es || lat < su || lat > no) return false;
  for (const pieza of pais.anillos) {
    if (!enAnillo(pieza[0], lon, lat)) continue;
    let enHueco = false;
    for (let h = 1; h < pieza.length; h++) {
      if (enAnillo(pieza[h], lon, lat)) { enHueco = true; break; }
    }
    if (!enHueco) return true;
  }
  return false;
}

function enAnillo(anillo, x, y) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/* Índice por rejilla de 1°: evita probar los 240 países en cada punto. */
export function indexar(paises) {
  const rejilla = new Map();
  const clave = (x, y) => `${x},${y}`;
  for (const p of paises) {
    const [oe, su, es, no] = p.bbox;
    for (let x = Math.floor(oe); x <= Math.floor(es); x++) {
      for (let y = Math.floor(su); y <= Math.floor(no); y++) {
        const k = clave(x, y);
        if (!rejilla.has(k)) rejilla.set(k, []);
        rejilla.get(k).push(p);
      }
    }
  }
  return (lon, lat) => {
    const candidatos = rejilla.get(clave(Math.floor(lon), Math.floor(lat)));
    if (!candidatos) return null;
    for (const p of candidatos) if (dentroDe(p, lon, lat)) return p;
    return null;
  };
}
