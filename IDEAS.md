# IDEAS — Cuaderno de proyectos · IRIS Studio

> Cuaderno de proyectos e ideas de Dosa / IRIS Studio.
> Objetivo: no perder ideas entre el móvil y el PC, y arrancar cada proyecto con el alcance claro.
>
> **Enfoque de portafolio:** _AI-native builder_ — concibo, decido la arquitectura, integro
> sistemas y entrego productos completos orquestando IA. El valor está en el criterio
> (qué construir, por qué, qué descartar), no en teclear el código. El portafolio hace
> visible ese criterio: problema → decisiones → resultado.

**Leyenda de estado:** 💡 idea · 📐 con alcance · 🚧 en construcción · ✅ v1 lista

_Última actualización: 2026-08-14_

---

## 1. Instagram estilo Aero (addon de Naviris) — 💡

Funciones tipo mod _Aero_ pero **como addon web sobre `instagram.com`**, dentro de Naviris.
Sin parchear el APK oficial de Instagram.

**Por qué este camino y no el APK**
- Parchear el APK de Meta = redistribuir código propietario (copyright), se rompe cada semana
  con cada release ofuscada, y Meta detecta clientes modificados (riesgo de baneo).
- Un addon que corre sobre `instagram.com` en tu propio navegador está en la misma familia
  que un bloqueador de anuncios o un userscript: rompe los términos, pero **no es infracción
  de copyright**. Y encaja con lo que Naviris ya hace (Blockify sobre Spotify, Sensibilidad X).

**Ventaja técnica de Naviris (Electron)**
- `session.webRequest` permite **bloquear peticiones de verdad** — algo que una extensión de
  Chrome moderna (Manifest V3) ya no puede. Las features "avanzadas" dependen justo de esto.

**Features (v1 = mitad de arriba, casi todo el valor y casi nada del riesgo)**

| Feature | Viabilidad |
|---|---|
| Descargar fotos / vídeos / reels | Alta (Rat Tool ya descarga de IG en parte) |
| Ocultar posts patrocinados | Alta (filtrado de DOM, como Blockify) |
| Temas / CSS propio | Alta |
| Zoom en foto de perfil | Alta |
| Copiar bio y comentarios | Alta |
| Descargar historias | Media (la URL caduca rápido) |
| Modo fantasma (ver historias sin marcar visto) | Media-baja (bloquear "seen"; frágil) |
| Ocultar el "visto" en DMs | Baja (puede romper los DMs) |

**Riesgos / notas**
- Aviso claro en la descripción del addon (como en Blockify): bloquear "seen"/read-receipts
  cambia el patrón de tráfico; no es tan detectable como un APK, pero no es cero.
- Referencia interna: `addons/blockify.js` es el addon más parecido a montar.

---

## 2. Auditor de checkout con IA — 💡

Pegas la URL de una tienda (o subes capturas del checkout) y una **IA con visión audita el
flujo de compra** y devuelve **recomendaciones priorizadas para bajar el abandono de carrito**.

**Por qué es tuyo**
- Es la versión **producto** de lo que hiciste a mano en `corlima` (análisis de abandono →
  recomendaciones). Nace de expertise ya demostrada.

**Por qué encaja con el portafolio**
- Salto de "construyo _con_ IA" a "construyo _productos de_ IA". No lo tengo en ningún repo.
- Forma de SaaS → un contratista lo ve y piensa "esto factura".
- Demo irresistible: pegas URL → sale informe.
- Backend **fino y honesto** (llamada a API de LLM). No finge full-stack.

**v1 — dentro**
- Entrada: URL o subir capturas.
- Análisis con LLM de visión del flujo (home → producto → carrito → checkout).
- Salida: informe con recomendaciones priorizadas (impacto / esfuerzo).

**v1 — fuera**
- Cuentas de usuario, histórico, integraciones con la tienda, pagos.

---

## 3. Escáner inteligente (app móvil) — 💡

App **móvil nativa**: apuntas la cámara a un recibo, documento o tarjeta y lo convierte en
**datos limpios** (un gasto registrado, un PDF, un contacto).

**Por qué esta**
- Hueco real del portafolio: no hay **app móvil nativa** (Naviris móvil es solo un WebView).
- Usa **hardware del móvil** (cámara + OCR en el dispositivo) — lo que hace que una "app"
  impresione de verdad frente a una web.
- Demo brutal: apuntas y aparece la magia.

**Stack propuesto**
- **React Native + Expo** → se prueba en el móvil real con **Expo Go** (QR, sin compilar).
- OCR en dispositivo (p. ej. ML Kit / expo-text-recognition).

**Dónde se construye**
- El código lo escribimos en la sesión; el "verlo funcionar" pasa en el móvil real con Expo Go.
  (El contenedor de la nube no tiene GPU/emulador, pero para RN no hace falta.)

**v1 — dentro**
- Un caso de uso concreto primero (p. ej. **recibos → gasto**): cámara → OCR → campos
  editables → guardar/exportar.

**v1 — fuera**
- Multi-tipo (tarjetas, documentos) hasta que el primer caso esté pulido.

---

## Explorando (aún sin comprometer)

- **Hub de IRIS Studio** — landing que presenta Naviris, GRIEF, ZakiWorld, EDERUS, etc. como
  un estudio coherente. Casos de estudio con registro de decisiones, demos en vivo + vídeos
  cortos de las apps de escritorio, y un deep-dive de Naviris. Es el proyecto que más rinde
  por esfuerzo dado lo que ya está construido, y juega a la fuerza (landings con marca).
- **Personaje / mascota original con ComfyUI** — arte anime (estilo Illustrious / NoobAI / Pony
  en SDXL) generado en ComfyUI (en el PC, con GPU), con la capa de diseño/tipografía montada
  aparte. Reto real: **consistencia del personaje** (LoRA entrenada / IPAdapter / character
  sheet). Mejor **personaje original** que fan-art, por marca y por copyright.

---

## Notas de trabajo (flujo móvil ⇄ PC)

- Las sesiones de Claude Code en la web corren en un contenedor **efímero**: lo que no se
  commitea y se pushea, se pierde. Por eso este archivo vive en el repo.
- Los proyectos nuevos serán **repos nuevos** (este archivo está temporalmente en `iris` porque
  la integración no puede crear repos; se moverá a un `roadmap` dedicado cuando exista).
