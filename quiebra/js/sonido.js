/* QUIEBRA — sonido sintetizado con WebAudio. Sin binarios: todo es osciladores.
   Se activa con el primer gesto del usuario (política de autoplay). */

let ctx = null;
let activo = true;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tono(freq, dur, tipo = 'sine', vol = 0.16, cuando = 0, glide = 0) {
  if (!activo) return;
  try {
    const a = ac();
    const t = a.currentTime + cuando;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + glide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.05);
  } catch { /* sin audio */ }
}

export const S = {
  toggle(v) { activo = v; },
  despertar() { try { ac(); } catch { /* nada */ } },
  clic() { tono(660, 0.06, 'square', 0.06); },
  dado() { tono(220, 0.07, 'square', 0.1); tono(330, 0.07, 'square', 0.1, 0.07); tono(440, 0.1, 'square', 0.1, 0.14); },
  dinero() { tono(880, 0.09, 'sine', 0.14); tono(1320, 0.12, 'sine', 0.12, 0.08); },
  pago() { tono(360, 0.12, 'sawtooth', 0.09); tono(240, 0.18, 'sawtooth', 0.09, 0.1); },
  carta() { tono(520, 0.05, 'triangle', 0.12); tono(780, 0.08, 'triangle', 0.12, 0.05); },
  mini() { [523, 659, 784, 1046].forEach((f, i) => tono(f, 0.12, 'square', 0.1, i * 0.09)); },
  mal() { tono(200, 0.25, 'sawtooth', 0.12, 0, -120); },
  bien() { tono(523, 0.1, 'sine', 0.14); tono(659, 0.1, 'sine', 0.14, 0.09); tono(784, 0.16, 'sine', 0.14, 0.18); },
  quiebra() { [392, 330, 262, 196].forEach((f, i) => tono(f, 0.22, 'sawtooth', 0.1, i * 0.16)); },
  fanfarria() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tono(f, 0.14, 'square', 0.09, i * 0.11)); },
  turno() { tono(440, 0.08, 'sine', 0.12); tono(660, 0.1, 'sine', 0.12, 0.07); },
  tic() { tono(990, 0.03, 'square', 0.05); },
  moneda() { tono(1200, 0.06, 'sine', 0.12); tono(1800, 0.08, 'sine', 0.1, 0.05); },
};
