// Shared material enums, defaults, procedural textures and temperature colour tables.
import { clamp, hexToRgb, packRGBA, hash2, fbm, valueNoise } from '../utils/MathUtils.js';

export const STATE = Object.freeze({ EMPTY: 0, SOLID: 1, POWDER: 2, LIQUID: 3, GAS: 4, FIRE: 5 });
export const STATE_NAMES = ['Empty', 'Solid', 'Powder', 'Liquid', 'Gas', 'Energy'];
export const STATE_BY_NAME = { empty: 0, solid: 1, powder: 2, liquid: 3, gas: 4, fire: 5 };

export const BEHAVIOR = Object.freeze({
  NONE: 0, SEED: 1, PLANT: 2, GRASS: 3, MOSS: 4, VINE: 5, FUNGUS: 6, CLONER: 7, VOID: 8,
  CONCRETE: 9, HEATER: 10, COOLER: 11, FAN: 12, PUMP: 13, PIPE: 14, CONVEYOR: 15, LAMP: 16,
  IGNITER: 17, LEAF: 18, BUZZER: 19, STOVE: 20, SPOUT: 21, LIMITER: 22,
});

export const POWER = Object.freeze({
  NONE: 0, SOURCE: 1, CONDUCTOR: 2, CONSUMER: 3, SWITCH: 4, THERMOSTAT: 5, THERMOCOUPLE: 6,
  SOLAR: 7, HEATSENSOR: 8, PRESSURE: 9, LIQUIDSENSOR: 10,
});

export const POWER_LABELS = ['', 'power source', 'conductor', 'device', 'switch', 'thermostat', 'heat generator', 'solar source', 'heat sensor', 'pressure sensor', 'liquid sensor'];

export const RENDER = Object.freeze({
  NORMAL: 0, FIRE: 1, MOLTEN: 2, WATER: 3, GAS: 4, WIRE: 5, SWITCH: 6, LAMP: 7, CONVEYOR: 8,
  PIPE: 9, FAN: 10, GLASS: 11, POWERED: 12, CRYO: 13, LED: 14, PLATE: 15,
});

export const AIR_DENSITY = 1.2;

/** Thematic groups (used for sub-headings, the recipe book and discoveries). */
export const CATEGORIES = [
  { key: 'earth', name: 'Earth & Minerals', icon: '⛰' },
  { key: 'metal', name: 'Ores & Metals', icon: '⛏' },
  { key: 'alloy', name: 'Alloys', icon: '⚙' },
  { key: 'liquid', name: 'Liquids', icon: '💧' },
  { key: 'gas', name: 'Gases', icon: '☁' },
  { key: 'food', name: 'Food', icon: '🍳' },
  { key: 'organic', name: 'Plants & Organic', icon: '🌿' },
  { key: 'fire', name: 'Fire & Reactions', icon: '🔥' },
  { key: 'construction', name: 'Construction', icon: '🧱' },
  { key: 'industrial', name: 'Electronics', icon: '⚡' },
  { key: 'tools', name: 'Tools & Machinery', icon: '🛠' },
];

/** Sidebar tabs. Materials pick a tab via `tab`, otherwise it is derived from their state. */
export const TABS = [
  { key: 'solid', name: 'Solids', icon: '🪨', hint: 'Metals, stone, construction, gems' },
  { key: 'powder', name: 'Powders', icon: '⏳', hint: 'Sand, dirt, ores, salt' },
  { key: 'liquid', name: 'Liquids', icon: '💧', hint: 'Water, lava, oil, molten metals' },
  { key: 'gas', name: 'Gases', icon: '☁', hint: 'Steam, smoke, oxygen…' },
  { key: 'food', name: 'Food', icon: '🍳', hint: 'Milk, eggs, flour, sugar — cook and combine' },
  { key: 'organic', name: 'Nature', icon: '🌿', hint: 'Wood, plants, fuels' },
  { key: 'fire', name: 'Fire', icon: '🔥', hint: 'Fire, explosives, plasma' },
  { key: 'electronics', name: 'Electronics', icon: '⚡', hint: 'Batteries, wires, switches, sensors, lights' },
  { key: 'special', name: 'Special', icon: '✦', hint: 'Cloner, void, bedrock' },
  { key: 'tools', name: 'Tools', icon: '🛠', hint: 'Crucibles, moulds, furnaces, kitchen' },
];

export function deriveTab(def) {
  if (def.tab) return def.tab;
  if (def.cat === 'food') return 'food';
  if (def.cat === 'industrial') return 'electronics';
  if (def.cat === 'fire') return 'fire';
  if (def.cat === 'organic') return 'organic';
  if (def.state === 'liquid') return 'liquid';
  if (def.state === 'gas') return 'gas';
  if (def.state === 'powder') return 'powder';
  return 'solid';
}

export const DEFAULTS = {
  density: 1500,
  cond: 0.2,
  cap: 1.5,
  temp: null,
  hot: null,
  cold: null,
  flammable: 0,
  ignite: 99999,
  burn: null,
  fuel: 0,
  glow: true,
  viscosity: 0,
  spread: 3,
  slide: 0.85,
  life: null,
  vary: 0.07,
  tex: null,
  power: 'none',
  behavior: 'none',
  render: 'normal',
  tags: [],
  hidden: false,
  indestructible: false,
  explosive: 0,
  desc: '',
};

// ---------------------------------------------------------------------------
// Temperature colour tables (blackbody-ish incandescence and a thermal-view ramp).

export const BB_STEP = 16;
export const BB_SIZE = 420; // covers 0 .. 6720 °C
export const BB_R = new Uint8Array(BB_SIZE);
export const BB_G = new Uint8Array(BB_SIZE);
export const BB_B = new Uint8Array(BB_SIZE);
export const BB_I = new Float32Array(BB_SIZE);

(function buildBlackbody() {
  const stops = [
    [400, 60, 0, 0],
    [550, 140, 18, 0],
    [700, 205, 40, 4],
    [850, 255, 82, 10],
    [1000, 255, 128, 30],
    [1200, 255, 170, 60],
    [1450, 255, 210, 120],
    [1800, 255, 238, 190],
    [2500, 255, 252, 236],
    [4000, 225, 236, 255],
    [7000, 190, 205, 255],
  ];
  for (let k = 0; k < BB_SIZE; k++) {
    const t = k * BB_STEP;
    let r = 0, g = 0, b = 0;
    if (t >= stops[0][0]) {
      let s = stops.length - 1;
      for (let j = 0; j < stops.length - 1; j++) {
        if (t < stops[j + 1][0]) { s = j; break; }
      }
      const a = stops[s], c = stops[Math.min(s + 1, stops.length - 1)];
      const f = c[0] === a[0] ? 0 : clamp((t - a[0]) / (c[0] - a[0]), 0, 1);
      r = a[1] + (c[1] - a[1]) * f;
      g = a[2] + (c[2] - a[2]) * f;
      b = a[3] + (c[3] - a[3]) * f;
    }
    BB_R[k] = r; BB_G[k] = g; BB_B[k] = b;
    BB_I[k] = clamp((t - 430) / 900, 0, 1);
  }
})();

export function bbIndex(t) {
  const k = (t / BB_STEP) | 0;
  return k < 0 ? 0 : k >= BB_SIZE ? BB_SIZE - 1 : k;
}

/** Thermal view palette: -200..3000°C mapped through a perceptual ramp. */
export const HEAT_SIZE = 256;
export const HEAT_LUT = new Uint32Array(HEAT_SIZE);
(function buildHeatLut() {
  const stops = [
    [0, 30, 10, 90], [0.18, 40, 90, 220], [0.3, 30, 190, 220], [0.38, 40, 200, 90],
    [0.5, 230, 220, 40], [0.65, 250, 130, 20], [0.8, 230, 30, 30], [1, 255, 250, 250],
  ];
  for (let k = 0; k < HEAT_SIZE; k++) {
    const t = k / (HEAT_SIZE - 1);
    let s = 0;
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
    const a = stops[s], b = stops[s + 1];
    const f = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
    HEAT_LUT[k] = packRGBA(a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f, 255);
  }
})();

export function heatIndex(t) {
  // piecewise: -200..20 -> 0..0.3, 20..3000 -> 0.3..1 (sqrt for detail at lower temps)
  let v;
  if (t < 20) v = clamp((t + 200) / 220, 0, 1) * 0.3;
  else v = 0.3 + Math.sqrt(clamp((t - 20) / 2980, 0, 1)) * 0.7;
  return (v * (HEAT_SIZE - 1)) | 0;
}

// ---------------------------------------------------------------------------
// Procedural textures. Every material gets a 16-colour palette (for moving cells)
// and a 32x32 tile (for static cells, sampled by world position).

const TEX = 32;

function shadeRGB(rgb, f) {
  return [clamp(rgb[0] * f, 0, 255), clamp(rgb[1] * f, 0, 255), clamp(rgb[2] * f, 0, 255)];
}

function mixRGB(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function defaultTexFor(state) {
  switch (state) {
    case STATE.POWDER: return 'grain';
    case STATE.LIQUID: return 'liquid';
    case STATE.GAS: return 'gas';
    case STATE.FIRE: return 'fire';
    default: return 'noise';
  }
}

export function defaultAlpha(def, state) {
  if (def.alpha != null) return def.alpha;
  if (state === STATE.GAS) return 150;
  if (state === STATE.FIRE) return 230;
  if (state === STATE.LIQUID) return 235;
  return 255;
}

/**
 * Build palette + texture for a material definition.
 * Returns { palette: Uint32Array(16), tex: Uint32Array(1024), useTex: boolean, rgb }.
 */
export function buildMaterialVisuals(def, state, seed) {
  const base = hexToRgb(def.color);
  const accent = def.accent ? hexToRgb(def.accent) : shadeRGB(base, 1.25);
  const vary = def.vary ?? 0.07;
  const alpha = defaultAlpha(def, state);
  const style = def.tex || defaultTexFor(state);
  const palette = new Uint32Array(16);
  const tex = new Uint32Array(TEX * TEX);

  // Palette: per-cell variation for moving materials.
  for (let k = 0; k < 16; k++) {
    const h = hash2(k, 7, seed);
    let rgb;
    if (style === 'ore' && k >= 12) {
      rgb = shadeRGB(accent, 0.9 + h * 0.25);
    } else if (style === 'speckle' && k >= 13) {
      rgb = k === 15 ? shadeRGB(base, 1.35) : shadeRGB(base, 0.6);
    } else if (style === 'crystal' && k >= 13) {
      rgb = mixRGB(base, [255, 255, 255], 0.45);
    } else {
      const f = 1 + (h - 0.5) * 2 * vary;
      rgb = shadeRGB(base, f);
      // tiny hue wobble
      const hw = (hash2(k, 13, seed) - 0.5) * vary * 40;
      rgb = [clamp(rgb[0] + hw, 0, 255), rgb[1], clamp(rgb[2] - hw, 0, 255)];
    }
    palette[k] = packRGBA(rgb[0], rgb[1], rgb[2], alpha);
  }

  // Texture tile for static materials.
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const n = hash2(x, y, seed);
      let rgb = base;
      let a = alpha;
      switch (style) {
        case 'stone': {
          const f = fbm(x / 9, y / 9, seed, 3);
          rgb = shadeRGB(base, 0.82 + f * 0.36 + (n - 0.5) * vary);
          if (fbm(x / 5 + 11, y / 5, seed + 4, 2) > 0.72) rgb = shadeRGB(base, 0.7);
          break;
        }
        case 'brick': {
          const bw = def.brickW || 8, bh = def.brickH || 4;
          const row = Math.floor(y / bh);
          const off = (row % 2) * (bw / 2);
          const mortar = y % bh === bh - 1 || (x + off) % bw === bw - 1;
          if (mortar) rgb = def.mortar ? hexToRgb(def.mortar) : shadeRGB(base, 0.62);
          else rgb = shadeRGB(base, 0.9 + hash2(Math.floor((x + off) / bw), row, seed) * 0.2 + (n - 0.5) * vary);
          break;
        }
        case 'wood': {
          const ring = Math.sin(x * 0.9 + valueNoise(x / 4, y / 12, seed) * 5);
          rgb = shadeRGB(base, 0.85 + ring * 0.1 + (n - 0.5) * vary);
          break;
        }
        case 'planks': {
          const ph = 5;
          const seam = y % ph === ph - 1 || (x + Math.floor(y / ph) * 11) % 24 === 0;
          const grain = Math.sin(y * 1.7 + valueNoise(x / 10, y, seed) * 3) * 0.06;
          rgb = seam ? shadeRGB(base, 0.62) : shadeRGB(base, 0.92 + grain + hash2(Math.floor(y / ph), 3, seed) * 0.12);
          break;
        }
        case 'metal': {
          const streak = valueNoise(x / 14, y * 1.3, seed) * 0.16;
          const hl = ((x + y) % 23 === 0) ? 0.12 : 0;
          rgb = shadeRGB(base, 0.9 + streak + hl + (n - 0.5) * vary * 0.5);
          break;
        }
        case 'crystal': {
          const facet = Math.abs(((x - y + 64) % 9) - 4) / 4;
          rgb = mixRGB(shadeRGB(base, 0.85 + facet * 0.25), [255, 255, 255], n > 0.94 ? 0.5 : 0);
          break;
        }
        case 'ore': {
          const f = fbm(x / 6, y / 6, seed, 2);
          rgb = f > 0.62 ? shadeRGB(accent, 0.9 + n * 0.25) : shadeRGB(base, 0.85 + f * 0.3);
          break;
        }
        case 'speckle': {
          rgb = n > 0.93 ? shadeRGB(base, 1.4) : n < 0.07 ? shadeRGB(base, 0.55) : shadeRGB(base, 0.95 + (n - 0.5) * vary);
          break;
        }
        case 'glass': {
          const shine = (x + y) % 17 === 0 || (x + y) % 17 === 1;
          rgb = shine ? mixRGB(base, [255, 255, 255], 0.5) : shadeRGB(base, 0.97 + (n - 0.5) * 0.04);
          a = shine ? Math.min(255, alpha + 40) : alpha;
          break;
        }
        case 'plant': {
          rgb = shadeRGB(base, 0.8 + fbm(x / 3, y / 3, seed, 2) * 0.4);
          break;
        }
        case 'circuit': {
          const line = (x % 8 === 3) || (y % 8 === 5);
          const dot = (x % 8 === 3 && y % 8 === 5);
          rgb = dot ? accent : line ? shadeRGB(base, 1.25) : shadeRGB(base, 0.9 + (n - 0.5) * 0.06);
          break;
        }
        case 'grate': {
          const bar = (x % 4 === 0) || (y % 4 === 0);
          rgb = bar ? shadeRGB(base, 1.2) : shadeRGB(base, 0.72);
          break;
        }
        case 'coil': {
          const stripe = (x + y * 2) % 6 < 2;
          rgb = stripe ? accent : shadeRGB(base, 0.9 + (n - 0.5) * 0.08);
          break;
        }
        case 'fluffy': {
          rgb = shadeRGB(base, 0.82 + fbm(x / 2.5, y / 2.5, seed, 3) * 0.36);
          break;
        }
        case 'stripes': {
          rgb = (Math.floor((x + y) / 3) % 2) ? shadeRGB(base, 1.12) : shadeRGB(base, 0.9);
          break;
        }
        case 'bedrock': {
          const f = fbm(x / 5, y / 5, seed, 3);
          rgb = shadeRGB(base, 0.7 + f * 0.6);
          break;
        }
        default: {
          rgb = shadeRGB(base, 1 + (n - 0.5) * 2 * vary);
        }
      }
      tex[y * TEX + x] = packRGBA(rgb[0], rgb[1], rgb[2], a);
    }
  }

  const useTex = state === STATE.SOLID && style !== 'grain' && style !== 'liquid';
  return { palette, tex, useTex, rgb: base, alpha };
}
