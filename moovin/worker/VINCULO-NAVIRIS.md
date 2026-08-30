# Vínculo MOOVIN ↔ Naviris

Lo que hay que implementar **en Naviris** para que deje de dar acceso a la
biblioteca y pase a entrar a la cuenta de MOOVIN de cada quien.

## Por qué no vale con el correo

Naviris entrega hoy dos credenciales que abren la biblioteca a cualquiera que
use Naviris: el pase compartido (`window.__navMoovinPase`) y `NAVIRIS_KEY`
(`POST /entrar-app`). Las dos se van.

Lo que **no** se hace en su lugar es fiarse del correo que diga Naviris. Las
cuentas de Naviris son correo+contraseña y **ese correo no se verifica nunca**:
cualquiera se registra allí con el correo de otro. Si MOOVIN se fiara, entraría
en la cuenta ajena.

Así que se ata un identificador **opaco** de Naviris a la cuenta de MOOVIN, y el
atado se hace **desde dentro de MOOVIN**, que es el único lado donde el correo
está verificado de verdad (hay que haber puesto el código que llegó al buzón).
En el momento de atar, las dos partes están probadas: la de Naviris porque hay
que saber su contraseña, y la de MOOVIN por el código.

Vincular **no** da licencia. Una cuenta vinculada sin acceso a la biblioteca cae
en la sala de espera igual que cualquier otra: son cosas distintas a propósito.

## La prueba

Una cadena corta firmada por el worker de Naviris:

```
v1.<id>.<caduca>.<firma>
```

- `id` — identificador opaco y **estable** de la cuenta de Naviris.
  `[A-Za-z0-9._:-]`, hasta 120 caracteres. No el correo: si alguien cambia de
  correo en Naviris no debe perder el vínculo, y el correo no prueba nada.
- `caduca` — epoch en **segundos**. MOOVIN rechaza lo ya vencido y también lo
  que diga durar más de 10 minutos. Acuñarlas de **2 minutos**.
- `firma` — `HMAC-SHA256` en **base64url sin relleno** sobre el texto
  `v1.<id>.<caduca>`, con la clave compartida.

Clave compartida: **`NAVIRIS_VINCULO_KEY`**. Ya está puesta como secreto en el
worker de MOOVIN; hay copia en `~/.moovin-naviris-vinculo` para ponerla igual en
el worker de Naviris. Se rota cambiándola en los dos a la vez.

Dentro de la ventana de vida, una prueba robada se podría reusar: por eso la
ventana es corta. No viaja por ningún sitio raro — del proceso de Naviris al
worker de MOOVIN, por HTTPS.

Firmarla en el worker de Naviris (Workers, sin dependencias):

```js
async function pruebaMoovin(env, id) {
  const caduca = Math.floor(Date.now() / 1000) + 120;
  const texto = 'v1.' + id + '.' + caduca;
  const clave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.NAVIRIS_VINCULO_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const f = new Uint8Array(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(texto)));
  let s = ''; for (const b of f) s += String.fromCharCode(b);
  const firma = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return texto + '.' + firma;
}
```

Se sirve en un endpoint nuevo del worker de Naviris que exija su sesión — por
ejemplo `POST /moovin/identidad` con el token de 90 días — y devuelva
`{ prueba }`. **El secreto no sale del worker**: si se firmara en el cliente
habría que meter la clave en el instalador, que es exactamente el problema del
que se viene huyendo.

## El puente en el preload

La página de MOOVIN solo espera **una función** inyectada en el `window` de la
webview donde se abre MOOVIN:

```js
window.__navMoovinIdentidad = () => Promise<string>   // la prueba, o ''
```

Se pide una prueba nueva en cada llamada (duran 2 minutos y la página puede
llamar más de una vez: al arrancar y al vincular). Si Naviris no ha entrado con
su cuenta, devolver `''` y ya: MOOVIN enseña su pantalla de entrada de siempre.

Inyectarla **solo** en la webview de MOOVIN (`esMoovin` en `main.js` y el
preload ya distinguen moovin.live y iris.it.com/moovin).

## Lo que hace MOOVIN con eso

| Endpoint | Quién | Qué |
| --- | --- | --- |
| `POST /entrar-naviris` `{prueba}` | nadie (público) | 200 con `{token, usuario}` (una **sesión**, no el pase) si esa cuenta de Naviris está atada. 404 con `{vincular:true}` si no lo está. 401 si la prueba no vale. |
| `POST /cuenta/naviris` `{prueba}` | con sesión de MOOVIN | ata. 409 si esa cuenta de Naviris ya está en otra de MOOVIN. |
| `DELETE /cuenta/naviris` | con sesión de MOOVIN | suelta. |

`perfil(u)` devuelve `naviris: true|false`. El identificador **no** sale nunca
hacia la página: no le sirve de nada y es lo que abre la puerta.

En la base, `usuarios.naviris_id` con índice único (los NULL no estorban). La
migración de la base que ya existe es `migracion-naviris.sql`, aplicada el
2026-08-30.

## Qué se retira, y cuándo

`window.__navMoovinPase`, `POST /entrar-app` y el secreto `NAVIRIS_KEY` se
quitan **cuando la versión de Naviris que firma la prueba esté publicada**, no
antes: retirarlos primero deja fuera a quien no haya actualizado. Mientras
tanto conviven, y en `index.html` la rama de `entrarConApp()` está marcada como
puente a quitar.

## Cómo se prueba sin Naviris

`scratchpad/prueba-vinculo.js` (worker local, los 12 casos del protocolo) y
`prueba-naviris-ui.js` (la página, imitando el preload con una
`__navMoovinIdentidad` que firma en Node). Los dos usan la clave de
`~/.moovin-naviris-vinculo`.
