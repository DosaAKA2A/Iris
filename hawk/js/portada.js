/* HAWK — portada.
   ---------------------------------------------------------------------------
   De momento hace una sola cosa: dejar el codigo de sala limpio mientras se
   escribe. Los botones estan apagados en el HTML porque el servidor de salas
   todavia no existe; cuando exista, se quitan los `disabled` y este archivo
   pasa a hablar con el worker.

   Nada de animaciones aqui: la entrada es CSS y se para sola. */

const codigo = document.getElementById('in-codigo');
const formEntrar = document.getElementById('form-entrar');

/* Solo letras, siempre en mayuscula. Sin I ni O: se confunden con 1 y 0, que es
   la misma regla que usa QUIEBRA para repartir codigos. */
const LETRAS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ]/g;

codigo?.addEventListener('input', () => {
  const limpio = codigo.value.toUpperCase().replace(LETRAS, '').slice(0, 4);
  if (limpio !== codigo.value) codigo.value = limpio;
});

/* Aun no lleva a ningun sitio: que no recargue la pagina por si acaso. */
formEntrar?.addEventListener('submit', (e) => e.preventDefault());

/* Si alguien llega con ?sala=ABCD, se deja escrito para cuando abramos. */
const sala = new URLSearchParams(location.search).get('sala');
if (sala && codigo) codigo.value = sala.toUpperCase().replace(LETRAS, '').slice(0, 4);
