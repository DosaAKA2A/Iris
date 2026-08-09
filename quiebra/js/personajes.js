/* QUIEBRA — caras SVG de los personajes. Vector propio, sin emojis ni imágenes. */

const CARAS = {
  rata: (c) => `
    <circle cx="18" cy="16" r="10" fill="#9aa0ad"/><circle cx="46" cy="16" r="10" fill="#9aa0ad"/>
    <circle cx="18" cy="16" r="5" fill="#f0a8bc"/><circle cx="46" cy="16" r="5" fill="#f0a8bc"/>
    <ellipse cx="32" cy="38" rx="22" ry="19" fill="#b9bec9"/>
    <circle cx="24" cy="34" r="3.4" fill="#14161c"/><circle cx="40" cy="34" r="3.4" fill="#14161c"/>
    <circle cx="25.2" cy="32.8" r="1.1" fill="#fff"/><circle cx="41.2" cy="32.8" r="1.1" fill="#fff"/>
    <ellipse cx="32" cy="45" rx="4.4" ry="3.4" fill="#ff5d8f"/>
    <path d="M10 44 L24 46 M10 51 L24 49 M54 44 L40 46 M54 51 L40 49" stroke="#7d828f" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M28 52 q4 3 8 0" stroke="#14161c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  pulpo: (c) => `
    <path d="M10 34 a22 22 0 0 1 44 0 v10 q-4 6 -7 0 q-3 8 -7 0 q-3 8 -8 0 q-3 8 -7 0 q-3 6 -8 0 z" fill="#8d7dff"/>
    <path d="M10 34 a22 22 0 0 1 44 0 v4 h-44 z" fill="#7b69ff"/>
    <circle cx="24" cy="32" r="6" fill="#fff"/><circle cx="40" cy="32" r="6" fill="#fff"/>
    <circle cx="25.5" cy="33" r="2.8" fill="#14161c"/><circle cx="41.5" cy="33" r="2.8" fill="#14161c"/>
    <path d="M27 44 q5 4 10 0" stroke="#14161c" stroke-width="2" fill="none" stroke-linecap="round"/>
    <circle cx="16" cy="40" r="2.4" fill="#c4bbff" opacity=".8"/><circle cx="48" cy="40" r="2.4" fill="#c4bbff" opacity=".8"/>`,
  cabra: (c) => `
    <path d="M14 8 q-8 6 -2 16 l8 -6 z" fill="#d8dce5"/><path d="M50 8 q8 6 2 16 l-8 -6 z" fill="#d8dce5"/>
    <path d="M14 8 q-5 5 -2 12" stroke="#a9aeb9" stroke-width="2" fill="none"/>
    <path d="M50 8 q5 5 2 12" stroke="#a9aeb9" stroke-width="2" fill="none"/>
    <ellipse cx="32" cy="36" rx="19" ry="21" fill="#eef0f4"/>
    <rect x="19" y="30" width="10" height="7" rx="3.5" fill="#fff" stroke="#c9cdd6"/>
    <rect x="35" y="30" width="10" height="7" rx="3.5" fill="#fff" stroke="#c9cdd6"/>
    <rect x="22" y="31.6" width="4.6" height="3.8" rx="1" fill="#14161c"/>
    <rect x="38" y="31.6" width="4.6" height="3.8" rx="1" fill="#14161c"/>
    <ellipse cx="32" cy="46" rx="5" ry="3.6" fill="#f0b9c4"/>
    <path d="M28 54 q4 6 8 0 l-1 6 q-3 3 -6 0 z" fill="#d8dce5"/>`,
  polilla: (c) => `
    <path d="M12 30 q-10 -14 4 -20 q10 -2 12 12 z" fill="#8a6a3f" opacity=".85"/>
    <path d="M52 30 q10 -14 -4 -20 q-10 -2 -12 12 z" fill="#8a6a3f" opacity=".85"/>
    <path d="M20 6 q-2 -6 -8 -4 M44 6 q2 -6 8 -4" stroke="#c9a26a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <circle cx="20" cy="7" r="2.6" fill="#ffb45e"/><circle cx="44" cy="7" r="2.6" fill="#ffb45e"/>
    <ellipse cx="32" cy="36" rx="20" ry="20" fill="#b08954"/>
    <path d="M14 30 q18 -10 36 0 l0 -6 q-18 -12 -36 0 z" fill="#8a6a3f"/>
    <circle cx="24" cy="36" r="6.4" fill="#2a2118"/><circle cx="40" cy="36" r="6.4" fill="#2a2118"/>
    <circle cx="26" cy="34" r="2" fill="#ffd9a0"/><circle cx="42" cy="34" r="2" fill="#ffd9a0"/>
    <path d="M29 48 q3 2.6 6 0" stroke="#2a2118" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
};

export function cara(char, cls = '') {
  const dib = CARAS[char];
  if (!dib) return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="36" r="20" fill="#3a3f4d"/></svg>`;
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true">${dib()}</svg>`;
}

/* Peón: la cara sobre una ficha de casino del color del personaje.
   Muescas en el canto, brillo arriba y sombra abajo para que tenga cuerpo. */
export function peon(char, color, cls = '') {
  const dib = CARAS[char] ? CARAS[char]() : '';
  const muescas = Array.from({ length: 12 }, (_, i) =>
    `<rect x="30.5" y="0.5" width="3" height="7" rx="1.2" fill="rgba(255,255,255,.5)"
       transform="rotate(${i * 30} 32 32)"/>`).join('');
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true">
    <ellipse cx="32" cy="60" rx="21" ry="4" fill="rgba(0,0,0,.45)"/>
    <circle cx="32" cy="33.5" r="30" fill="rgba(0,0,0,.55)"/>
    <circle cx="32" cy="32" r="30" fill="${color}"/>
    ${muescas}
    <circle cx="32" cy="32" r="24" fill="rgba(0,0,0,.22)"/>
    <circle cx="32" cy="32" r="23" fill="${color}"/>
    <path d="M32 2 a30 30 0 0 1 30 30 a30 30 0 0 0 -60 0 a30 30 0 0 1 30 -30 z" fill="rgba(255,255,255,.16)"/>
    <g transform="translate(9.5,9.5) scale(.70)">${dib}</g>
    <circle cx="32" cy="32" r="30" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="2"/>
  </svg>`;
}

/* Iconos SVG de interfaz (sin emojis). */
export const ICONOS = {
  reforma: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3 L21 11 H18 V20 H14 V14 H10 V20 H6 V11 H3 Z"/></svg>',
  okupa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.5 5.5 L18.5 18.5"/></svg>',
  trofeo: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 3 H18 V7 A6 6 0 0 1 6 7 Z"/><path d="M4 4 H6 V8 A4 4 0 0 1 4 5 Z M20 4 H18 V8 A4 4 0 0 0 20 5 Z"/><rect x="10.5" y="12" width="3" height="5"/><rect x="7" y="17" width="10" height="3" rx="1"/></svg>',
  carta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8 H15 M9 12 H15"/></svg>',
  billete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
  calavera: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 a9 8 0 0 0 -9 8 q0 4 3 6 v4 h3 v-2 h2 v2 h2 v-2 h2 v2 h3 v-4 q3 -2 3 -6 a9 8 0 0 0 -9 -8 z M8.5 12 a2 2 0 1 1 0.01 0 z M15.5 12 a2 2 0 1 1 0.01 0 z"/></svg>',
  risa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 10 L10 11 M16 10 L14 11 M7.5 14 a5 5 0 0 0 9 0 z" fill="currentColor"/></svg>',
  dado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" stroke="none"/></svg>',
  sonido: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9 H7 L12 5 V19 L7 15 H4 Z" fill="currentColor"/><path d="M16 9.5 a4 4 0 0 1 0 5"/><path d="M18.6 7 a8 8 0 0 1 0 10"/></svg>',
  mudo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9 H7 L12 5 V19 L7 15 H4 Z" fill="currentColor"/><path d="M16.5 9.5 L21 14 M21 9.5 L16.5 14"/></svg>',
};
