// Small, dependency-free math helpers shared by every system.

let _s = 0x2545f491;

/** Fast xorshift32 PRNG returning [0, 1). */
export function rng() {
  _s ^= _s << 13;
  _s ^= _s >>> 17;
  _s ^= _s << 5;
  return (_s >>> 0) / 4294967296;
}

export function seedRng(v) {
  _s = (v | 0) || 0x2545f491;
}

export function randInt(a, b) {
  return a + Math.floor(rng() * (b - a + 1));
}

export function randRange(a, b) {
  return a + rng() * (b - a);
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);

/** Deterministic 2D hash in [0, 1). */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smoothstep(x - xi), yf = smoothstep(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

export function fbm(x, y, seed = 0, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

/** Pack RGBA into a little-endian Uint32 (matches ImageData byte order). Channels are clamped 0..255. */
export function packRGBA(r, g, b, a = 255) {
  r = r > 255 ? 255 : r < 0 ? 0 : r;
  g = g > 255 ? 255 : g < 0 ? 0 : g;
  b = b > 255 ? 255 : b < 0 ? 0 : b;
  a = a > 255 ? 255 : a < 0 ? 0 : a;
  return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}

export function unpackRGBA(c) {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24];
}

export function mixPacked(c1, c2, t) {
  const r = (c1 & 255) + (((c2 & 255) - (c1 & 255)) * t);
  const g = ((c1 >>> 8) & 255) + ((((c2 >>> 8) & 255) - ((c1 >>> 8) & 255)) * t);
  const b = ((c1 >>> 16) & 255) + ((((c2 >>> 16) & 255) - ((c1 >>> 16) & 255)) * t);
  const a = (c1 >>> 24) + (((c2 >>> 24) - (c1 >>> 24)) * t);
  return packRGBA(r, g, b, a);
}

/** Pick an element from [[value, weight], ...]. */
export function weightedPick(list) {
  let total = 0;
  for (const [, w] of list) total += w;
  let r = rng() * total;
  for (const [v, w] of list) {
    r -= w;
    if (r <= 0) return v;
  }
  return list[list.length - 1][0];
}

/** Bresenham line walker; callback(x, y). */
export function walkLine(x0, y0, x1, y1, cb) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 10000; guard++) {
    cb(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function formatTemp(t, unit = 'C') {
  if (!Number.isFinite(t)) return '—';
  if (unit === 'F') return `${Math.round(t * 9 / 5 + 32)}°F`;
  if (unit === 'K') return `${Math.round(t + 273.15)} K`;
  return `${Math.round(t)}°C`;
}

export function shortNumber(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Base64 helpers for compact typed-array serialization.
export function bytesToBase64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Run-length encode a typed integer array into [value, count, ...] then base64 via Int32. */
export function rleEncode(arr) {
  const out = [];
  let i = 0;
  const n = arr.length;
  while (i < n) {
    const v = arr[i];
    let j = i + 1;
    while (j < n && arr[j] === v) j++;
    out.push(v, j - i);
    i = j;
  }
  const i32 = new Int32Array(out);
  return bytesToBase64(new Uint8Array(i32.buffer));
}

export function rleDecode(b64, TypedCtor, length) {
  const bytes = base64ToBytes(b64);
  if (bytes.length % 4 !== 0) throw new Error('Corrupt RLE data');
  const i32 = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  const out = new TypedCtor(length);
  let p = 0;
  for (let k = 0; k + 1 < i32.length; k += 2) {
    const v = i32[k], c = i32[k + 1];
    if (c < 0 || p + c > length) throw new Error('RLE overflow');
    out.fill(v, p, p + c);
    p += c;
  }
  if (p !== length) throw new Error('RLE length mismatch');
  return out;
}

export const DIRS8 = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
