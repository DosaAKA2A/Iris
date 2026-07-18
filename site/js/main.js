// IRIS — entrada JS (FASE 0)
// Confirma que GSAP y sus plugins cargan por npm. Las animaciones
// reales se añaden por capas en la FASE 4.
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText)

// Verificación visible de que el stack arranca
const check = document.getElementById('gsap-check')
if (check) {
  const plugins = [
    ['gsap', typeof gsap?.version === 'string'],
    ['ScrollTrigger', !!ScrollTrigger],
    ['ScrollSmoother', !!ScrollSmoother],
    ['SplitText', !!SplitText],
  ]
  const ok = plugins.every(([, present]) => present)
  check.textContent = ok
    ? `GSAP ${gsap.version} + ScrollTrigger, ScrollSmoother, SplitText ✓`
    : 'Fallo cargando algún plugin de GSAP'
  check.classList.toggle('ok', ok)
}
