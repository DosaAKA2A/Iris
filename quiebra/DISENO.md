# QUIEBRA — documento de diseño

Juego web multijugador para 2–4 personas, de IRIS Studio. Lema: **"Arruina a tus amigos."**

Referencia de partida: Monopoly. Qué lo lleva más allá: minijuegos simultáneos para todos
los jugadores (estilo party/friend-slop), cartas de sabotaje dirigidas, personajes con
habilidades asimétricas y final por rondas con patrimonio (no por eliminación eterna).
Partida objetivo: 25–40 minutos.

## Flujo de sala

1. Un jugador crea la sala y recibe un código de 4 letras.
2. Los demás entran con el código (enlace directo `?sala=CODE` también vale).
3. Cada uno elige personaje (únicos, primero en llegar se lo queda) y el anfitrión inicia.
4. Reconexión: un token en localStorage permite volver a la partida si se cae la pestaña.

## Tablero

Anillo de 24 casillas (7 por lado de una parrilla 7×7, esquinas compartidas).

| # | Casilla | Tipo |
|---|---------|------|
| 0 | SALIDA — cobras $200 al pasar | esquina |
| 1 | Puesto de Empanadas | negocio COBRE |
| 2 | AZAR | carta |
| 3 | Lavandería 24h | negocio COBRE |
| 4 | MINIJUEGO | minijuego |
| 5 | Cíber Renacer | negocio COBRE |
| 6 | SIESTA — no pasa nada | esquina |
| 7 | Gimnasio Momentum | negocio JADE |
| 8 | AZAR | carta |
| 9 | Barbería El Filo | negocio JADE |
| 10 | EL BACHE — pierdes $75, van al bote | trampa |
| 11 | Cafetería Ojeras | negocio JADE |
| 12 | EL BOTE — te llevas lo acumulado | esquina |
| 13 | Sushi Neón | negocio VIOLETA |
| 14 | MINIJUEGO | minijuego |
| 15 | Arcade Vórtice | negocio VIOLETA |
| 16 | AZAR | carta |
| 17 | Rooftop Malbec | negocio VIOLETA |
| 18 | MUDANZA — muévete a cualquier negocio libre o tuyo | esquina |
| 19 | Torre Espejo | negocio ORO |
| 20 | IMPUESTOS — pagas 10% de tu efectivo (mín $50) | impuesto |
| 21 | Casino Lunar | negocio ORO |
| 22 | MINIJUEGO | minijuego |
| 23 | Heliopuerto | negocio ORO |

Precios por barrio (compra / renta base / renta con barrio completo ×2 / reforma = 60% del
precio, renta ×2.5): COBRE $120–160, JADE $200–240, VIOLETA $280–320, ORO $360–440.

## Turno

Dos dados (2d6). Antes de tirar puedes jugar 1 carta de tu mano. Caes, resuelves la
casilla (comprar, pagar renta, carta, minijuego...), puedes reformar UN negocio tuyo y
terminas. Timer anti-AFK de 45 s: se tira solo, no compra nada.

## Minijuegos (juegan LOS 4 a la vez)

Cuando alguien cae en MINIJUEGO, todos juegan. Semilla y deadline los pone el servidor;
los clientes mandan su resultado y el servidor rankea al vencer el plazo (sin enviar = 0).
Premios: 1.º $150 + trofeo, 2.º $75, 3.º $25, 4.º nada. Los trofeos valen $100 extra al final.

1. **DUELO DE CLICS** — 5 segundos, gana quien más veces cliquea.
2. **SEMÁFORO** — espera el verde y cliquea; clicar antes te descalifica.
3. **MEMORIA** — repite una secuencia de 6 luces; gana el más rápido sin fallar.
4. **CAZAMONEDAS** — 10 segundos cazando monedas que aparecen y desaparecen.

## Cartas de AZAR

Sucesos instantáneos: PROPINA +$120 · MULTA −$80 · CUMPLEAÑOS (cada rival te da $40) ·
APAGÓN (vas a SIESTA).

Cartas de mano (máx. 3, se juegan antes de tirar):

- **DADO TRUCADO** — eliges el resultado de tu tirada (2–12).
- **MUDANZA FORZOSA** — mandas a un rival a EL BACHE.
- **ALQUILER CONGELADO** — nadie te cobra renta durante una ronda completa.
- **IMPUESTO REVOLUCIONARIO** — robas el 15% del efectivo del jugador más rico.
- **OKUPA** — marcas un negocio rival: su próxima renta te la llevas tú.
- **SEGURO** — anula automáticamente la próxima carta que te ataque.

## Personajes (habilidades asimétricas)

| Personaje | Apodo | Habilidad |
|-----------|-------|-----------|
| RATA | La Codiciosa | Cobra $280 en vez de $200 al pasar por SALIDA |
| PULPO | El Manitas | Negocios y reformas 15% más baratos |
| CABRA | La Cabezona | Premios de minijuego +50% y gana los empates |
| POLILLA | La Ladrona | Roba $40 al caer en la casilla de un rival; al robar carta, 25% de sacar dos |

## Final y victoria

La partida dura 10 rondas (el anfitrión puede elegir 8/10/14). Si alguien quiebra
(no puede pagar ni vendiendo reformas), queda "en la lona" como espectador. Al final:

**Patrimonio = efectivo + valor pagado en negocios y reformas + $100 por trofeo.**

Mayor patrimonio gana. Desempate: más trofeos, luego más efectivo.

## Social

Chat rápido de frases prehechas (sin texto libre, sin moderación que mantener) y
reacciones que flotan sobre el panel del jugador. Sin emojis en la UI: todo icono es SVG.

## Puesta en escena

El servidor manda el resultado entero de golpe (dados + posición + dinero). El cliente
lo reparte en el tiempo con una cola de animación: primero ruedan los dados 3D, después
el peón salta casilla a casilla, y solo cuando aterriza se revelan las cartas y se mueve
el dinero. Para eso los avisos de efecto (`fx`) se guardan en un buzón y se consumen
cuando llega el estado que los explica; mientras dura la escena, el panel de acciones
enseña "fulano avanza…" en vez de destripar dónde va a caer.

Si la pestaña está en segundo plano (Chrome estrangula los `setTimeout`) o la escena se
alarga más de 9 s, las esperas se saltan enteras y se va directo al estado final: nunca
se pierde el turno mirando una animación.

`js/fx.js` es el motor de efectos: un único canvas a pantalla completa para partículas
(monedas, chispas, confeti, humo), números flotantes en DOM, sacudidas, viñetas y
contadores. El bucle de `requestAnimationFrame` solo corre mientras hay partículas
vivas; en reposo no queda nada girando.

## Créditos de los assets

Sonido e iconos son de **Kenney** (<https://kenney.nl>), dominio público (CC0 1.0):

- *Casino Audio* — dados, fichas y cartas.
- *Interface Sounds* — clics, confirmaciones y errores.
- *Impact Sounds* — golpes y cristal.
- *Music Jingles* — remates de victoria y derrota.
- *Board Game Icons* — los trazados de `js/iconos.js` (convertidos a paths inline para
  que hereden `currentColor`).

Las caras de los personajes y los peones (`js/personajes.js`) son vector propio.
Tipografías: Archivo Black, Inter y Geist Mono (Google Fonts).

## Arquitectura

- **Frontend**: estático en `iris.it.com/quiebra/` (este repo, GitHub Pages). Vanilla JS
  con módulos ES, sin build. La definición del tablero/cartas vive en `shared/data.js`,
  importada por cliente Y servidor (una sola fuente de verdad).
- **Backend**: Cloudflare Worker `quiebra` con un Durable Object (SQLite, plan gratuito)
  por sala (`idFromName(código)`). Sockets con API de hibernación; el estado se persiste
  en `ctx.storage` en cada mutación y los timers (turno, minijuego) usan alarms, así la
  partida sobrevive a hibernaciones y deploys.
- **Autoridad**: todo lo decide el servidor (dados, cartas, rankings). El cliente solo
  pinta y pide. Los minijuegos confían en el score reportado (juego entre amigos).
