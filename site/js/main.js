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
