#!/usr/bin/env node
/* HAWK — resolver IDs de foto a URLs de imagen.
   ---------------------------------------------------------------------------
   El banco guarda IDs, no imagenes, y por una razon: la URL de la foto vive en
   el CDN de Facebook, va firmada y CADUCA A LOS 30 DIAS. Un banco con URLs
   dentro seria un banco que se pudre solo.

   Traducir ID -> URL cuesta una consulta al grafo y el token, que no puede
   bajar al navegador. En produccion esto lo hara el worker de salas, que ya
   tiene que existir de todas formas; aqui se hace en seco para poder probar el
   visor sin haber escrito el worker todavia.

   Uso:  node --env-file=.env resolver.mjs [cuantas] [salida.json]
*/
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usarToken, detalleFoto } from './mapillary.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BANCO = path.join(AQUI, '..', 'shared', 'banco');
const CUANTAS = Number(process.argv[2] || 12);
const SALIDA = path.join(AQUI, '..', 'pruebas', process.argv[3] || 'puntos.json');

/* 2048 es el punto dulce medido: 238 KB por foto y basta para que el jugador
   lea un cartel. La original (4096) pesa el cuadruple y no aporta nada a una
   ronda de dos minutos. */
const CAMPOS = 'thumb_2048_url,thumb_1024_url,thumb_original_url,is_pano,compass_angle,captured_at,computed_geometry';

const token = process.env.HAWK_MAPILLARY_TOKEN;
if (!token) {
  console.error('Falta HAWK_MAPILLARY_TOKEN. Lanza con:  node --env-file=.env resolver.mjs');
  process.exit(1);
}
usarToken(token);

/* Una de cada pais, y si sobran turnos se vuelve a repartir. Asi doce fotos no
   salen todas del mismo sitio, que es justo lo que no sirve para probar. */
async function elegir(cuantas) {
  const ficheros = (await readdir(BANCO)).filter((f) => f.endsWith('.json') && f !== 'indice.json');
  const porPais = [];
  for (const f of ficheros) {
    const d = JSON.parse(await readFile(path.join(BANCO, f), 'utf8'));
    if (d.puntos?.length) porPais.push({ iso: d.iso, nombre: d.nombre, puntos: [...d.puntos] });
  }
  const salida = [];
  let vuelta = 0;
  while (salida.length < cuantas && porPais.some((p) => p.puntos.length)) {
    for (const p of porPais) {
      if (salida.length >= cuantas) break;
      if (!p.puntos.length) continue;
      const i = Math.floor(Math.random() * p.puntos.length);
      const [pt] = p.puntos.splice(i, 1);
      salida.push({ ...pt, iso: p.iso, pais: p.nombre });
    }
    if (++vuelta > cuantas) break;
  }
  return salida;
}

const elegidos = await elegir(CUANTAS);
console.log(`Resolviendo ${elegidos.length} fotos contra el grafo...`);

const fotos = [];
for (const pt of elegidos) {
  const url = `https://graph.mapillary.com/${pt.id}?fields=${CAMPOS}&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  if (!r.ok) { console.log(`  ${pt.iso} ${pt.id}  FALLA ${r.status}`); continue; }
  const d = await r.json();
  if (!d.thumb_2048_url) { console.log(`  ${pt.iso} ${pt.id}  sin imagen`); continue; }
  if (d.is_pano !== true) { console.log(`  ${pt.iso} ${pt.id}  ya no es esferica`); continue; }

  const geo = d.computed_geometry?.coordinates;
  fotos.push({
    id: String(pt.id),
    iso: pt.iso,
    pais: pt.pais,
    lon: geo ? geo[0] : pt.lon,
    lat: geo ? geo[1] : pt.lat,
    rumbo: d.compass_angle ?? pt.rumbo ?? 0,
    fecha: d.captured_at || pt.fecha || null,
    img: d.thumb_2048_url,
    imgLigera: d.thumb_1024_url || null,
    imgGrande: d.thumb_original_url || null,
  });
  console.log(`  ${pt.iso} ${pt.id}  ok`);
}

/* La firma del CDN caduca; se anota para que la prueba pueda decir "esto ya
   esta rancio" en vez de enseñar un cuadro roto sin explicacion. */
const caduca = fotos.length ? expira(fotos[0].img) : null;

await writeFile(SALIDA, JSON.stringify({
  generado: new Date().toISOString(),
  caduca,
  fuente: 'Mapillary (CC BY-SA 4.0)',
  fotos,
}, null, 1), 'utf8');

console.log(`\n${fotos.length} fotos en pruebas/${path.basename(SALIDA)}`);
if (caduca) console.log(`Las URLs caducan el ${caduca.slice(0, 10)}.`);

function expira(u) {
  const oe = new URL(u).searchParams.get('oe');
  if (!oe) return null;
  return new Date(parseInt(oe, 16) * 1000).toISOString();
}
