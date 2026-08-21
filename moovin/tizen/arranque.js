/* ============================================================================
   MOOVIN para televisor — arranque
   ----------------------------------------------------------------------------
   Este es el unico archivo que vive DENTRO de la aplicacion instalada. Su
   trabajo es traerse la interfaz de iris.it.com en cada arranque y montarla
   aqui, de modo que un push al repositorio llegue a la tele sin volver a
   instalar nada.

   Por que asi y no apuntando el widget directamente a la web: cuando el
   contenido de una aplicacion Tizen es remoto, el sistema no garantiza que el
   objeto `tizen` llegue a la pagina, y sin el no hay tecla de volver (10009) ni
   teclas de reproduccion del mando. Aqui NO se navega a ningun sitio: se
   descarga el HTML y se escribe en este mismo documento, que sigue siendo
   local. El objeto `tizen` sobrevive porque la ventana nunca cambia.

   La etiqueta <base> que se inyecta hace que adaptable.css, adaptable.js y
   cualquier ruta relativa de MOOVIN se resuelvan contra la web, no contra el
   paquete. Solo este archivo se queda atras, y solo cambia si cambia la forma
   de arrancar.

   Sin red se usa la ultima copia que funciono, guardada aqui mismo. La
   biblioteca no se vera (el catalogo viene del worker), pero la aplicacion
   abre y explica por que, en vez de quedarse en negro.
   ========================================================================== */
(() => {
  'use strict';

  var ORIGEN = 'https://iris.it.com/moovin/';
  var BASE = 'https://iris.it.com/moovin/';
  var COPIA = 'moovinCopiaInterfaz';
  var COPIA_CSS = 'moovinCopiaCss';
  var COPIA_JS = 'moovinCopiaJs';
  var ESPERA = 12000;   // ms antes de rendirse y tirar de la copia guardada

  var estado = document.getElementById('estado');
  var aviso = document.getElementById('aviso');
  function di(t, extra) {
    if (estado) estado.textContent = t;
    if (aviso) aviso.textContent = extra || '';
  }

  /* La tele tiene su propia cache HTTP y es de las que sirve lo de ayer sin
     preguntar. El parametro de tiempo la esquiva, igual que el no-store. */
  function url() {
    return ORIGEN + 'index.html?_=' + Date.now();
  }

  /* Lo que baje tiene que PARECER MOOVIN antes de darlo por bueno. En una red
     con portal cautivo, un fetch devuelve 200 y una pagina de login: sin esta
     comprobacion, esa pagina se guardaria como copia de respaldo y sustituiria
     a la buena para siempre. */
  function pareceMoovin(html) {
    return typeof html === 'string' &&
      html.length > 20000 &&
      html.indexOf('id="lib-grid"') !== -1 &&
      html.indexOf('id="stage"') !== -1;
  }

  /* El HTML de MOOVIN trae rutas relativas (adaptable.css, adaptable.js, el
     manifiesto) y dos absolutas a la raiz del sitio. Con <base> las relativas
     ya apuntan a la web; las absolutas se dejan como estan porque el navegador
     las resuelve contra el origen del documento, que aqui es el paquete, asi
     que hay que reescribirlas a mano. */
  function preparar(html) {
    html = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + BASE + '">');
    html = html.replace(/(href|src)="\/(?!\/)/gi, '$1="https://iris.it.com/');
    return html;
  }

  function monta(html) {
    var doc = document;
    doc.open();
    doc.write(preparar(html));
    doc.close();
  }

  function guardado(clave) {
    try { return localStorage.getItem(clave); } catch (e) { return null; }
  }

  function guarda(clave, texto) {
    try { localStorage.setItem(clave, texto); } catch (e) {
      // Cuota llena o almacenamiento capado: no es motivo para no arrancar.
    }
  }

  /* La copia de respaldo tiene que ser AUTOSUFICIENTE. El HTML de MOOVIN pide
     adaptable.css y adaptable.js por su cuenta, y si se llego aqui es porque la
     web no contesta: esas dos peticiones tampoco iban a llegar, y la copia
     abriria sin capa adaptable, o sea sin navegacion por mando. Se guardan los
     tres archivos y al usar el respaldo se meten dentro del HTML. */
  function empotra(html) {
    var css = guardado(COPIA_CSS), js = guardado(COPIA_JS);
    if (css) {
      html = html.replace(/<link[^>]+href="adaptable\.css"[^>]*>/i,
        '<style>' + css + '</style>');
    }
    if (js) {
      html = html.replace(/<script[^>]+src="adaptable\.js"[^>]*><\/script>/i,
        '<' + 'script>' + js + '</' + 'script>');
    }
    return html;
  }

  function tiraDeLaCopia(motivo) {
    var html = guardado(COPIA);
    if (html) {
      di('Sin conexion con el estudio. Abriendo la ultima version guardada.');
      setTimeout(function () { monta(empotra(html)); }, 600);
      return;
    }
    di('No hay conexion.',
      'MOOVIN necesita internet la primera vez para descargar la aplicacion. ' +
      'Comprueba la red del televisor y vuelve a abrirla. (' + motivo + ')');
  }

  /* Los dos archivos de la capa adaptable se bajan para dejar el respaldo
     completo. Tiene que ser ANTES de montar: document.write cierra el documento
     viejo y con el se van las peticiones que estuvieran en vuelo, asi que
     lanzarlas y montar acto seguido seria no guardar nunca nada.
     Son 30 KB entre los dos y el plazo es corto: si no llegan a tiempo se monta
     igual y el respaldo se completara en el proximo arranque. */
  function refrescaRespaldo(luego) {
    var pendientes = 2, listo = false;
    function fin() {
      if (listo) return;
      listo = true;
      luego();
    }
    var reloj = setTimeout(fin, 2500);
    [[COPIA_CSS, 'adaptable.css'], [COPIA_JS, 'adaptable.js']].forEach(function (par) {
      var x = new XMLHttpRequest();
      function acaba() {
        pendientes--;
        if (pendientes <= 0) { clearTimeout(reloj); fin(); }
      }
      try { x.open('GET', ORIGEN + par[1] + '?_=' + Date.now(), true); } catch (e) { acaba(); return; }
      x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        if (x.status >= 200 && x.status < 300 && x.responseText) guarda(par[0], x.responseText);
        acaba();
      };
      try { x.send(); } catch (e) { acaba(); }
    });
  }

  /* XMLHttpRequest y no fetch: el navegador de los televisores mas viejos no
     trae fetch, y aqui no hay forma de saber cual va a tocar. */
  function baja() {
    var xhr = new XMLHttpRequest();
    var cerrado = false;
    var reloj = setTimeout(function () {
      if (cerrado) return;
      cerrado = true;
      try { xhr.abort(); } catch (e) {}
      tiraDeLaCopia('tardo demasiado');
    }, ESPERA);

    try { xhr.open('GET', url(), true); } catch (e) {
      clearTimeout(reloj); tiraDeLaCopia('no se pudo pedir'); return;
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || cerrado) return;
      cerrado = true;
      clearTimeout(reloj);
      if (xhr.status >= 200 && xhr.status < 300 && pareceMoovin(xhr.responseText)) {
        var html = xhr.responseText;
        guarda(COPIA, html);
        di('Listo.');
        refrescaRespaldo(function () { monta(html); });
      } else {
        tiraDeLaCopia('respuesta ' + xhr.status);
      }
    };
    try { xhr.send(); } catch (e) {
      clearTimeout(reloj); cerrado = true; tiraDeLaCopia('fallo la conexion');
    }
  }

  /* La tecla de volver tiene que hacer algo TAMBIEN mientras se carga: si la
     descarga se queda colgada, sin esto no hay forma de salir de la aplicacion
     salvo el boton de inicio del mando. */
  document.addEventListener('keydown', function (e) {
    if (e.keyCode !== 10009 && e.keyCode !== 10182) return;
    if (window.tizen && window.tizen.application) {
      try { window.tizen.application.getCurrentApplication().exit(); } catch (err) {}
    }
  });

  baja();
})();
