/* ============================================================================
   MOOVIN — service worker
   ----------------------------------------------------------------------------
   Esto NO es una cache de peliculas. Su unico trabajo es que MOOVIN se pueda
   instalar como aplicacion (sin un service worker registrado, ni Chrome ni
   Android ofrecen instalarla) y que la interfaz abra al instante en vez de
   esperar a que baje otra vez el mismo HTML.

   Que se guarda: la interfaz. El HTML, sus dos archivos de la capa adaptable y
   los iconos. Nada mas.

   Que NO se guarda, nunca:
     - El catalogo y los videos. Van por el worker con un token firmado que
       caduca cada dia; guardarlos seria repartir contenido privado desde el
       disco de cada equipo, sin control ninguno, y ademas la primera cache de
       una pelicula llenaria la cuota del navegador.
     - Cualquier peticion que no sea de este mismo origen.

   La estrategia es red primero. Importa mas que la biblioteca este al dia que
   ahorrarse una peticion: la cache es la red de seguridad de cuando no hay
   conexion, no la fuente de la verdad.
   ========================================================================== */

const CACHE = 'moovin-interfaz-v4';

/* La interfaz completa. Si alguno falla no se aborta la instalacion entera:
   un icono que no este no puede dejar la app sin instalar. */
const INTERFAZ = [
  './',
  './index.html',
  './adaptable.css',
  './adaptable.js',
  './manifest.webmanifest',
  './icono-192.png',
  './icono-512.png',
  './icono-maskable-512.png',
  './favicon.svg',
  './avatares/aria.svg',
  './avatares/pj1.svg',
  './avatares/pj2.svg',
  './avatares/pj3.svg',
  './avatares/pj4.svg',
  './avatares/pj5.svg',
  './avatares/pj6.svg',
  './avatares/pj7.svg',
  './avatares/pj8.svg',
  './avatares/pj9.svg',
  './avatares/pj10.svg',
  './avatares/pj11.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(INTERFAZ.map((u) => c.add(u).catch(() => { /* ese archivo se pedira a la red */ })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Al cambiar de version se tiran las caches viejas: dos versiones de la
    // interfaz conviviendo es como se sirve un index nuevo con un CSS antiguo.
    const nombres = await caches.keys();
    await Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Todo lo de fuera (el worker del catalogo, R2, el relay de Watch Party, las
  // fuentes de Google) va directo a la red sin pasar por aqui.
  if (url.origin !== self.location.origin) return;
  // Peticiones firmadas con el token del pase (?t=): contenido privado, no se
  // toca. El catalogo y los archivos van todos por ahi.
  if (url.searchParams.has('t')) return;
  // Los videos y las pistas de audio pasan de largo: se piden por trozos con
  // cabeceras Range y una cache intermedia solo puede estropearlo.
  if (/\.(mp4|m4a|m4v|webm|mkv|mp3|opus|aac)$/i.test(url.pathname)) return;

  e.respondWith((async () => {
    try {
      const red = await fetch(req);
      // Solo se guarda lo que forma la interfaz, y solo si vino bien.
      if (red && red.ok && (req.mode === 'navigate' || /\.(html|css|js|json|webmanifest|svg|png|woff2?)$/i.test(url.pathname))) {
        const c = await caches.open(CACHE);
        c.put(req, red.clone());
      }
      return red;
    } catch (err) {
      // Sin red: lo que haya guardado. Y para una navegacion, la propia pagina,
      // que es lo unico que hace falta para que la app abra y avise de que no
      // hay conexion en vez de quedarse en blanco.
      const guardado = await caches.match(req);
      if (guardado) return guardado;
      if (req.mode === 'navigate') {
        const portada = await caches.match('./index.html');
        if (portada) return portada;
      }
      throw err;
    }
  })());
});
