/* MOOVIN — utilidades compartidas del worker. */

// Alfabeto sin caracteres que se confunden al dictarlos o al leerlos en la
// pantalla de un televisor: fuera I, O, 0 y 1. Son 32, que divide a 256 exacto,
// asi que sacar un caracter de un byte al azar no introduce sesgo.
export const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function azar(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < n; i++) s += ALFABETO[b[i] % 32];
  return s;
}

export const ahora = () => Math.floor(Date.now() / 1000);

export async function sha256(texto) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(texto)));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Comparar con === filtra el secreto letra a letra por el tiempo de respuesta.
export function igual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length || !a.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Normaliza el correo para que 'Dosa@Gmail.com ' y 'dosa@gmail.com' sean la
// misma cuenta. No se tocan los puntos de gmail: dos correos distintos para el
// proveedor son dos cuentas distintas para nosotros, y punto.
export function normalizaCorreo(v) {
  return String(v || '').trim().toLowerCase();
}

export function correoValido(v) {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v) && v.length <= 254;
}

// El nombre lo elige quien entra: se limpia, no se valida contra nada.
export function limpiaNombre(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 32);
}

export const nuevoId = () => crypto.randomUUID();
