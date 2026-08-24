/* HAWK — distancia y puntuacion.
   ---------------------------------------------------------------------------
   Todo lo que decide quien gana una ronda vive aqui, aparte del visor y del
   mapa, porque el servidor de salas va a tener que puntuar exactamente igual
   que el navegador y no puede depender de ninguno de los dos.
*/

const R_TIERRA = 6371.0088;   // radio medio, en km

/* Distancia sobre la superficie entre dos puntos. Haversine y no una resta de
   grados: un grado de longitud mide 111 km en el ecuador y 43 en Oslo, asi que
   restar coordenadas regalaria puntos en el norte y los quitaria en el tropico. */
export function distanciaKm(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TIERRA * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const PUNTOS_MAX = 5000;

/* El tamaño del mapa en juego. Con el mundo entero son ~14.917 km, que es la
   constante que usa GeoGuessr; se deja como parametro porque los mapas por
   continente tienen que puntuar mas duro (acertar Francia dentro de Europa no
   puede valer lo mismo que acertar Francia dentro del planeta). */
export const TAMANO_MUNDO = 14916.862;

/* Caida exponencial, no lineal, y esa es la decision de diseño: con una recta,
   fallar por 500 km y fallar por 3.000 se parecerian demasiado y daria igual
   mirar la foto. Asi los primeros kilometros cuestan carisimos y a partir de
   cierto punto ya da lo mismo lo perdido que estes.

        0 km -> 5000         1 km -> 4997
       25 km -> 4917       100 km -> 4676
      500 km -> 3576     2.000 km -> 1308
    5.000 km ->  175    10.000 km ->    6 */
export function puntos(km, tamano = TAMANO_MUNDO) {
  return Math.round(PUNTOS_MAX * Math.exp(-10 * km / tamano));
}

/* Redondeo con criterio: a 12 metros no se dice "0,012 km" y a 3.000 km no se
   dicen los metros. */
export function distanciaBonita(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('es')} km`;
}

/* Los puntos van con separador de miles porque son la cifra que se compara
   entre jugadores y se lee de un vistazo. */
export const puntosBonitos = (p) => p.toLocaleString('es');

/* Un veredicto corto para acompañar al numero. Sin esto la ronda termina en una
   cifra seca y no se sabe si 3.500 es bueno o malo. */
export function veredicto(km) {
  if (km < 0.15) return 'En el sitio exacto';
  if (km < 1) return 'En la misma calle';
  if (km < 10) return 'En la misma ciudad';
  if (km < 50) return 'Muy cerca';
  if (km < 200) return 'En la zona';
  if (km < 1000) return 'En el pais, mas o menos';
  if (km < 3000) return 'Continente correcto';
  return 'Otro continente';
}
