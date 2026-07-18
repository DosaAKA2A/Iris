// IRIS — JS de la web
// FASE 2: solo contenido "vivo" (reloj del nav). Las animaciones GSAP
// (ScrollSmoother, reveals SplitText, etc.) se añaden por capas en la FASE 4.

/* ---- Reloj en vivo del nav (detalle firma) ---- */
const clockEl = document.getElementById('clock')
if (clockEl) {
  const fmt = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    // TODO Iris: fija la zona horaria del estudio (ej. 'Europe/Madrid')
    timeZone: 'Europe/Madrid',
  })
  const tick = () => { clockEl.textContent = fmt.format(new Date()) }
  tick()
  setInterval(tick, 1000 * 15)
}
