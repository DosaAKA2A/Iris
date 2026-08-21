# MOOVIN en el televisor (Samsung / Tizen)

MOOVIN se instala en la tele como una aplicación de verdad, con su icono en la
fila de apps. No hay tienda de por medio: se firma con un certificado propio y
se instala desde este PC por la red local, que es lo que Samsung llama modo
desarrollador.

Probado contra un **Samsung CU7105 (TU55CU7105)**, que es Tizen.

---

## Antes de empezar, una vez

### 1. Tizen Studio en este PC

Descargar el instalador de https://developer.samsung.com/smarttv/develop/tools
(«Tizen Studio with Package Manager»). Durante la instalación, en el Package
Manager, hacen falta dos cosas:

- **TV Extensions** (la SDK del televisor).
- **Samsung Certificate Extension**, en la pestaña *Extension SDK*. Sin esta no
  se puede crear el certificado y el paquete no se puede firmar.

`empaquetar.ps1` busca Tizen Studio en `C:\tizen-studio` y en un par de sitios
más. Si quedó en otro, se le pasa con `-TizenStudio`.

### 2. Modo desarrollador en la tele

1. Menú **Apps**.
2. Teclear **12345**. Se abre un cuadro de ajustes.
3. **Developer mode: On**.
4. Escribir la **IP de este PC** en el campo que pide.
5. Apagar y encender la tele. No vale con salir del menú: el modo no queda
   activo hasta que arranca de nuevo.

**El One Remote no tiene teclado numérico.** Los mandos que vienen con estos
televisores traen un botón **123**: al pulsarlo sale un teclado numérico en la
pantalla, y con él se marca el 12345. Si el mando tampoco tiene ese botón, el
mando virtual de la app **SmartThings** (móvil, con la tele emparejada) incluye
teclado numérico y sirve igual.

La tele y el PC tienen que estar en la misma red.

### 3. El certificado

En Tizen Studio: **Tools → Certificate Manager → + → Samsung → TV**.

Pide iniciar sesión con la cuenta Samsung, crea un certificado de autor y otro
de distribuidor, y en el paso del distribuidor pide el **DUID del televisor**.
Ese número sale solo si la tele ya está conectada, así que conviene conectarla
antes desde una terminal:

```
C:\tizen-studio\tools\sdb.exe connect LA_IP_DE_LA_TELE:26101
C:\tizen-studio\tools\sdb.exe devices
```

Con el perfil creado y marcado como activo, ya se puede firmar.

---

## Instalar

```powershell
cd moovin\tizen
.\empaquetar.ps1 -Ip 192.168.1.40
```

El script arma el `.wgt`, lo firma, conecta con la tele y lo instala. Si solo se
quiere el paquete, se llama sin `-Ip`.

## Se actualiza sola

**Un push a `main` llega a la tele sin reinstalar nada.** El paquete no lleva la
interfaz dentro: lleva `arranque.js`, que en cada apertura se descarga
`iris.it.com/moovin/index.html` y lo monta en su propio documento. La siguiente
vez que se abre la aplicación, ya es la versión nueva.

Solo hay que volver a ejecutar `empaquetar.ps1` si se toca `arranque.js` o
`config.xml`, que son las dos únicas piezas que viven en el paquete. Tocar
`index.html`, `adaptable.css` o `adaptable.js` **no** requiere reinstalar.

Por qué se monta en vez de apuntar el widget a la web: cuando el contenido de una
aplicación Tizen es remoto, el sistema no garantiza que el objeto `tizen` llegue
a la página, y sin él no hay tecla de volver ni teclas de reproducción del mando.
Descargando el HTML y escribiéndolo en el documento local, la ventana no navega
nunca y el objeto sobrevive.

**Sin conexión con el estudio**, se abre la última copia que funcionó, guardada
en la propia tele junto con `adaptable.css` y `adaptable.js` para que no le falte
nada. Si además no hay red, el catálogo tampoco llegará, pero la aplicación abre
y dice por qué en vez de quedarse en negro.

---

## Lo que hay que saber

**El certificado caduca.** Cuando lo haga, la app deja de abrir y avisa de que
expiró el periodo de validez. Se arregla renovando el certificado en el
Certificate Manager y volviendo a instalar; no se pierde nada.

**El modo desarrollador se apaga solo.** Alguna actualización de firmware lo
desactiva. Si `sdb connect` deja de funcionar de un día para otro, lo primero es
volver al paso 2.

**Nada de esto afecta a la web.** `iris.it.com/moovin` sigue funcionando igual
en el navegador de la tele, en el móvil y en el escritorio; esto solo añade la
aplicación instalada.

---

## Probar el modo televisor sin televisor

La interfaz de 10 pies y la navegación con mando se pueden ver en el PC:

```
https://iris.it.com/moovin/?tv=1     entra en modo televisor
https://iris.it.com/moovin/?tv=0     vuelve al normal
```

Queda recordado entre recargas. Con el modo puesto, las flechas del teclado
mueven el foco igual que las del mando, Enter es el OK y Escape es el botón de
volver.
