// IRIS — JS de la web
// FASE 2: solo contenido "vivo" (reloj del nav). Las animaciones GSAP
// (ScrollSmoother, reveals SplitText, etc.) se añaden por capas en la FASE 4.

/* ---- Reloj en vivo (nav + footer, detalle firma) ---- */
const clocks = [document.getElementById('clock'), document.getElementById('clock-footer')].filter(Boolean)
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

/* ---- Proyectos: sticky-swap (la imagen cambia con el scroll) ----
   Versión base con IntersectionObserver. En la FASE 4 se pule con GSAP
   (pin suave, crossfade, parallax). */
const swap = document.querySelector('.proyectos .swap')
if (swap) {
  const steps = [...swap.querySelectorAll('.swap__step')]
  const imgs = [...swap.querySelectorAll('.swap__img')]
  const setActive = (i) => {
    steps.forEach((s) => s.classList.toggle('is-active', Number(s.dataset.index) === i))
    imgs.forEach((m) => m.classList.toggle('is-active', Number(m.dataset.index) === i))
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(Number(e.target.dataset.index)) })
    },
    // Banda de activación estrecha en el centro del viewport
    { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
  )
  steps.forEach((s) => io.observe(s))
}
