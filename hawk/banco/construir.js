#!/usr/bin/env node
/* HAWK — constructor del banco de coordenadas.
   ---------------------------------------------------------------------------
   Uso:  HAWK_MAPILLARY_TOKEN="MLY|..." npm run construir
         node construir.js --resumen        (solo enseña lo ya construido)
         node construir.js --pais PE,CL,AR  (rehace únicamente esos países)

   Tres pasadas:

   1. SEMBRAR   Se barre el mundo entero a vista de pájaro (z5, 1.024 teselas)
                para saber DÓNDE hay fotos. Sale una nube de semillas, cada una
                asignada a su país. Los países que queden mal servidos reciben
                una pasada extra sobre su propio recuadro (z8).
   2. COSECHAR  Cada semilla se convierte en una tesela de detalle (z14), de la
                que se sacan solo las esféricas de 360. Se aplica espaciado
                mínimo para que el banco no sean 200 fotos de la misma calle, y
                se corta al llegar al cupo del país.
   3. REMATAR   Una muestra de cada país se confirma contra el grafo: que la
                foto siga viva, que sea esférica de verdad y con qué calidad.

   El trabajo es reanudable: cada país terminado se guarda en datos/progreso.json.
   El resultado final va a ../shared/banco/<ISO>.json y ../shared/banco/indice.json.
*/
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cargarPaises, indexar, bboxDe } from './paises.js';
import {
  usarToken, aTesela, explorar, leerTesela, fotosDe, detalleFoto, enParalelo, LimiteDeTeselas,
} from './mapillary.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DATOS = path.join(AQUI, 'datos');
const SALIDA = path.join(AQUI, '..', 'shared', 'banco');
const PROGRESO = path.join(DATOS, 'progreso.json');
const SEMILLAS = path.join(DATOS, 'semillas.json');

/* --------------------------- reglas del banco --------------------------- */

const Z_MUNDO = 5;              // vista de pájaro para sembrar
const Z_REFUERZO = 8;           // pasada extra para países mal servidos
const Z_DETALLE = 14;           // única escala con la capa `image`
const SEMILLAS_POR_TESELA = 500;
const SEPARACION_KM = 2;        // dos puntos del banco nunca más cerca que esto
const POR_SECUENCIA = 2;        // máximo de fotos de un mismo recorrido
const ANTIGUEDAD_MAX = 8;       // años: fotos más viejas se descartan
const REMATE_POR_PAIS = 12;     // cuántas se confirman contra el grafo
const CONCURRENCIA = 12;

/* Frenos de gasto. Sin ellos, un país con poca cobertura se gasta TODAS sus
   semillas sin llenar el cupo: puede pedir 3.000 teselas para sacar 20 puntos.
   Con 773.000 semillas repartidas, el barrido completo se iría por encima de
   las 100.000 teselas y reventaría el tope diario de Mapillary (50.000), o sea
   días de calendario en vez de horas.

   `LOTES_SECOS` se rinde donde no hay nada: si doce teselas seguidas no dan ni
   un punto, y otras once tandas más tampoco, ese país está agotado. Es un
   freno adaptativo, no castiga al que sí produce. `TESELAS_POR_PAIS` es solo
   la red de seguridad por debajo. */
const LOTES_SECOS = 12;
const TESELAS_POR_PAIS = 2500;

const args = process.argv.slice(2);
const soloResumen = args.includes('--resumen');
const soloPrueba = args.includes('--probar');
const soloPaises = leerOpcion('--pais');

function leerOpcion(nombre) {
  const i = args.indexOf(nombre);
  if (i < 0 || !args[i + 1]) return null;
  return new Set(args[i + 1].toUpperCase().split(',').map((s) => s.trim()).filter(Boolean));
}

/* ------------------------------ arranque ------------------------------ */

async function main() {
  await mkdir(DATOS, { recursive: true });
  await mkdir(SALIDA, { recursive: true });

  const paises = await cargarPaises();
  const progreso = await leerJson(PROGRESO, {});

  if (soloResumen) return resumen(paises, progreso);

  const token = process.env.HAWK_MAPILLARY_TOKEN || leerToken();
  if (!token) {
    console.error('Falta el token. Consíguelo en https://www.mapillary.com/dashboard/developers');
    console.error('y lánzalo así:  HAWK_MAPILLARY_TOKEN="MLY|..." npm run construir');
    process.exit(1);
  }
  usarToken(token);

  if (soloPrueba) return probar();

  const dondeEsta = indexar(paises);
  const semillas = await sembrar(paises, dondeEsta);
  await cosechar(paises, semillas, progreso, dondeEsta);
  await publicar(progreso);
}

function leerToken() {
  const i = args.indexOf('--token');
  return i >= 0 ? args[i + 1] : '';
}

/* ---------------------------- prueba rapida ---------------------------- */

/* Valida en segundos las tres cosas que pueden romperse con la API real: que
   el token sirva, que las teselas se decodifiquen y que `is_pano` venga en la
   propia tesela (si no viniera, el filtro de 360 costaria una consulta por
   foto y habria que replantear la cosecha). */
async function probar() {
  const sitios = [
    ['Lima', -77.028, -12.046],
    ['Madrid', -3.703, 40.417],
    ['Berlin', 13.405, 52.52],
  ];

  console.log(`\nPRUEBA - vista de pajaro (z${Z_MUNDO}):`);
  for (const [nombre, lon, lat] of sitios) {
    const t = aTesela(lon, lat, Z_MUNDO);
    const puntos = await explorar(Z_MUNDO, t.x, t.y);
    console.log(`  ${nombre.padEnd(8)} z${t.z}/${t.x}/${t.y}  ->  ${puntos.length} puntos de cobertura`);
  }

  console.log(`\nPRUEBA - detalle (z${Z_DETALLE}):`);
  for (const [nombre, lon, lat] of sitios) {
    const t = aTesela(lon, lat, Z_DETALLE);
    const inicio = Date.now();
    const panos = await fotosDe(t.x, t.y);
    console.log(`  ${nombre.padEnd(8)} z${t.z}/${t.x}/${t.y}  ->  ${panos.length} esfericas en ${Date.now() - inicio} ms`);
    if (panos.length) {
      const f = panos[0];
      const d = await detalleFoto(f.id);
      console.log(`    muestra ${f.id}  ${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}  grafo: ${d ? (d.pano ? 'esferica viva' : 'viva pero NO esferica') : 'no responde'}`);
    }
  }
  console.log('\nSi las tres filas de detalle traen esfericas, la cosecha puede lanzarse.\n');
}

/* ------------------------- 1. sembrar el mundo ------------------------- */

async function sembrar(paises, dondeEsta) {
  if (existsSync(SEMILLAS)) {
    const guardadas = await leerJson(SEMILLAS, null);
    if (guardadas) {
      console.log(`Semillas ya sembradas: ${suma(guardadas)} puntos en ${Object.keys(guardadas).length} paises.`);
      return guardadas;
    }
  }

  console.log(`\nSEMBRAR - barriendo el mundo a z${Z_MUNDO} (${4 ** Z_MUNDO} teselas)...`);
  const lado = 2 ** Z_MUNDO;
  const teselas = [];
  for (let x = 0; x < lado; x++) for (let y = 0; y < lado; y++) teselas.push({ x, y });

  const porPais = {};
  let hechas = 0;
  let conFotos = 0;

  await enParalelo(teselas, CONCURRENCIA, async (t) => {
    const puntos = await explorar(Z_MUNDO, t.x, t.y, SEMILLAS_POR_TESELA);
    hechas++;
    if (hechas % 64 === 0) barra('teselas', hechas, teselas.length, `${conFotos} con cobertura`);
    if (!puntos.length) return;
    conFotos++;
    for (const p of puntos) {
      const pais = dondeEsta(p.lon, p.lat);
      if (!pais) continue;                       // mar, o territorio sin poligono
      (porPais[pais.iso] ||= []).push([redondear(p.lon), redondear(p.lat)]);
    }
  });
  barra('teselas', teselas.length, teselas.length, `${conFotos} con cobertura`);

  // Paises con pocas semillas: pasada extra sobre su propio recuadro.
  const flojos = paises.filter((p) => (porPais[p.iso]?.length || 0) < p.cupo * 3);
  console.log(`\n\nREFUERZO - ${flojos.length} paises mal servidos, pasada a z${Z_REFUERZO}...`);
  let n = 0;
  for (const pais of flojos) {
    const extra = await reforzar(pais, dondeEsta);
    if (extra.length) (porPais[pais.iso] ||= []).push(...extra);
    barra('paises', ++n, flojos.length, pais.nombre.slice(0, 22));
  }

  await escribirJson(SEMILLAS, porPais);
  console.log(`\n\nSembradas ${suma(porPais)} semillas en ${Object.keys(porPais).length} paises.\n`);
  return porPais;
}

/* A z8 la capa que existe ya no es `overview` sino `sequence`: son los
   recorridos, y nos vale su primer vertice para saber que por ahi hay fotos.

   El recuadro de un pais se come siempre a sus vecinos —el de España abarca
   Portugal, Marruecos y media Francia—, asi que cada punto se comprueba contra
   el poligono antes de aceptarlo. Sin esto, un pais hereda las semillas de sus
   vecinos y el banco miente. */
async function reforzar(pais, dondeEsta) {
  const teselas = teselasDeReticula(pais);
  const encontradas = [];
  await enParalelo(teselas, CONCURRENCIA, async (t) => {
    const capas = await leerTesela(Z_REFUERZO, t.x, t.y, ['sequence', 'overview'], {
      tope: SEMILLAS_POR_TESELA, repartido: true,
    });
    for (const p of [...(capas.sequence || []), ...(capas.overview || [])]) {
      if (!perteneceA(pais, dondeEsta, p.lon, p.lat)) continue;
      encontradas.push([redondear(p.lon), redondear(p.lat)]);
    }
  });
  return encontradas;
}

/* Que teselas hay que pedir para cubrir un pais.

   Un pais NO es un rectangulo. Si se usa el recuadro que engloba todas sus
   piezas, los paises repartidos salen carisimos y casi todo lo pedido es mar:
   el recuadro de Fiyi va de -180 a 180 porque cruza el antimeridiano, el de
   Francia de Guadalupe a la Reunion, y el de Chile se estira hasta la isla de
   Pascua. Medido: 901 teselas cada uno, el tope, para cuatro islas.

   Se recorre pieza por pieza, cada una con su propio recuadro ajustado, y se
   juntan sin repetir. Los paises compactos cuestan lo mismo; los repartidos,
   una fraccion. */
const TESELAS_REFUERZO = 900;

function teselasDeReticula(pais) {
  const vistas = new Set();
  const teselas = [];

  // Las piezas grandes primero: si hay que recortar, que caiga lo residual.
  const piezas = pais.anillos.slice().sort((a, b) => areaBbox(b[0]) - areaBbox(a[0]));

  for (const pieza of piezas) {
    const [oe, su, es, no] = bboxDe([pieza]);
    const a = aTesela(oe, no, Z_REFUERZO);
    const b = aTesela(es, su, Z_REFUERZO);
    for (let x = a.x; x <= b.x; x++) {
      for (let y = a.y; y <= b.y; y++) {
        const clave = `${x}/${y}`;
        if (vistas.has(clave)) continue;
        vistas.add(clave);
        teselas.push({ x, y });
        if (teselas.length >= TESELAS_REFUERZO) return teselas;
      }
    }
  }
  return teselas;
}

function areaBbox(anillo) {
  const [oe, su, es, no] = bboxDe([[anillo]]);
  return (es - oe) * (no - su);
}

/* Un punto es de este pais si el poligono lo dice. Cuando el poligono dice
   "mar" no se descarta a la primera: a escala 1:50m las islas pequeñas y las
   lineas de costa se comen metros de tierra real, y descartarlas dejaria sin
   banco a los paises isla. En ese caso vale con que caiga en su recuadro. Lo
   que nunca se acepta es un punto que caiga en tierra de OTRO pais. */
const MARGEN_COSTA = 0.05;   // grados, ~5 km

function perteneceA(pais, dondeEsta, lon, lat) {
  const real = dondeEsta(lon, lat);
  if (real) return real.iso === pais.iso;
  const [oe, su, es, no] = pais.bbox;
  return lon >= oe - MARGEN_COSTA && lon <= es + MARGEN_COSTA
      && lat >= su - MARGEN_COSTA && lat <= no + MARGEN_COSTA;
}

/* -------------------------- 2. cosechar fotos -------------------------- */

async function cosechar(paises, semillas, progreso, dondeEsta) {
  const pendientes = paises.filter((p) => {
    if (soloPaises && !soloPaises.has(p.iso)) return false;
    if (!soloPaises && progreso[p.iso]) return false;   // ya hecho
    return (semillas[p.iso]?.length || 0) > 0;
  });

  console.log(`COSECHAR - ${pendientes.length} paises por recorrer.\n`);

  let n = 0;
  for (const pais of pendientes) {
    const puntos = await cosecharPais(pais, semillas[pais.iso], dondeEsta);
    progreso[pais.iso] = {
      iso: pais.iso,
      nombre: pais.nombre,
      continente: pais.continente,
      cupo: pais.cupo,
      puntos,
    };
    await escribirJson(PROGRESO, progreso);
    n++;
    const marca = puntos.length >= pais.cupo ? 'lleno' : `${puntos.length}/${pais.cupo}`;
    console.log(`  ${String(n).padStart(3)}/${pendientes.length}  ${pais.iso}  ${pais.nombre.padEnd(26).slice(0, 26)} ${marca}`);
  }
}

async function cosecharPais(pais, semillas, dondeEsta) {
  const orden = repartirPorZonas(semillas);
  const rejilla = new Map();          // espaciado minimo
  const porSecuencia = new Map();
  const elegidas = [];
  const vistas = new Set();
  const corte = Date.now() - ANTIGUEDAD_MAX * 365 * 24 * 3600 * 1000;

  let secos = 0;      // lotes seguidos sin sacar ni un punto

  for (const lote of trocear(orden, CONCURRENCIA)) {
    if (elegidas.length >= pais.cupo) break;
    if (secos >= LOTES_SECOS) break;              // aqui ya no hay nada que rascar
    if (vistas.size >= TESELAS_POR_PAIS) break;   // tope duro de gasto

    const antes = elegidas.length;

    const cosechas = await enParalelo(lote, CONCURRENCIA, async ([lon, lat]) => {
      const t = aTesela(lon, lat, Z_DETALLE);
      const clave = `${t.x}/${t.y}`;
      if (vistas.has(clave)) return [];
      vistas.add(clave);
      return fotosDe(t.x, t.y);
    });

    for (const fotos of cosechas) {
      if (!fotos) continue;
      for (const f of fotos) {
        if (elegidas.length >= pais.cupo) break;
        if (!f.pano) continue;                              // solo esfericas de 360
        if (f.fecha && f.fecha < corte) continue;           // demasiado antigua
        if (!perteneceA(pais, dondeEsta, f.lon, f.lat)) continue;  // el otro lado de la frontera
        if (f.secuencia && (porSecuencia.get(f.secuencia) || 0) >= POR_SECUENCIA) continue;
        if (!cabeEn(rejilla, f.lon, f.lat)) continue;       // separacion minima
        if (f.secuencia) porSecuencia.set(f.secuencia, (porSecuencia.get(f.secuencia) || 0) + 1);
        elegidas.push({
          id: f.id,
          lon: redondear(f.lon),
          lat: redondear(f.lat),
          fecha: f.fecha || null,
          rumbo: f.rumbo === null ? null : Math.round(f.rumbo),
        });
      }
    }

    secos = elegidas.length > antes ? 0 : secos + 1;
  }
  return elegidas;
}

/* El orden en que se visitan las semillas decide el reparto del banco.
   Barajarlas sin mas no basta: donde hay mas cobertura hay mas semillas, asi
   que el cupo se llenaba por la zona mas fotografiada y el resto del pais no
   llegaba a visitarse. Medido: el 56% de "España" caia en Canarias y el 48%
   de "Perú" en la costa norte.

   Aqui se agrupan las semillas por zonas de un grado (~110 km) y se sirven por
   turnos: una de cada zona, luego la segunda de cada zona, y asi. El cupo se
   agota recorriendo el pais entero en vez de vaciar su rincon mas rico. */
const ZONA_GRADOS = 1;

function repartirPorZonas(semillas) {
  const zonas = new Map();
  for (const s of semillas) {
    const clave = `${Math.floor(s[1] / ZONA_GRADOS)},${Math.floor(s[0] / ZONA_GRADOS)}`;
    if (!zonas.has(clave)) zonas.set(clave, []);
    zonas.get(clave).push(s);
  }

  const listas = barajar([...zonas.values()]).map((l) => barajar(l));
  const orden = [];
  for (let vuelta = 0; ; vuelta++) {
    let quedaAlguna = false;
    for (const lista of listas) {
      if (vuelta < lista.length) { orden.push(lista[vuelta]); quedaAlguna = true; }
    }
    if (!quedaAlguna) break;
  }
  return orden;
}

/* Rejilla de celdas de SEPARACION_KM: un punto solo entra si su celda y las
   ocho vecinas estan libres. Barato y suficiente. */
function cabeEn(rejilla, lon, lat) {
  const gradoLat = SEPARACION_KM / 111.32;
  const gradoLon = SEPARACION_KM / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const cx = Math.floor(lon / gradoLon);
  const cy = Math.floor(lat / gradoLat);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (rejilla.has(`${cx + dx},${cy + dy}`)) return false;
    }
  }
  rejilla.set(`${cx},${cy}`, 1);
  return true;
}

/* --------------------- 3. rematar y publicar --------------------- */

async function publicar(progreso) {
  console.log('\nREMATAR - confirmando una muestra de cada pais contra el grafo...');

  const indice = [];
  let n = 0;
  const conPuntos = Object.values(progreso).filter((p) => p.puntos.length);

  for (const p of conPuntos) {
    const muestra = muestrear(p.puntos, REMATE_POR_PAIS);
    const detalles = await enParalelo(muestra, 6, (f) => detalleFoto(f.id));
    const vivas = detalles.filter((d) => d && d.pano);
    const salud = muestra.length ? vivas.length / muestra.length : 0;

    await escribirJson(path.join(SALIDA, `${p.iso}.json`), {
      iso: p.iso, nombre: p.nombre, continente: p.continente, puntos: p.puntos,
    });
    indice.push({
      iso: p.iso,
      nombre: p.nombre,
      continente: p.continente,
      total: p.puntos.length,
      cupo: p.cupo,
      salud: Number(salud.toFixed(2)),
    });
    barra('paises', ++n, conPuntos.length, p.nombre.slice(0, 22));
  }

  indice.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const total = indice.reduce((s, p) => s + p.total, 0);
  await escribirJson(path.join(SALIDA, 'indice.json'), {
    generado: new Date().toISOString().slice(0, 10),
    fuente: 'Mapillary (CC BY-SA 4.0)',
    total,
    paises: indice,
  });

  console.log(`\n\nBanco publicado en shared/banco/: ${total} puntos, ${indice.length} paises.`);
  const flojos = indice.filter((p) => p.total < 25);
  if (flojos.length) {
    console.log(`\nAviso: ${flojos.length} paises se quedan con menos de 25 puntos y no dan para jugar solos.`);
    console.log(`  ${flojos.map((p) => p.iso).join(' ')}`);
  }
}

/* ------------------------------ resumen ------------------------------ */

function resumen(paises, progreso) {
  const filas = Object.values(progreso).sort((a, b) => b.puntos.length - a.puntos.length);
  if (!filas.length) return console.log('Todavia no hay nada construido.');
  const total = filas.reduce((s, p) => s + p.puntos.length, 0);
  console.log(`\nBanco: ${total} puntos en ${filas.length} paises.\n`);
  for (const p of filas.slice(0, 30)) {
    console.log(`  ${p.iso}  ${p.nombre.padEnd(28).slice(0, 28)} ${String(p.puntos.length).padStart(4)} / ${p.cupo}`);
  }
  const sinNada = paises.filter((p) => !progreso[p.iso]).length;
  if (sinNada) console.log(`\n  (${sinNada} paises sin recorrer todavia)`);
}

/* ------------------------------ utilidades ------------------------------ */

const redondear = (v) => Math.round(v * 1e6) / 1e6;
const suma = (o) => Object.values(o).reduce((s, a) => s + a.length, 0);

function muestrear(lista, n) {
  if (lista.length <= n) return lista.slice();
  const copia = lista.slice();
  const salida = [];
  for (let i = 0; i < n; i++) salida.push(...copia.splice(Math.floor(Math.random() * copia.length), 1));
  return salida;
}

function barajar(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function trocear(lista, n) {
  const out = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

function barra(que, hechas, total, nota = '') {
  const pct = total ? Math.round((hechas / total) * 100) : 100;
  const lleno = Math.round(pct / 4);
  const linea = `  [${'#'.repeat(lleno)}${'.'.repeat(25 - lleno)}] ${String(pct).padStart(3)}%  ${hechas}/${total} ${que}  ${nota}`;
  process.stdout.write(`\r${linea.padEnd(88).slice(0, 88)}`);
}

async function leerJson(f, porDefecto) {
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return porDefecto; }
}

async function escribirJson(f, datos) {
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(datos), 'utf8');
}

main().catch((e) => { console.error('\n', e); process.exit(1); });
