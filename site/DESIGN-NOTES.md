# DESIGN-NOTES — Inspección de Mugen Studio

> Fuente: https://mugenstudio.framer.website (plantilla Framer "Mugen Design Studio")
> Objetivo: reproducir **estructura, composición y feel** (dark, estudio premium, orientado a conversión).
> NO se copia marca ni textos. Los valores de abajo son los **exactos renderizados** (extraídos del DOM).
> Fecha de inspección: 2026-07-18.

---

## 1. Paleta (exacta, monocroma)

Mugen es **monocromo**: no hay color de acento cromático. Todo es negro casi puro + blanco + escala de grises. El contraste y la jerarquía se consiguen con **peso tipográfico, escala y secciones invertidas** (tarjetas claras sobre fondo oscuro), no con color.

| Rol | rgb | hex | Uso |
|---|---|---|---|
| Fondo base | rgb(5,5,5) | `#050505` | fondo global de la página |
| Superficie elevada | rgb(13,13,13) | `#0d0d0d` | bloques/menú translúcido |
| Tarjeta oscura | rgb(28,28,28) | `#1c1c1c` | cards, chips |
| Línea / borde | rgb(54,54,54) | `#363636` | bordes 1px, divisores, superficies tenues |
| Texto dim | rgb(84,84,84) | `#545454` | metadatos, texto muy secundario |
| Texto muted | rgb(184,184,184) | `#b8b8b8` | cuerpo secundario, párrafos apagados |
| Texto principal | rgb(255,255,255) | `#ffffff` | titulares y texto principal |
| Superficie clara | rgb(222,222,222) | `#dedede` | cards invertidas (sección clara) |
| Invert / blanco | rgb(255,255,255) | `#ffffff` | fondo de CTA y tarjetas invertidas |

> Nota: el DOM muestra `rgb(0,0,238)` en muchos `<a>` — es el **azul por defecto de enlaces sin estilar** (artefacto de Framer), NO un acento de diseño. El texto visible real es blanco/gris.

### Mapeo propuesto para tokens de Iris (base = Mugen)
Mantener la base monocroma. Si Iris quiere **un** acento, introducirlo con MUCHA moderación (un solo color, solo en foco/hover/CTA). Por defecto dejo el sistema en monocromo puro:
```
--bg: #050505 · --surface: #0d0d0d · --card: #1c1c1c
--line: #363636 · --dim: #545454 · --muted: #b8b8b8 · --text: #ffffff
--invert-bg: #ffffff · --invert-text: #050505
--accent: (TODO Iris — por defecto = --text, monocromo)
```

---

## 2. Tipografía (exacta)

| Familia | Pesos cargados | Uso |
|---|---|---|
| **Inter Display** (corte "display" óptico de Inter) | 400, 500, 600, 700 | TODO: display gigante, titulares, cuerpo |
| **Geist / Geist Variable** | 400, 500 | micro-labels (reloj, tags, "[Our Approach]", 10–12px) |
| Manrope (Variable) | 600, 700, 800 | secundaria (presente, uso puntual) |

- **Todo el sitio corre sobre Inter Display.** El cuerpo NO usa 400: los párrafos van en **600 (semibold)** con color muted `#b8b8b8`. Esto le da el aire "denso y premium".
- Los micro-labels técnicos (hora local, contadores, etiquetas de sección tipo `[Our Approach]`) usan **Geist** a 10–12px.
- Tracking **negativo** consistente en display: ~**-0.04em**.

### Escala de tipo observada (desktop)
| Elemento | tamaño | peso | tracking | line-height | transform |
|---|---|---|---|---|---|
| Wordmark gigante (hero/footer) | **294–333px** | 700 | -0.04em | 0.8 | none |
| Titular de sección ("Case studies", "Services") | **96px** | 600 | -0.04em | 1.0 | none |
| Statement grande (Approach) | ~40–56px | 700/400 mixto | -0.03em | 1.15 | none |
| Cuerpo principal | 20px | 600/700 | -0.03em | ~1.4 | none |
| Cuerpo secundario (muted) | 17.5px | 600 | -0.02em | ~1.5 | none |
| Metadatos / listas | 14.5px | 600 | -0.02em | ~1.4 | none |
| Micro-label (Geist) | 10–12px | 400 | ~0 | — | none/upper |

### Para Iris
- Display + titulares + cuerpo: **Inter** (Google Fonts cubre 400/500/600/700; "Inter Display" es el corte display de Framer — replicable con Inter + tracking negativo apretado, o **Inter Tight**).
- Micro-labels: **Geist** (o Geist Mono para acentuar el aire técnico) — TODO confirmar con Iris.
- Fijar body a **peso 600**, no 400, para clonar la densidad.

---

## 3. Hero — VÍDEO de fondo (importante)

- El hero (`Intro`) tiene **1 `<video>` a pantalla completa**, `autoplay` + `loop` + `muted`, cubriendo toda la sección (~100vh). En Mugen es un **prisma/triángulo 3D girando** en negro con partículas.
- El **footer** repite el patrón: otro vídeo full-bleed (fluido tipo "liquid metal") + wordmark gigante → **bookend** hero/footer.
- Ambos vídeos son placeholders a sustituir por recursos de Iris.
  - Formato: `.mp4`, H.264, mudo, en loop. Proporción cover a pantalla (16:9 fuente, recortado). Poster jpg de respaldo.
  - Anotado como `PLACEHOLDER-video-hero.mp4` y `PLACEHOLDER-video-footer.mp4` en la maqueta.

---

## 4. Estructura real de secciones (en orden)

| # | Sección (nombre Framer) | Composición |
|---|---|---|
| — | **Nav** (sticky, blur) | Izq: wordmark `MUGEN©`. Centro: **ubicación + reloj en vivo** ("Toronto (CA) 05:14 AM"). Der: `Our Work [12]` (con contador) + icono hamburguesa. |
| 1 | **Intro / Hero** | Vídeo full-bleed. Wordmark gigante en 2 líneas (línea 1 blanca, línea 2 gris). Micro-label "© Since — 2016". Tarjeta flotante central (foto PM "Sarah Park", "2 slots open", "Plans start at $2500/m", CTA "Book a 15-Min Call"). Abajo-izq: avatares + "4.9/5 · 100+ happy clients". Abajo-der: párrafo de propuesta con énfasis blanco/gris. |
| 2 | **Approach** | Label `[Our Approach]`. **Statement grande** con palabras clave en blanco y resto en gris. Debajo: card de retrato del fundador ("Alex West · Founder & Creative Director") + cita + 2 columnas de cuerpo + link "The studio →". |
| 3 | **Projects / Case studies** | Titular "Case studies" (96px). **Grid masonry** de tarjetas de proyecto escalonadas (columnas con offset): nº `[04]`, imagen, título (Quantum, Cubekit, Warpspeed, Ephemeral, Global Bank…), categoría ("Brand Identity & Product Design"), año, botón `+`. Reveal por scroll. |
| 4 | **Why Choose Us** | Statement de valor ("We deliver more than design…") + soporte visual. |
| 5 | **Services** | Titular "Services" (96px) + párrafo intro. **Lista sticky pinneada** (5167px): categorías a la izquierda (Brand Identity / Digital Design / Product Design / Marketing & Growth / Development), la activa en blanco, resto atenuadas; imagen grande a la derecha que **cambia al hacer scroll**. |
| 6 | **Process** | "A proven process that delivers results…" — pasos del proceso. |
| 7 | **Pricing** | "Built to scale" + intro. **3 planes**: $7,500/mes, $15,000/mes, y card "Get Quote" (contacto + "Book Call"). Cada uno: precio, "For ongoing requests", botón "Start Now +", lista "What's included" en 2 columnas con bullets `+`. |
| 8 | **Testimonials** | "Trusted by the most innovative teams." / "Results speak louder than promises." — quotes con retrato. |
| 9 | **FAQ** | Acordeón de preguntas. |
| 10 | **Blog / Insights** | "Strategies & insights from the team." — grid de artículos. |
| 11 | **Footer** | Bookend del hero: vídeo fluido full-bleed + wordmark gigante "MUGEN STUDIO" + newsletter ("Subscribe… " + email + `+`) + "Based in Toronto (CA)" + reloj. |

Altura total del documento: ~20.000px (desktop). Feel: mucho aire negro, reveals por scroll, tipografía enorme, detalles "vivos" (reloj, contadores, slots).

---

## 5. Firmas de estilo a replicar (el "feel")

1. **Monocromo disciplinado** — negro casi puro + blanco + grises; jerarquía por peso/escala, no por color.
2. **Tipografía descomunal** — wordmark ~300px, titulares 96px, tracking negativo.
3. **Cuerpo en semibold + muted** — densidad premium.
4. **Secciones que respiran** — mucho espacio negativo negro entre bloques.
5. **Detalles "vivos"** — reloj local en vivo, contadores ([12], slots open), estados de disponibilidad.
6. **Bookend con vídeo** — hero y footer comparten vídeo full-bleed + wordmark.
7. **Reveals por scroll** — opacidad/translate al entrar en viewport (esto lo haremos con GSAP ScrollTrigger + SplitText en FASE 4).
8. **Tarjetas de conversión flotantes** — CTA con foto de persona real, disponibilidad y precio "desde".

---

## 6. Identidad de Iris (a fijar contigo)

| Token | Valor confirmado | Estado |
|---|---|---|
| Wordmark | **IRIS** (¿+ segunda palabra tipo "STUDIO"?) | TODO 2ª palabra |
| Tagline hero | **"Vemos el resultado"** | ✔ |
| Paleta | base Mugen monocroma | ✔ (¿acento? TODO) |
| Tipografía | Inter (display) + Geist (labels) | base Mugen ✔ (confirmar) |
| Qué es Iris | estudio de diseño / SaaS / portfolio | **TODO** |
| Secciones | hero, case studies, servicios, proceso, pricing, testimonios, faq, footer | ✔ (coincide con Mugen) |
| Vídeos hero/footer | placeholders .mp4 | pendientes de tus recursos |
