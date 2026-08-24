/* HAWK — visor de esfericas de 360.
   ---------------------------------------------------------------------------
   No hay esfera ni geometria: se pinta UN triangulo que tapa la pantalla y el
   shader calcula, por cada pixel, hacia donde apunta ese rayo y va a buscar esa
   muestra a la equirectangular. Sale mas barato que teselar una esfera y no
   deja costuras en los polos.

   Medido en una RTX 5070 a 3440x1249: 5,5 ms por cuadro, y da IGUAL que la
   textura sea de 2048 o de 5760. El coste va con los pixeles de pantalla, no
   con el tamaño de la imagen, asi que servir la foto grande es gratis en tiempo
   de cuadro y solo cuesta descarga.

   Uso:
     const visor = crearVisor(lienzo);
     await visor.cargar(url);
     visor.arranca();
*/

const VERT = `
attribute vec2 pos;
void main(){ gl_Position = vec4(pos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uFov;    // campo VERTICAL, en radianes
uniform float uYaw;
uniform float uPitch;
uniform sampler2D uTex;
const float PI = 3.14159265359;

void main(){
  /* Pixel -> rayo en el espacio de la camara. Se normaliza por la altura para
     que el campo vertical no dependa de lo ancha que sea la ventana. */
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y);
  vec3 d = normalize(vec3(p.x * tan(uFov * 0.5), p.y * tan(uFov * 0.5), -1.0));

  float cp = cos(uPitch), sp = sin(uPitch);
  d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
  float cy = cos(uYaw), sy = sin(uYaw);
  d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);

  /* Rayo -> equirectangular. El CENTRO de la imagen es la direccion a la que
     apuntaba la camara, no el meridiano cero. */
  float lon = atan(d.x, -d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  gl_FragColor = texture2D(uTex, vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI));
}`;

const FOV_MIN = 0.5, FOV_MAX = 1.9;      // de teleobjetivo a gran angular
const TOPE_PITCH = Math.PI / 2 - 0.02;   // sin esto la vista se voltea en el cenit
const FOV_INICIAL = 1.3;

export class SinWebGL extends Error {}

export function crearVisor(lienzo, { alPintar = null, fov = FOV_INICIAL } = {}) {
  /* WebGL2 primero, y no por gusto: las esfericas de Mapillary NO vienen en
     potencias de dos —hay originales de 5760x2880— y WebGL1 no admite REPEAT en
     una textura asi: la da por incompleta y la pinta NEGRA, sin avisar de nada.
     WebGL2 no tiene esa limitacion. Con WebGL1 se reescala antes de subirla. */
  const opciones = { antialias: false, alpha: false };
  const gl = lienzo.getContext('webgl2', opciones) || lienzo.getContext('webgl', opciones);
  if (!gl) throw new SinWebGL('Este navegador no da contexto WebGL.');
  const ES2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

  const programa = compilar(gl);
  const u = {
    res: gl.getUniformLocation(programa, 'uRes'),
    fov: gl.getUniformLocation(programa, 'uFov'),
    yaw: gl.getUniformLocation(programa, 'uYaw'),
    pitch: gl.getUniformLocation(programa, 'uPitch'),
  };

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  /* Un triangulo sobredimensionado tapa la pantalla con menos trabajo que dos
     que formen un cuadrado. */
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(programa, 'pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const textura = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textura);
  /* REPEAT en horizontal, que la equirectangular da la vuelta entera y el borde
     derecho continua en el izquierdo. CLAMP en vertical: arriba y abajo no
     continuan en ningun sitio. */
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const cam = { yaw: 0, pitch: 0, fov };
  const meta = { yaw: 0, pitch: 0, fov }; // a donde va; `cam` lo persigue
  let corriendo = false, animacion = 0;
  let tamImagen = [0, 0];
  let bloqueado = false;   // durante el repaso de la ronda no se debe mover

  /* --------------------------- entrada --------------------------- */

  let arrastrando = false, ultimo = null;

  lienzo.addEventListener('pointerdown', (e) => {
    if (bloqueado) return;
    arrastrando = true; ultimo = { x: e.clientX, y: e.clientY };
    lienzo.classList.add('agarrando');
    try { lienzo.setPointerCapture(e.pointerId); } catch { /* puntero sintetico */ }
  });
  const soltar = (e) => {
    arrastrando = false; ultimo = null;
    lienzo.classList.remove('agarrando');
    try { lienzo.releasePointerCapture(e.pointerId); } catch { /* ya soltado */ }
  };
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);

  lienzo.addEventListener('pointermove', (e) => {
    if (!arrastrando || !ultimo || bloqueado) return;
    /* El giro se escala con el campo: en teleobjetivo el mismo gesto tiene que
       mover menos, o mirar de cerca es imposible. */
    const k = meta.fov / lienzo.clientHeight;
    /* Se agarra el MUNDO, no la camara: arrastrar a la derecha lleva el paisaje
       a la derecha, como en Street View. Los dos ejes van en el mismo sentido;
       con uno agarrando y el otro empujando, la mano no se acostumbra nunca. */
    meta.yaw += (e.clientX - ultimo.x) * k;
    meta.pitch = acotar(meta.pitch + (e.clientY - ultimo.y) * k, -TOPE_PITCH, TOPE_PITCH);
    ultimo = { x: e.clientX, y: e.clientY };
  });

  lienzo.addEventListener('wheel', (e) => {
    if (bloqueado) return;
    e.preventDefault();
    meta.fov = acotar(meta.fov * (e.deltaY > 0 ? 1.12 : 0.89), FOV_MIN, FOV_MAX);
  }, { passive: false });

  /* Las flechas NO agarran el mundo: mueven la mirada, que es lo que se espera
     de un teclado. Es el sentido contrario al del arrastre, a proposito. */
  const teclas = (e) => {
    if (bloqueado) return;
    if (e.key === 'ArrowLeft') meta.yaw += 0.12;
    else if (e.key === 'ArrowRight') meta.yaw -= 0.12;
    else if (e.key === 'ArrowUp') meta.pitch = acotar(meta.pitch + 0.09, -TOPE_PITCH, TOPE_PITCH);
    else if (e.key === 'ArrowDown') meta.pitch = acotar(meta.pitch - 0.09, -TOPE_PITCH, TOPE_PITCH);
    else return;
    e.preventDefault();
  };
  addEventListener('keydown', teclas);

  /* --------------------------- bucle --------------------------- */

  /* Dibujar y avanzar el bucle son cosas distintas, y separarlas importa: hay
     situaciones donde requestAnimationFrame no corre —pestaña en segundo plano,
     navegador sin compositor— y aun asi hace falta dejar UN cuadro bueno en
     pantalla. Si no, quien mire esa pestaña vera negro y creera que esta roto. */
  function dibuja() {
    redimensionar();
    gl.useProgram(programa);
    gl.uniform2f(u.res, lienzo.width, lienzo.height);
    gl.uniform1f(u.fov, cam.fov);
    gl.uniform1f(u.yaw, cam.yaw);
    gl.uniform1f(u.pitch, cam.pitch);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* Un fallo pintando un numerito no puede tumbar el visor. */
    try {
      alPintar?.(estado());
    } catch (e) {
      console.error('HAWK visor: fallo en alPintar, el bucle sigue.', e);
    }
  }

  function cuadro() {
    /* Suavizado exponencial: el arrastre marca el destino y la camara lo
       persigue, asi que soltar el raton no corta el movimiento en seco. */
    cam.yaw += (meta.yaw - cam.yaw) * 0.22;
    cam.pitch += (meta.pitch - cam.pitch) * 0.22;
    cam.fov += (meta.fov - cam.fov) * 0.18;

    /* El siguiente cuadro se programa ANTES de dibujar, no despues: asi una
       excepcion cualquiera no rompe la cadena y deja la imagen congelada. */
    if (corriendo) animacion = requestAnimationFrame(cuadro);
    dibuja();
  }

  function redimensionar() {
    /* Topado a 2: en una pantalla a 3x, cuadruplicar el trabajo del shader no
       se nota en la imagen y si en el cuadro. */
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const a = Math.round(lienzo.clientWidth * dpr);
    const h = Math.round(lienzo.clientHeight * dpr);
    if (lienzo.width !== a || lienzo.height !== h) {
      lienzo.width = a; lienzo.height = h;
      gl.viewport(0, 0, a, h);
    }
  }

  /* --------------------------- api --------------------------- */

  function estado() {
    return {
      yaw: cam.yaw, pitch: cam.pitch, fov: cam.fov,
      /* Campo horizontal, que es el que decide cuanto mundo se ve de lado a
         lado y el que necesita la brujula para ir al paso del paisaje. */
      fovH: 2 * Math.atan(Math.tan(cam.fov / 2) * (lienzo.clientWidth / lienzo.clientHeight)),
      imagen: tamImagen,
    };
  }

  async function cargar(fuente) {
    const img = fuente instanceof HTMLCanvasElement ? fuente : new Image();
    if (!(fuente instanceof HTMLCanvasElement)) {
      img.crossOrigin = 'anonymous';  // sin esto la textura sale negra: el CDN es de otro origen
      await new Promise((ok, mal) => { img.onload = ok; img.onerror = mal; img.src = fuente; });
    }
    gl.bindTexture(gl.TEXTURE_2D, textura);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, aPotenciaDeDos(img, ES2));
    tamImagen = [img.naturalWidth || img.width, img.naturalHeight || img.height];
    /* Un cuadro nada mas subir la textura, sin esperar al bucle. Si se deja para
       el siguiente rAF y ese rAF no llega —pestaña oculta— la foto recien
       cargada no se llega a ver nunca. */
    dibuja();
    return tamImagen;
  }

  function mirarA({ yaw = 0, pitch = 0, fov: f = FOV_INICIAL } = {}, deGolpe = true) {
    meta.yaw = yaw; meta.pitch = acotar(pitch, -TOPE_PITCH, TOPE_PITCH); meta.fov = acotar(f, FOV_MIN, FOV_MAX);
    if (deGolpe) { cam.yaw = meta.yaw; cam.pitch = meta.pitch; cam.fov = meta.fov; dibuja(); }
  }

  return {
    cargar,
    mirarA,
    estado,
    get bloqueado() { return bloqueado; },
    set bloqueado(v) { bloqueado = !!v; if (v) { arrastrando = false; ultimo = null; } },
    arranca() { if (!corriendo) { corriendo = true; cuadro(); } },
    para() { corriendo = false; cancelAnimationFrame(animacion); },
    destruir() { this.para(); removeEventListener('keydown', teclas); },
  };
}

/* --------------------------- utilidades --------------------------- */

const acotar = (v, a, b) => Math.max(a, Math.min(b, v));
const esPot = (n) => (n & (n - 1)) === 0;

/* Red de seguridad para WebGL1: si la esferica no mide potencia de dos se
   reescala a la mas cercana antes de subirla. Cuesta una pasada de dibujo y
   algo de nitidez, pero es preferible a un cuadro negro. En WebGL2 sobra. */
function aPotenciaDeDos(img, ES2) {
  const ancho = img.naturalWidth || img.width;
  const alto = img.naturalHeight || img.height;
  if (ES2 || (esPot(ancho) && esPot(alto))) return img;

  const c = document.createElement('canvas');
  c.width = Math.min(2 ** Math.round(Math.log2(ancho)), 4096);
  c.height = c.width / 2;                    // la equirectangular es 2:1 siempre
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function compilar(gl) {
  const p = gl.createProgram();
  for (const [tipo, fuente] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const s = gl.createShader(tipo);
    gl.shaderSource(s, fuente);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new SinWebGL(`El shader no compila: ${gl.getShaderInfoLog(s)}`);
    }
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new SinWebGL(gl.getProgramInfoLog(p));
  return p;
}
