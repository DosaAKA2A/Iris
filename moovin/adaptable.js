/* ============================================================================
   MOOVIN — capa adaptable (televisor / movil / escritorio)
   ----------------------------------------------------------------------------
   MOOVIN es una sola pagina que se abre en sitios muy distintos: un monitor con
   raton, un telefono con los dedos y un televisor con un mando de flechas. El
   monolito de index.html no sabe nada de eso y no hace falta que lo sepa: este
   archivo va por fuera y solo hace tres cosas.

     1. Etiqueta el <html> con donde estamos, para que adaptable.css reajuste
        tamanos y esconda lo que no aplica.
     2. Anade navegacion por mando: mover el foco entre lo que hay en pantalla
        siguiendo la geometria, y una tecla de volver que siempre deshace un
        paso.
     3. Tapa los agujeros de cada sitio: la pantalla completa de iOS, la tecla
        de volver de Tizen, y el registro del service worker.

   Regla que se sigue en todo el archivo: NO se toca la logica de index.html.
   Cuando hace falta algo de dentro (mostrar la barra de controles, cerrar un
   panel) se dispara el mismo evento que dispararia el raton. Asi las dos capas
   no se pueden desincronizar.
   ========================================================================== */
(() => {
'use strict';

const raiz = document.documentElement;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));

/* ======================== Donde nos hemos abierto ======================== */
/* El televisor se reconoce por dos vias. La buena es el objeto `tizen`, que
   solo existe dentro de una app de Samsung. La otra es la cadena del
   navegador, que cubre al resto de televisores y al navegador de la propia
   tele cuando se entra por web en vez de por la app. */
function esTelevisor() {
  try {
    // Interruptor manual: ?tv=1 para probar el modo televisor desde el PC,
    // ?tv=0 para salir. Se recuerda, que si no habria que repetirlo en cada
    // recarga y las pruebas de esto son a base de recargar.
    const q = new URLSearchParams(location.search).get('tv');
    if (q === '1') { try { localStorage.moovinModoTV = '1'; } catch (e) {} return true; }
    if (q === '0') { try { delete localStorage.moovinModoTV; } catch (e) {} return false; }
    if (localStorage.moovinModoTV === '1') return true;
  } catch (e) { /* sin localStorage se sigue por la deteccion normal */ }

  if (typeof window.tizen !== 'undefined' && window.tizen && window.tizen.tvinputdevice) return true;
  if (typeof window.webOS !== 'undefined') return true;
  const ua = navigator.userAgent || '';
  return /\b(Tizen|Web0S|webOS|SmartTV|SMART-TV|HbbTV|NetCast|Viera|BRAVIA|AFT[A-Z]|GoogleTV|CrKey)\b/i.test(ua);
}

/* Un telefono o una tablet: puntero grueso y pantalla estrecha. Se piden las
   dos cosas porque un portatil tactil cumple la primera y no es un movil. */
function esMovil() {
  const grueso = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  const estrecho = Math.min(screen.width || 9999, window.innerWidth || 9999) <= 900;
  return (grueso && estrecho) || /Android|iPhone|iPod|iPad/i.test(navigator.userAgent || '');
}

const TV = esTelevisor();
const plataforma = TV ? 'tv' : (esMovil() ? 'movil' : 'escritorio');
raiz.setAttribute('data-plataforma', plataforma);

/* La entrada empieza siendo la que corresponde al sitio, pero puede cambiar en
   marcha: a un televisor se le puede enchufar un raton y a un portatil se le
   puede dejar el raton quieto y tirar de tabulador. Manda lo ultimo que se
   uso, porque es lo que dice donde esta mirando quien lo maneja. */
function entrada(modo) {
  if (raiz.getAttribute('data-entrada') !== modo) raiz.setAttribute('data-entrada', modo);
}
entrada(TV ? 'mando' : (plataforma === 'movil' ? 'tactil' : 'raton'));
window.addEventListener('mousemove', () => entrada('raton'), { passive: true });
window.addEventListener('touchstart', () => entrada('tactil'), { passive: true });

/* ============================ Teclas ============================
   Los codigos de un mando de televisor no son los del teclado. Las flechas y
   el OK coinciden, pero volver y los botones de reproduccion tienen numeros
   propios de Samsung que no existen en ningun estandar. */
const K = {
  IZQ: 37, ARR: 38, DER: 39, ABA: 40, OK: 13,
  VOLVER: 10009,      // el boton Return del mando de Samsung
  SALIR: 10182,
  PLAY: 415, PAUSA: 19, PLAYPAUSA: 10252, STOP: 413,
  ADELANTE: 417, ATRAS: 412
};

/* Las teclas de color y las de reproduccion no llegan a la app si no se piden
   antes: el sistema se las queda para sus propios menus. Se registran una a
   una porque no todos los modelos tienen todas y el lote entero falla si una
   sola no existe. */
if (TV && window.tizen && window.tizen.tvinputdevice) {
  ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward']
    .forEach((t) => { try { window.tizen.tvinputdevice.registerKey(t); } catch (e) { /* este modelo no la tiene */ } });
}

/* ==================== Que parte de la pantalla manda ====================
   En cada momento hay una sola zona con la que se puede interactuar, y es
   siempre la capa de mas arriba que este visible. Sin esto, el foco se iria a
   los botones de la biblioteca que estan debajo del cartel del pase. */
const visible = (el) => !!(el && !el.classList.contains('hidden') &&
  el.offsetWidth > 0 && el.offsetHeight > 0);

function zonaActiva() {
  const menu = $$('.menu').find(visible);
  if (menu) return [menu];
  if (visible($('#pase'))) return [$('#pase')];
  if (visible($('#dl'))) return [$('#dl')];
  if (visible($('#tapveil'))) return [$('#tapveil')];
  // Con la biblioteca abierta, la cabecera entra en el recorrido: es de donde
  // cuelgan el boton de Watch Party y la vuelta a la portada.
  if (visible($('#loader'))) return [$('#top'), $('#loader')];
  // El panel de Watch Party convive con el video. Solo captura el foco si el
  // foco ya estaba dentro; si no, se navega por los controles y se entra al
  // panel desde su boton de la cabecera, como con el raton.
  const party = $('#party');
  if (visible(party) && party.contains(document.activeElement)) return [party];
  return [$('#top'), $('#bar'), $('#acciones'), party].filter(visible);
}

const ENFOCABLES = 'button,input:not([type=hidden]),select,textarea,a[href],[tabindex]:not([tabindex="-1"])';

function candidatos() {
  const zonas = zonaActiva();
  const fuera = [];
  zonas.forEach((z) => {
    $$(ENFOCABLES).forEach((el) => {
      if (!z.contains(el)) return;
      if (el.disabled || el.hidden) return;
      // Un elemento con tamano cero esta oculto por CSS (los botones que la
      // capa de televisor esconde, por ejemplo) y no debe entrar al recorrido.
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      fuera.push(el);
    });
  });
  return fuera;
}

/* ---------------------- Movimiento por geometria ----------------------
   Se elige el elemento mas cercano EN LA DIRECCION que se ha pulsado, no el
   siguiente del documento. Es lo unico que se comporta como espera quien mira
   la pantalla: en una rejilla, "abajo" tiene que caer en la fila de abajo por
   la misma columna, y el orden del HTML no sabe nada de columnas. */
function centro(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

function solape(a1, a2, b1, b2) { return Math.min(a2, b2) - Math.max(a1, b1); }

function puntuacion(ra, rb, dir) {
  const ejeX = dir === 'izq' || dir === 'der';
  let avance;
  if (dir === 'der') avance = rb.left - ra.right;
  else if (dir === 'izq') avance = ra.left - rb.right;
  else if (dir === 'aba') avance = rb.top - ra.bottom;
  else avance = ra.top - rb.bottom;

  // Se descarta lo que queda detras. El margen de tolerancia deja pasar a los
  // vecinos que se solapan un poco, como los botones pegados de la barra.
  if (avance < -6) return Infinity;

  const ca = centro(ra), cb = centro(rb);
  const desvio = ejeX ? Math.abs(cb.y - ca.y) : Math.abs(cb.x - ca.x);
  const alineado = ejeX
    ? solape(ra.top, ra.bottom, rb.top, rb.bottom) > 0
    : solape(ra.left, ra.right, rb.left, rb.right) > 0;

  // Estar en la misma fila (o columna) pesa mucho mas que estar cerca: entre
  // la tarjeta de al lado y una mas cercana pero de otra fila, gana la de al
  // lado. Por eso el desvio se multiplica por tres cuando no hay alineacion.
  return Math.max(0, avance) + desvio * (alineado ? 0.35 : 3);
}

function mueve(dir) {
  const lista = candidatos();
  if (!lista.length) return false;
  const actual = document.activeElement;

  // Sin foco util todavia (recien abierta una capa), se entra por lo primero.
  if (!actual || actual === document.body || !lista.includes(actual)) {
    enfoca(lista[0]);
    return true;
  }
  const ra = actual.getBoundingClientRect();
  let mejor = null, mejorP = Infinity;
  lista.forEach((el) => {
    if (el === actual) return;
    const p = puntuacion(ra, el.getBoundingClientRect(), dir);
    if (p < mejorP) { mejorP = p; mejor = el; }
  });
  if (!mejor) return false;
  enfoca(mejor);
  return true;
}

function enfoca(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  // El scroll se hace a mano y centrado: el del navegador deja el elemento
  // pegado al borde y en un televisor eso significa no ver la fila siguiente,
  // que es justo lo que se necesita para saber a donde se puede seguir.
  const r = el.getBoundingClientRect();
  if (r.top < 90 || r.bottom > window.innerHeight - 90) {
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    catch (e) { el.scrollIntoView(); }
  }
}

/* ============================ Barra de controles ============================
   La barra se esconde sola a los 2,6 segundos de reproduccion. Con raton eso
   esta bien; con mando es una trampa, porque el foco se queda dentro de algo
   invisible y las flechas dejan de hacer nada visible.

   No se toca ese temporizador: se le manda el mismo mousemove que le mandaria
   el raton, que es lo que index.html ya escucha para volver a sacarla. */
const stage = $('#stage');
function despiertaBarra() {
  if (stage) stage.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
}
// Mientras el foco siga dentro de la barra, la barra se queda. Se refresca por
// debajo del temporizador de index.html para que no llegue a cerrarse.
setInterval(() => {
  const bar = $('#bar');
  if (bar && document.activeElement && bar.contains(document.activeElement)) despiertaBarra();
}, 1800);

const enBarra = () => {
  const bar = $('#bar');
  return !!(bar && document.activeElement && bar.contains(document.activeElement));
};
const hayCapa = () => !!($$('.menu').find(visible) || visible($('#loader')) ||
  visible($('#pase')) || visible($('#dl')) || visible($('#tapveil')) ||
  (visible($('#party')) && $('#party').contains(document.activeElement)));

/* ================================ Volver ================================
   Una sola tecla que siempre deshace el ultimo paso, en el mismo orden en que
   se abrieron las cosas. En un mando es la unica salida que hay, asi que no
   puede quedarse nunca sin respuesta: si ya no hay nada que cerrar y estamos
   en una app de televisor, se sale de la app. */
function volver() {
  const menu = $$('.menu').find(visible);
  if (menu) {
    // Los menus de audio y subtitulos se cierran con su propio boton, que es
    // el que ademas devuelve el estado a index.html.
    const btn = menu.id === 'cc-menu' ? $('#c-cc') : $('#c-audio');
    if (btn) { btn.click(); enfoca(btn); return; }
  }
  if (visible($('#dl'))) { $('#dl-cerrar').click(); return; }
  if (visible($('#pase'))) return;   // sin pase no hay a donde volver
  const party = $('#party');
  if (visible(party) && party.contains(document.activeElement)) { $('#p-close').click(); return; }

  if (visible($('#loader'))) {
    // Dentro de la ficha de una serie, volver es volver a la rejilla.
    const serie = $('#serie');
    if (serie && serie.classList.contains('on')) { $('#se-volver').click(); return; }
    const cerrar = $('#loader-close');
    if (cerrar && cerrar.offsetWidth > 0) { cerrar.click(); return; }
    salir();
    return;
  }
  // Reproduciendo: volver lleva a la biblioteca, igual que el boton de la
  // barra y que la marca de la cabecera.
  const abrir = $('#c-open');
  if (abrir) { abrir.click(); return; }
  salir();
}

function salir() {
  if (window.tizen && window.tizen.application) {
    try { window.tizen.application.getCurrentApplication().exit(); return; } catch (e) {}
  }
  if (window.webOS && window.webOS.platformBack) { try { window.webOS.platformBack(); return; } catch (e) {} }
  // En un navegador normal no hay nada que cerrar: se deja como esta.
}

/* ============================== El teclado ==============================
   Va en fase de captura y por delante del de index.html, que tiene las
   flechas puestas para adelantar y retroceder el video. Cuando el foco esta
   navegando por la interfaz, este handler se queda la tecla; cuando estamos
   viendo algo sin capas por encima, la deja pasar y el video adelanta como
   siempre. */
document.addEventListener('keydown', (e) => {
  const k = e.keyCode;
  const enTexto = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) &&
    !/^(range|button|checkbox|radio)$/.test(e.target.type || '');

  if (k === K.VOLVER || k === K.SALIR || (e.key === 'Escape' && TV)) {
    e.preventDefault(); e.stopPropagation();
    volver();
    return;
  }
  // Teclas de reproduccion del mando: valen siempre, haya lo que haya encima.
  if (k === K.PLAYPAUSA || k === K.PLAY || k === K.PAUSA) {
    e.preventDefault(); e.stopPropagation();
    const v = $('#v');
    if (v && v.src) { v.paused ? v.play().catch(() => {}) : v.pause(); despiertaBarra(); }
    return;
  }
  if (k === K.ADELANTE || k === K.ATRAS) {
    e.preventDefault(); e.stopPropagation();
    const v = $('#v');
    if (v && v.src) { v.currentTime += (k === K.ADELANTE ? 30 : -30); despiertaBarra(); }
    return;
  }
  if (k === K.STOP) {
    e.preventDefault(); e.stopPropagation();
    const v = $('#v'); if (v) v.pause();
    return;
  }

  const flecha = k === K.IZQ ? 'izq' : k === K.DER ? 'der' : k === K.ARR ? 'arr' : k === K.ABA ? 'aba' : null;
  if (!flecha && k !== K.OK) return;

  entrada('mando');

  // Escribiendo en una caja de texto, las flechas mueven el cursor. Solo se
  // sale de ella hacia arriba o hacia abajo.
  if (enTexto && (flecha === 'izq' || flecha === 'der')) return;
  // Una barra deslizante (el avance del video, el volumen) usa izquierda y
  // derecha para su propio valor. Arriba y abajo la abandonan.
  if (e.target.type === 'range' && (flecha === 'izq' || flecha === 'der')) { despiertaBarra(); return; }

  if (k === K.OK) {
    // Con el foco puesto en algo, OK es su click y lo hace el navegador solo.
    if (document.activeElement && document.activeElement !== document.body &&
        candidatos().includes(document.activeElement)) return;
    // Sin foco y viendo algo, OK es pausar.
    if (!hayCapa()) {
      const v = $('#v');
      if (v && v.src) { e.preventDefault(); e.stopPropagation(); v.paused ? v.play().catch(() => {}) : v.pause(); despiertaBarra(); }
      return;
    }
    e.preventDefault(); e.stopPropagation();
    mueve('aba');   // entra en la capa que este abierta
    return;
  }

  // Viendo algo, sin capas y sin el foco metido en la barra: izquierda y
  // derecha adelantan el video (lo hace index.html, se deja pasar) y arriba o
  // abajo sacan la barra y entran en ella.
  if (!hayCapa() && !enBarra()) {
    despiertaBarra();
    if (flecha === 'izq' || flecha === 'der') return;
    e.preventDefault(); e.stopPropagation();
    // despiertaBarra() ya ha puesto la clase que la hace visible, y eso pasa en
    // el mismo turno: los botones ya se pueden medir y enfocar aqui mismo. Nada
    // de esperar a un fotograma, que en una pestana de fondo no llega nunca.
    // Se entra por la fila de botones, no por la barra de avance: adelantar y
    // retroceder ya se hace con izquierda y derecha sin entrar en ningun sitio,
    // asi que caer en el avance seria dar un paso para llegar a lo mismo. Lo
    // que solo se alcanza aqui son los botones.
    const bar = $('#bar');
    if (!bar) return;
    const enBar = candidatos().filter((el) => bar.contains(el));
    enfoca(enBar.find((el) => el.closest('.bar-row')) || enBar[0]);
    return;
  }

  e.preventDefault(); e.stopPropagation();
  despiertaBarra();
  mueve(flecha);
}, true);

/* Al abrirse una capa nueva hay que poner el foco dentro, o el primer toque de
   flecha se pierde en decidir por donde empieza. Se vigila el atributo class,
   que es como index.html abre y cierra sus paneles. */
if (raiz.getAttribute('data-entrada') === 'mando' || TV) {
  const observa = new MutationObserver(() => {
    if (raiz.getAttribute('data-entrada') !== 'mando') return;
    const act = document.activeElement;
    const lista = candidatos();
    if (!lista.length) return;
    if (!act || act === document.body || !lista.includes(act)) enfoca(lista[0]);
  });
  ['#loader', '#pase', '#dl', '#party', '#tapveil'].forEach((s) => {
    const el = $(s);
    if (el) observa.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
  // La rejilla se pinta despues de que llegue el catalogo: cuando aparezcan
  // las tarjetas, el foco va a la primera.
  const grid = $('#lib-grid');
  if (grid) observa.observe(grid, { childList: true, subtree: true });
}

/* ======================= Parches de cada plataforma ======================= */

/* iOS no deja poner en pantalla completa a un div: solo al propio video, y con
   un metodo suyo. Sin esto, el boton de pantalla completa no hace nada en un
   iPhone. */
const fs = $('#c-fs'), video = $('#v');
if (fs && video && !document.documentElement.requestFullscreen && video.webkitEnterFullscreen) {
  fs.addEventListener('click', (e) => {
    e.stopPropagation();
    try { video.webkitEnterFullscreen(); } catch (err) {}
  }, true);
}

/* Con el telefono tumbado, la cabecera sobra mientras se reproduce. Es CSS,
   pero el CSS necesita saber que hay algo en marcha. */
if (video) {
  const marca = () => raiz.toggleAttribute('data-reproduciendo', !!video.src && !video.paused);
  video.addEventListener('play', marca);
  video.addEventListener('pause', marca);
  video.addEventListener('emptied', marca);
}

/* En un telefono, ponerse en pantalla completa casi siempre quiere decir
   tumbar la imagen. Si el sistema deja bloquear la orientacion, se bloquea; y
   se suelta al salir, para no dejar el telefono trabado de lado. */
if (plataforma === 'movil') {
  document.addEventListener('fullscreenchange', () => {
    const o = screen.orientation;
    if (!o) return;
    if (document.fullscreenElement) { try { o.lock('landscape').catch(() => {}); } catch (e) {} }
    else { try { o.unlock(); } catch (e) {} }
  });
}

/* El service worker es lo que convierte esto en algo instalable: sin el, ni
   Chrome ni Android ofrecen anadirla como aplicacion. No se registra en el
   televisor, donde la app ya viene empaquetada y una cache intermedia solo
   anade una forma mas de servir algo viejo. */
if ('serviceWorker' in navigator && !TV && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin cache se sigue funcionando igual */ });
  });
}
})();
