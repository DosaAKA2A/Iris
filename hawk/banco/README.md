# HAWK — banco de coordenadas

Herramienta de taller, no va al navegador. Construye el catálogo de sitios que
HAWK usa como rondas, a partir de la cobertura de [Mapillary](https://www.mapillary.com).

Se ejecuta **una vez** (y luego cuando se quiera refrescar). El juego en marcha
no consulta nada de esto: saca un punto ya cocinado del banco y listo.

## Por qué existe

Mapillary es colaborativo, y su cobertura está brutalmente sesgada: hay ciudades
europeas con cientos de miles de fotos y países enteros casi vacíos. Si el banco
fuera proporcional a las fotos disponibles, el jugador aprendería a adivinar por
dónde hay cobertura en vez de por lo que ve, y el juego se rompería.

Por eso el banco no se recoge, se **cura**:

- **Cupo por país**, entre 60 y 500 puntos, con un empujón suave por superficie
  (`paises.js`). Rusia vale unas siete veces Malta, no cincuenta mil.
- **Solo esféricas de 360.** Las fotos planas de móvil no dan una ronda jugable.
- **Separación mínima de 2 km** entre dos puntos del mismo país, y como mucho
  2 fotos del mismo recorrido, para que el banco no sean 200 vistas de la misma
  calle.
- **Nada anterior a 8 años.**

## Uso

```bash
npm install

# El token no se versiona: vive en banco/.env, que está en el .gitignore.
node --env-file=.env construir.js --probar     # comprobación rápida (~10 s)
node --env-file=.env construir.js              # el barrido completo
node construir.js --resumen                    # qué hay construido
node --env-file=.env construir.js --pais PE,CL # rehacer países sueltos
```

El token sale de <https://www.mapillary.com/dashboard/developers>, aplicación
`HAWK`, permiso `read`. Formato `MLY|<id>|<secreto>`.

## Las tres pasadas

1. **SEMBRAR** — barre el mundo entero a z5 (1.024 teselas) para saber *dónde*
   hay fotos. Los países que quedan mal servidos reciben una pasada extra sobre
   su propio recuadro, a z8.
2. **COSECHAR** — cada semilla se convierte en una tesela de detalle (z14), de
   la que salen las esféricas. Aquí se aplican el espaciado y los cupos.
3. **REMATAR** — una muestra de cada país se confirma contra el grafo: que la
   foto siga viva y sea esférica de verdad. Queda registrado como `salud` en el
   índice.

Sale a `../shared/banco/<ISO>.json` más un `indice.json` con el recuento y la
salud de cada país. Techo teórico: unos 24.800 puntos en 237 países.

## Lo que hay que saber antes de lanzarlo

- **Es reanudable.** Cada país terminado se guarda en `datos/progreso.json` y
  las semillas en `datos/semillas.json`. Si se corta, se relanza y sigue.
- **Tarda.** Del orden de una hora larga. Las teselas de ciudad grande son
  enormes: una sola de Lima trae 177.000 fotos y pesa lo suyo.
- **Roza el límite diario de teselas.** Mapillary permite 50.000 al día y un
  banco completo anda por las 25.000–35.000. Si se agota, corta y se sigue al
  día siguiente sin perder nada.
- Las dos consultas a la API están separadas a propósito: el descubrimiento va
  siempre por teselas (baratas y masivas) y el grafo solo remata candidatos ya
  filtrados. La búsqueda por área del grafo NO sirve aquí, está limitada a
  recuadros de un kilómetro.

## Atribución

Las imágenes de Mapillary son **CC BY-SA 4.0**. El crédito tiene que aparecer
en el juego, junto al panorama.
