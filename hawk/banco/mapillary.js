/* HAWK — capa de acceso a Mapillary.
   ---------------------------------------------------------------------------
   Dos caminos distintos y a propósito:

   · TESELAS (tiles.mapillary.com). Baratas y masivas: una sola tesela trae
     cientos de fotos con su posición. Es como se descubre dónde hay cobertura
     y de dónde salen los candidatos. Tope de 50.000 al día.
   · GRAFO (graph.mapillary.com). Una consulta por foto, pero devuelve los
     datos finos (miniatura, calidad, fecha). Solo se usa para rematar los
     candidatos que ya pasaron el filtro, nunca para explorar.

   La búsqueda por área del grafo (/images?bbox=) NO sirve para esto: está
   limitada a recuadros de ~1 km, así que barrer el mundo con ella sería
   inviable. Por eso todo el descubrimiento va por teselas.
*/
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const TESELAS = 'https://tiles.mapillary.com/maps/vtp/mly1_public/2';
const GRAFO = 'https://graph.mapillary.com';

let TOKEN = '';
export function usarToken(t) { TOKEN = String(t || '').trim(); }

/* Mapillary no contesta 429 cuando se agota el tope diario de teselas: devuelve
   un HTTP 200 con la pagina web de Mapillary dentro. Si eso se toma por una
   tesela vacia, el barrido entero termina "bien" y con cero puntos, sin una
   sola queja. Paso por eso: dos siembras seguidas se comieron las 50.000 del
   dia y la cosecha salio en blanco con codigo de salida 0.

   Por eso esto es un error con nombre propio y para el trabajo en seco. */
export class LimiteDeTeselas extends Error {
  constructor(detalle) {
    super(`Mapillary ya no sirve teselas (${detalle}). Es el tope de 50.000 al dia; `
      + 'se reanuda mañana con "npm run construir" y no se pierde lo hecho.');
    this.name = 'LimiteDeTeselas';
  }
}

/* ------------------------------ rejilla ------------------------------ */

export function aTesela(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { z, x: acotar(x, n), y: acotar(y, n) };
}

const acotar = (v, n) => Math.max(0, Math.min(n - 1, v));

/* ------------------------------ red ------------------------------ */

const ESPERA_429 = [1000, 3000, 8000, 20000];

async function pedir(url, tipo) {
  for (let intento = 0; ; intento++) {
    let r;
    try {
      r = await fetch(url, { headers: { 'User-Agent': 'HAWK/1.0 (iris.it.com)' } });
    } catch (e) {
      if (intento >= ESPERA_429.length) throw e;
      await dormir(ESPERA_429[intento]);
      continue;
    }
    if (r.status === 429 || r.status >= 500) {
      if (intento >= ESPERA_429.length) throw new Error(`${tipo}: ${r.status} tras reintentos`);
      await dormir(ESPERA_429[intento]);
      continue;
    }
    if (r.status === 404) return null;             // tesela vacía: no es un error
    if (!r.ok) throw new Error(`${tipo}: ${r.status} ${await r.text().catch(() => '')}`.slice(0, 200));
    return r;
  }
}

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ teselas ------------------------------ */

/* Devuelve las capas pedidas de una tesela, ya en lon/lat. Una tesela sin
   cobertura responde 404 o viene sin la capa: en ambos casos, lista vacía.

   `tope` y `filtro` no son un lujo: una sola tesela de ciudad grande trae más
   de 170.000 fotos (medido en Lima y Berlín) y nosotros nos quedamos con una o
   dos, porque el espaciado mínimo descarta el resto. Descodificar la geometría
   de todas sería tirar tiempo y memoria, así que primero se mira la ficha —que
   ya viene descodificada y es barata— y solo se calcula la posición de las que
   pasan el filtro. */
export async function leerTesela(z, x, y, capas, { tope = Infinity, filtro = null, repartido = false } = {}) {
  const url = `${TESELAS}/${z}/${x}/${y}?access_token=${encodeURIComponent(TOKEN)}`;
  const r = await pedir(url, 'tesela');
  if (!r) return {};

  /* Una tesela de verdad viene en binario. Si llega HTML o JSON no es que no
     haya fotos: es que nos han cortado el grifo. */
  const tipo = (r.headers.get('content-type') || '').toLowerCase();
  if (tipo.includes('text/html') || tipo.includes('application/json')) {
    throw new LimiteDeTeselas(`devuelve ${tipo.split(';')[0]} en vez de una tesela`);
  }

  const buf = new Uint8Array(await r.arrayBuffer());
  if (!buf.length) return {};

  let tile;
  try {
    tile = new VectorTile(new Pbf(buf));
  } catch (e) {
    throw new LimiteDeTeselas(`la tesela z${z}/${x}/${y} no se descodifica: ${e.message}`);
  }

  const salida = {};
  for (const nombre of capas) {
    const capa = tile.layers[nombre];
    if (!capa) { salida[nombre] = []; continue; }

    /* Con `repartido`, en vez de coger los primeros se va saltando de N en N,
       así el recorte queda esparcido por toda la tesela y no apelotonado en la
       esquina por la que empieza. Importa a poco zoom, donde una tesela abarca
       un continente; a z14 la tesela mide dos kilómetros y da igual. */
    const paso = repartido && capa.length > tope ? Math.floor(capa.length / tope) : 1;

    const rasgos = [];
    for (let i = 0; i < capa.length && rasgos.length < tope; i += paso) {
      const rasgo = capa.feature(i);
      if (filtro && !filtro(rasgo.properties)) continue;
      const punto = primerPunto(rasgo.toGeoJSON(x, y, z).geometry);
      if (!punto) continue;
      rasgos.push({ ...rasgo.properties, lon: punto[0], lat: punto[1] });
    }
    salida[nombre] = rasgos;
  }
  return salida;
}

/* La capa `overview` viene en puntos y `sequence` en líneas; de una línea nos
   vale su primer vértice, solo queremos saber que por ahí hay fotos. */
function primerPunto(g) {
  if (!g) return null;
  switch (g.type) {
    case 'Point': return g.coordinates;
    case 'MultiPoint':
    case 'LineString': return g.coordinates[0];
    case 'MultiLineString': return g.coordinates[0]?.[0] ?? null;
    default: return null;
  }
}

/* Dónde hay cobertura, a ojo de pájaro (z0–5). */
export async function explorar(z, x, y, tope = 500) {
  const { overview = [] } = await leerTesela(z, x, y, ['overview'], { tope, repartido: true });
  return overview;
}

/* Fotos concretas de una zona (z14). `is_pano` viene en la propia tesela, así
   que el filtro de 360 sale gratis, sin una sola consulta al grafo. */
export async function fotosDe(x, y, tope = 400) {
  const { image = [] } = await leerTesela(14, x, y, ['image'], {
    tope,
    filtro: (p) => p.is_pano === true || p.is_pano === 1,
  });
  return image.map((f) => ({
    id: String(f.id),
    lon: f.lon,
    lat: f.lat,
    pano: f.is_pano === true || f.is_pano === 1,
    fecha: f.captured_at || 0,
    rumbo: f.compass_angle ?? null,
    secuencia: f.sequence_id ? String(f.sequence_id) : null,
  }));
}

/* ------------------------------ grafo ------------------------------ */

const CAMPOS = 'id,is_pano,captured_at,compass_angle,quality_score,computed_geometry,geometry,thumb_1024_url';

/* Remate de un candidato: confirma que sigue viva, que es esférica de verdad y
   con qué calidad. Se llama solo sobre los que ya pasaron el filtro. */
export async function detalleFoto(id) {
  const url = `${GRAFO}/${encodeURIComponent(id)}?fields=${CAMPOS}&access_token=${encodeURIComponent(TOKEN)}`;
  const r = await pedir(url, 'grafo');
  if (!r) return null;
  const d = await r.json().catch(() => null);
  if (!d || !d.id) return null;

  const geo = d.computed_geometry?.coordinates || d.geometry?.coordinates;
  if (!geo) return null;
  return {
    id: String(d.id),
    lon: geo[0],
    lat: geo[1],
    pano: d.is_pano === true,
    fecha: d.captured_at || 0,
    rumbo: d.compass_angle ?? null,
    calidad: typeof d.quality_score === 'number' ? d.quality_score : null,
  };
}

/* Lanza `tareas` en paralelo con un tope de concurrencia. Mapillary aguanta
   mucho más, pero no hay prisa: el banco se construye una vez. */
export async function enParalelo(items, tope, trabajo) {
  const salida = new Array(items.length);
  let siguiente = 0;
  const obreros = Array.from({ length: Math.min(tope, items.length) }, async () => {
    while (true) {
      const i = siguiente++;
      if (i >= items.length) return;
      try {
        salida[i] = await trabajo(items[i], i);
      } catch (e) {
        if (e instanceof LimiteDeTeselas) throw e;   // esto no se traga: para todo
        salida[i] = null;
      }
    }
  });
  await Promise.all(obreros);
  return salida;
}
