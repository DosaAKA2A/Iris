-- MOOVIN — esquema de D1 (cuentas, dispositivos y pases).
--
-- Reglas que codifica este esquema:
--   - Se entra SOLO con el correo (código de 6 caracteres). No hay contraseñas.
--   - El acceso a la biblioteca es un CAMPO de la cuenta, no una licencia
--     aparte: aquí no se vende nada, Dosa da o quita el acceso a mano desde el
--     backoffice.
--   - Un dispositivo (el televisor) no tiene cuenta propia: cuelga de la de
--     alguien. Se empareja escaneando el QR desde un móvil que ya entró, y a
--     partir de ahí entra solo sin que nadie escriba el pase en la tele.
--   - Nada de claves en claro salvo la entrega del emparejamiento, que vive
--     diez minutos y está protegida por el secreto que se quedó el televisor.
--   - El pase compartido de siempre (el secreto MOOVIN_PASE) sigue existiendo
--     y no se toca: nadie se queda fuera mientras las cuentas se llenan.

CREATE TABLE IF NOT EXISTS usuarios (
  id            TEXT PRIMARY KEY,
  correo        TEXT NOT NULL UNIQUE,            -- normalizado a minúsculas
  nombre        TEXT NOT NULL DEFAULT '',
  codigo        TEXT NOT NULL UNIQUE,            -- 6 caracteres, para soporte; NO sirve para entrar
  avatar        TEXT NOT NULL DEFAULT '',        -- nombre del elenco, o 'avatares/<id>.webp' en el bucket
  rol           TEXT NOT NULL DEFAULT 'usuario', -- usuario | admin
  estado        TEXT NOT NULL DEFAULT 'activa',  -- activa | bloqueada
  -- Identificador OPACO de la cuenta de Naviris atada a esta, o NULL. NO es
  -- el correo: el de Naviris no se verifica nunca y no prueba nada. Se ata
  -- desde dentro de MOOVIN, con la sesion puesta.
  naviris_id    TEXT,
  acceso        INTEGER NOT NULL DEFAULT 0,      -- 0 = sin biblioteca, 1 = con biblioteca
  acceso_caduca INTEGER,                         -- NULL = sin caducidad
  creado        INTEGER NOT NULL,
  visto         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_usuarios_creado ON usuarios(creado DESC);
-- Una cuenta de Naviris ata a UNA de MOOVIN. En SQLite un indice unico deja
-- pasar todos los NULL que quiera, asi que las no vinculadas no estorban.
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_naviris ON usuarios(naviris_id);

-- Código de acceso de un solo uso. Uno vivo por correo: pedir otro pisa el
-- anterior, así que nadie acumula intentos abriendo códigos.
CREATE TABLE IF NOT EXISTS codigos (
  correo   TEXT PRIMARY KEY,
  hash     TEXT NOT NULL,
  caduca   INTEGER NOT NULL,
  intentos INTEGER NOT NULL DEFAULT 0,
  creado   INTEGER NOT NULL
);

-- La sesión del navegador o del móvil. El token va en claro al cliente; aquí
-- solo se guarda su hash.
CREATE TABLE IF NOT EXISTS sesiones (
  hash       TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  creada     INTEGER NOT NULL,
  vista      INTEGER NOT NULL,
  caduca     INTEGER NOT NULL,
  ua         TEXT,
  pais       TEXT
);
CREATE INDEX IF NOT EXISTS ix_sesiones_usuario ON sesiones(usuario_id, vista DESC);

-- Un televisor emparejado. Vive aparte de las sesiones porque no caduca a los
-- 30 días (una tele no vuelve a escribir nada nunca) y porque se quiere poder
-- desemparejarlo por su cuenta sin cerrar el móvil.
CREATE TABLE IF NOT EXISTS dispositivos (
  hash       TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  nombre     TEXT NOT NULL DEFAULT 'Pantalla',
  creado     INTEGER NOT NULL,
  visto      INTEGER NOT NULL DEFAULT 0,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS ix_dispositivos_usuario ON dispositivos(usuario_id, visto DESC);

-- Emparejamiento del televisor. La tele pide un código, se queda un secreto que
-- NUNCA sale de ella (el QR solo lleva el código) y pregunta cada dos segundos.
-- El móvil confirma con su sesión. `entrega` es la clave del dispositivo recién
-- creada, en claro, hasta que la tele la recoge: vive diez minutos como mucho y
-- solo la suelta quien enseña el secreto.
CREATE TABLE IF NOT EXISTS vinculos (
  codigo       TEXT PRIMARY KEY,
  secreto_hash TEXT NOT NULL,
  creado       INTEGER NOT NULL,
  caduca       INTEGER NOT NULL,
  usuario_id   TEXT,
  entrega      TEXT
);
CREATE INDEX IF NOT EXISTS ix_vinculos_caduca ON vinculos(caduca);

-- Pases temporales para quien no tiene cuenta: se acuñan en el backoffice, se
-- dan a mano y caducan solos. El pase compartido de siempre (MOOVIN_PASE) no
-- vive aquí; es un secreto del worker y no caduca.
CREATE TABLE IF NOT EXISTS pases (
  hash     TEXT PRIMARY KEY,
  pista    TEXT NOT NULL,                    -- últimos 4 caracteres, para reconocerlo
  nota     TEXT,
  caduca   INTEGER,                          -- NULL = sin caducidad
  usos     INTEGER NOT NULL DEFAULT 0,
  max_usos INTEGER,                          -- NULL = sin tope
  estado   TEXT NOT NULL DEFAULT 'activo',   -- activo | anulado
  creado   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pases_creado ON pases(creado DESC);

-- Rate limit global. En D1 y no en el binding del worker porque el binding
-- cuenta por centro de datos: para pedir códigos eso no sirve.
CREATE TABLE IF NOT EXISTS limites (
  clave   TEXT PRIMARY KEY,
  cuenta  INTEGER NOT NULL DEFAULT 0,
  ventana INTEGER NOT NULL                   -- epoch en que el cubo expira
);
CREATE INDEX IF NOT EXISTS ix_limites_ventana ON limites(ventana);

CREATE TABLE IF NOT EXISTS eventos (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  tipo    TEXT NOT NULL,
  quien   TEXT,
  detalle TEXT
);
CREATE INDEX IF NOT EXISTS ix_eventos_ts ON eventos(ts DESC);
