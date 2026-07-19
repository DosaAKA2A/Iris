// IRIS — JS de la web
// FASE 4 · capa 1: ScrollSmoother (scroll suave). Las siguientes capas
// (reveals SplitText, media/parallax, hover, contadores) se añaden encima.

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText)

/* ---- Scroll suave (respeta prefers-reduced-motion) ---- */
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let smoother = null
if (!prefersReduced && document.getElementById('smooth-wrapper')) {
  document.documentElement.classList.add('smooth-on')
  smoother = ScrollSmoother.create({
    wrapper: '#smooth-wrapper',
    content: '#smooth-content',
    smooth: 1.2,          // segundos de "recuperación" del scroll (feel Mugen)
    effects: true,        // habilita data-speed / data-lag para las capas siguientes
    normalizeScroll: true // unifica el scroll en móvil/trackpad
  })
}

/* ---- FASE 4 · capa 2: reveals de texto (SplitText) ----
   Titulares que "suben" por líneas al entrar en pantalla; kickers y hero
   con fade/slide. Si prefers-reduced-motion, no se toca nada (todo visible).
   Esperamos a document.fonts.ready para que el corte por líneas sea exacto. */
if (!prefersReduced) {
  document.fonts.ready.then(() => {
    // Titulares de sección: revelado por líneas con máscara
    gsap.utils.toArray('.section__title').forEach((title) => {
      const split = SplitText.create(title, { type: 'lines', mask: 'lines' })
      gsap.from(split.lines, {
        yPercent: 120,
        duration: 0.9,
        ease: 'power3.out',
        stagger: 0.12,
        scrollTrigger: { trigger: title, start: 'top 85%', once: true },
      })
    })

    // Kickers / etiquetas de sección: fade + slide corto
    gsap.utils.toArray('.section__label').forEach((el) => {
      gsap.from(el, {
        y: 18,
        autoAlpha: 0,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 90%', once: true },
      })
    })

    // Hero (above the fold): timeline de entrada al cargar, sin scroll
    const eyebrow = document.querySelector('.hero__eyebrow')
    const wordmark = document.querySelector('.hero__wordmark')
    const tagline = document.querySelector('.hero__tagline')
    if (wordmark) {
      const wm = SplitText.create(wordmark, { type: 'chars', mask: 'chars' })
      gsap.timeline({ defaults: { ease: 'power3.out' }, delay: 0.15 })
        .from(eyebrow, { y: 16, autoAlpha: 0, duration: 0.6 })
        .from(wm.chars, { yPercent: 120, duration: 0.9, stagger: 0.06 }, '-=0.2')
        .from(tagline, { y: 20, autoAlpha: 0, duration: 0.7 }, '-=0.5')
    }
  })
}

/* ---- FASE 4 · capa 3: media & reveals de bloque ----
   Reveal de imágenes de casos (wipe + zoom) y reveal escalonado del resto de
   bloques para subir la densidad de animación. Sin parallax por scroll en las
   tarjetas (desplazaba las imágenes sobre el texto del masonry).
   No depende de fuentes; se salta entero en prefers-reduced-motion. */
if (!prefersReduced) {
  // A) Reveal de imágenes de casos: cortina de abajo a arriba + leve zoom-out.
  //    Funciona ahora con los placeholders y también con tus imágenes reales.
  gsap.utils.toArray('.case').forEach((card) => {
    const media = card.querySelector('.case__media')
    if (!media) return
    gsap.from(media, {
      clipPath: 'inset(100% 0% 0% 0%)',
      scale: 1.12,
      duration: 1.1,
      ease: 'power3.out',
      clearProps: 'transform', // libera el transform al acabar → el hover CSS manda
      scrollTrigger: { trigger: card, start: 'top 85%', once: true },
    })
  })

  // C) Reveal escalonado de bloques (servicios, proceso, planes, testimonios,
  //    FAQ). Batch por rendimiento; entra desde abajo con stagger.
  const batchReveal = (selector, y = 26) => {
    ScrollTrigger.batch(selector, {
      start: 'top 88%',
      once: true,
      onEnter: (els) =>
        gsap.from(els, {
          autoAlpha: 0,
          y,
          duration: 0.8,
          ease: 'power3.out',
          stagger: 0.09,
          overwrite: true,
        }),
    })
  }
  ;['.svc__item', '.step', '.plan', '.quote', '.faq__item'].forEach((s) => batchReveal(s))
}

/* ---- FASE 4 · capa 4: micro-interacciones — CTA "imán" ----
   Los botones principales siguen sutilmente al cursor y vuelven a su sitio al
   salir. gsap.quickTo da un seguimiento suave. Solo con puntero fino (ratón)
   y sin prefers-reduced-motion; en táctil no aplica. */
if (!prefersReduced && window.matchMedia('(pointer: fine)').matches) {
  const magnets = document.querySelectorAll(
    '.cta-btn, .plan__btn, .menu__cta, .footer__field button, .nav__menu'
  )
  magnets.forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' })
    const yTo = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' })
    const strength = 0.35 // fracción del desplazamiento del cursor (sutil)
    const max = 10 // tope en px para que no se despegue del layout
    const clamp = (v) => Math.max(-max, Math.min(max, v))
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect()
      xTo(clamp((e.clientX - (r.left + r.width / 2)) * strength))
      yTo(clamp((e.clientY - (r.top + r.height / 2)) * strength))
    })
    el.addEventListener('pointerleave', () => { xTo(0); yTo(0) })
  })
}

/* ---- Reloj en vivo (nav + footer, detalle firma) ---- */
const clocks = [
  document.getElementById('clock'),
  document.getElementById('clock-footer'),
  document.getElementById('clock-menu'),
].filter(Boolean)
if (clocks.length) {
  const fmt = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    // TODO Iris: fija la zona horaria del estudio (ej. 'Europe/Madrid')
    timeZone: 'Europe/Madrid',
  })
  const tick = () => { const t = fmt.format(new Date()); clocks.forEach(el => { el.textContent = t }) }
  tick()
  setInterval(tick, 1000 * 15)
}

/* ---- Año dinámico del footer ---- */
const yearEl = document.getElementById('year')
if (yearEl) yearEl.textContent = new Date().getFullYear()

/* ---- Menú overlay (hamburguesa) ---- */
const menuToggle = document.getElementById('menu-toggle')
const menu = document.getElementById('menu')
if (menuToggle && menu) {
  const setOpen = (open) => {
    menu.classList.toggle('is-open', open)
    menuToggle.classList.toggle('is-active', open)
    menuToggle.setAttribute('aria-expanded', String(open))
    menuToggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú')
    menu.setAttribute('aria-hidden', String(!open))
    document.body.classList.toggle('menu-open', open)
  }
  menuToggle.addEventListener('click', () => setOpen(!menu.classList.contains('is-open')))
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)))
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false) })
}

/* ---- Anclas: scroll suave vía ScrollSmoother (si está activo) ---- */
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href')
    if (id.length < 2) return                 // ignora href="#"
    const target = document.querySelector(id)
    if (!target) return
    if (smoother) {                            // suaviza solo si ScrollSmoother corre
      e.preventDefault()
      smoother.scrollTo(target, true, 'top top') // true = animado
    }
    // sin smoother: se deja el salto nativo (o el smooth de CSS como fallback)
  })
})

/* ---- Proyectos: pin + tira de imágenes scrubbed ----
   El marco queda fijo (pin) y la TIRA de imágenes se desliza DENTRO al ritmo
   del scroll (scrub), a la vez que se resalta el proyecto en la lista. */
const swap = document.querySelector('.proyectos .swap')
if (swap) {
  const steps = [...swap.querySelectorAll('.swap__step')]
  const track = swap.querySelector('.swap__track')
  const n = steps.length
  const setStep = (i) =>
    steps.forEach((s) => s.classList.toggle('is-active', Number(s.dataset.index) === i))
  setStep(0)

  if (prefersReduced) {
    // Sin animación: la tira salta a la imagen del proyecto que cruza el centro.
    steps.forEach((s) =>
      ScrollTrigger.create({
        trigger: s, start: 'top center', end: 'bottom center',
        onToggle: (self) => {
          if (!self.isActive) return
          const i = Number(s.dataset.index)
          setStep(i)
          gsap.set(track, { yPercent: -i * 100 })
        },
      })
    )
  } else {
    const mm = gsap.matchMedia()

    // Desktop: la sección se CLAVA (pin) y la tira se desliza con el scroll.
    mm.add('(min-width: 1024px)', () => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: swap,
          start: 'center center',
          // distancia del pin: ~0.7 viewports por transición (cambia antes)
          end: () => '+=' + (n - 1) * window.innerHeight * 0.7,
          pin: true,
          scrub: 0.25, // seguimiento ágil (menos inercia = se posiciona antes)
          // Snap por PROXIMIDAD: encaja en la imagen que quede mayoritariamente
          // visible en el marco (la más cercana), sin forzar el sentido del
          // scroll. Asentamiento breve para que se sienta natural.
          snap: {
            snapTo: 1 / (n - 1),
            duration: { min: 0.12, max: 0.28 },
            delay: 0.02,
            ease: 'power1.out',
            directional: false,
          },
          onUpdate: (self) => setStep(Math.round(self.progress * (n - 1))),
        },
      })
      tl.to(track, { yPercent: -(n - 1) * 100, ease: 'none' })
      return () => {
        if (tl.scrollTrigger) tl.scrollTrigger.kill()
        tl.kill()
        gsap.set(track, { clearProps: 'transform' })
      }
    })

    // Móvil: sin pin. Cada paso desliza la tira a su imagen al cruzar el viewport.
    mm.add('(max-width: 1023px)', () => {
      const trs = steps.map((s) =>
        ScrollTrigger.create({
          trigger: s, start: 'top 60%', end: 'bottom 40%',
          onToggle: (self) => {
            if (!self.isActive) return
            const i = Number(s.dataset.index)
            setStep(i)
            gsap.to(track, { yPercent: -i * 100, duration: 0.5, ease: 'power2.out' })
          },
        })
      )
      return () => trs.forEach((t) => t.kill())
    })
  }
}
