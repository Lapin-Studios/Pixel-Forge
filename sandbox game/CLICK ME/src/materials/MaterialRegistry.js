// Compiles the data-driven material table into flat typed arrays for the hot simulation loops.
import {
  STATE, STATE_BY_NAME, BEHAVIOR, POWER, RENDER, DEFAULTS, buildMaterialVisuals, deriveTab,
} from './MaterialProperties.js';
import { MATERIAL_DEFS } from './Materials.js';
import { hexToRgb, packRGBA } from '../utils/MathUtils.js';

const BEHAVIOR_BY_NAME = Object.fromEntries(Object.entries(BEHAVIOR).map(([k, v]) => [k.toLowerCase(), v]));
const POWER_BY_NAME = Object.fromEntries(Object.entries(POWER).map(([k, v]) => [k.toLowerCase(), v]));
const RENDER_BY_NAME = Object.fromEntries(Object.entries(RENDER).map(([k, v]) => [k.toLowerCase(), v]));

export class MaterialRegistry {
  constructor(defs = MATERIAL_DEFS) {
    this.defs = [];
    this.byKey = new Map();
    for (const raw of defs) this.register(raw);
    this.finalize();
  }

  register(raw) {
    if (!raw.key || this.byKey.has(raw.key)) throw new Error(`Duplicate or missing material key: ${raw.key}`);
    const def = { ...DEFAULTS, ...raw };
    def.id = this.defs.length;
    def.stateId = STATE_BY_NAME[def.state];
    if (def.stateId === undefined) throw new Error(`Unknown state "${def.state}" for ${def.key}`);
    def.tab = deriveTab(def);
    this.defs.push(def);
    this.byKey.set(def.key, def);
    return def.id;
  }

  /** Material id by key (0 / empty if unknown). */
  id(key) {
    const d = this.byKey.get(key);
    if (!d) {
      if (key && key !== 'empty') console.warn(`Unknown material: ${key}`);
      return 0;
    }
    return d.id;
  }

  has(key) { return this.byKey.has(key); }
  get(idOrKey) { return typeof idOrKey === 'number' ? this.defs[idOrKey] : this.byKey.get(idOrKey); }
  get count() { return this.defs.length; }
  name(id) { return this.defs[id]?.name ?? 'Unknown'; }

  hasTag(id, tag) {
    const set = this.tagSets.get(tag);
    return !!set && set[id] === 1;
  }

  idsWithTag(tag) {
    const out = [];
    const set = this.tagSets.get(tag);
    if (!set) return out;
    for (let i = 0; i < set.length; i++) if (set[i]) out.push(i);
    return out;
  }

  _compileTransition(tr, fromKey) {
    if (!tr) return null;
    const list = Array.isArray(tr.to) ? tr.to : [[tr.to, 1]];
    const ids = [], weights = [];
    let total = 0;
    for (const [k, w] of list) {
      if (k !== 'empty' && !this.byKey.has(k)) throw new Error(`Transition of ${fromKey} references unknown "${k}"`);
      ids.push(k === 'empty' ? 0 : this.byKey.get(k).id);
      weights.push(w);
      total += w;
    }
    return {
      t: tr.t,
      ids: Int32Array.from(ids),
      weights: Float32Array.from(weights),
      total,
      single: ids.length === 1 ? ids[0] : -1,
      emit: tr.emit ? this.id(tr.emit) : 0,
      chance: tr.chance ?? 1,
      temp: tr.temp ?? NaN,
    };
  }

  finalize() {
    const n = this.defs.length;
    this.state = new Uint8Array(n);
    this.density = new Float32Array(n);
    this.cond = new Float32Array(n);
    this.invCap = new Float32Array(n);
    this.defTemp = new Float32Array(n);
    this.hotT = new Float32Array(n);
    this.coldT = new Float32Array(n);
    this.flammable = new Float32Array(n);
    this.igniteT = new Float32Array(n);
    this.burnTime = new Uint16Array(n);
    this.burnTemp = new Float32Array(n);
    this.burnSmoke = new Uint8Array(n);
    this.viscosity = new Float32Array(n);
    this.spread = new Uint8Array(n);
    this.slide = new Float32Array(n);
    this.lifeMin = new Int16Array(n);
    this.lifeMax = new Int16Array(n);
    this.glow = new Uint8Array(n);
    this.powerKind = new Uint8Array(n);
    this.behavior = new Uint8Array(n);
    this.render = new Uint8Array(n);
    this.fuel = new Float32Array(n);
    this.indestructible = new Uint8Array(n);
    this.explosive = new Float32Array(n);
    this.directional = new Uint8Array(n);
    this.hasReaction = new Uint8Array(n);
    this.useTex = new Uint8Array(n);
    this.latent = new Float32Array(n);
    this.accentColor = new Uint32Array(n);
    this.selfOx = new Uint8Array(n);
    this.hot = new Array(n).fill(null);
    this.cold = new Array(n).fill(null);
    this.burnTo = new Array(n).fill(null);
    this.palette = new Array(n);
    this.tex = new Array(n);
    this.baseRgb = new Array(n);
    this.tagSets = new Map();
    this.reactions = new Array(n).fill(null);

    for (const d of this.defs) {
      const i = d.id;
      this.state[i] = d.stateId;
      this.density[i] = d.density;
      this.cond[i] = d.cond;
      this.invCap[i] = 1 / Math.max(1, d.cap);
      this.defTemp[i] = d.temp ?? NaN;
      this.hot[i] = this._compileTransition(d.hot, d.key);
      this.cold[i] = this._compileTransition(d.cold, d.key);
      this.hotT[i] = this.hot[i] ? this.hot[i].t : Infinity;
      this.coldT[i] = this.cold[i] ? this.cold[i].t : -Infinity;
      this.flammable[i] = d.flammable || 0;
      this.igniteT[i] = d.ignite ?? 99999;
      const burn = d.burn || {};
      this.burnTime[i] = Math.min(65000, burn.time ?? 1);
      this.burnTemp[i] = burn.temp ?? 900;
      this.burnSmoke[i] = burn.smoke ? 1 : 0;
      this.burnTo[i] = burn.to ? this._compileTransition({ t: 0, to: burn.to }, d.key) : this._compileTransition({ t: 0, to: 'empty' }, d.key);
      this.viscosity[i] = d.viscosity;
      this.spread[i] = d.spread;
      this.slide[i] = d.slide;
      if (d.life) { this.lifeMin[i] = d.life[0]; this.lifeMax[i] = d.life[1]; }
      this.glow[i] = d.glow ? 1 : 0;
      this.powerKind[i] = POWER_BY_NAME[d.power] ?? 0;
      this.behavior[i] = BEHAVIOR_BY_NAME[d.behavior] ?? 0;
      this.render[i] = RENDER_BY_NAME[d.render] ?? 0;
      this.fuel[i] = d.fuel || 0;
      this.indestructible[i] = d.indestructible ? 1 : 0;
      this.explosive[i] = d.explosive || 0;
      this.directional[i] = d.directional || 0;
      this.latent[i] = d.latent ?? (d.cat === 'metal' || d.cat === 'alloy' ? 400 : 250);
      this.selfOx[i] = d.selfOxidizing ? 1 : 0;
      const ac = hexToRgb(d.accent || d.color);
      this.accentColor[i] = packRGBA(ac[0], ac[1], ac[2], 255);
      for (const tag of d.tags || []) {
        if (!this.tagSets.has(tag)) this.tagSets.set(tag, new Uint8Array(n));
        this.tagSets.get(tag)[i] = 1;
      }
      const vis = buildMaterialVisuals(d, d.stateId, i * 7919 + 17);
      this.palette[i] = vis.palette;
      this.tex[i] = vis.tex;
      this.useTex[i] = vis.useTex ? 1 : 0;
      this.baseRgb[i] = vis.rgb;
    }

    // Latent heat applies to melting (solid/powder -> liquid) and freezing (liquid -> solid/powder):
    // the cell sits at its transition temperature while it absorbs / releases this much heat.
    this.hotLatent = new Uint8Array(n);
    this.coldLatent = new Uint8Array(n);
    for (const d of this.defs) {
      const i = d.id, s = this.state[i];
      const h = this.hot[i], c = this.cold[i];
      if (h) {
        const to = h.single >= 0 ? h.single : h.ids[0];
        if ((s === STATE.SOLID || s === STATE.POWDER) && this.state[to] === STATE.LIQUID) this.hotLatent[i] = 1;
      }
      if (c) {
        const to = c.single >= 0 ? c.single : c.ids[0];
        if (s === STATE.LIQUID && (this.state[to] === STATE.SOLID || this.state[to] === STATE.POWDER)) this.coldLatent[i] = 1;
      }
    }

    // Common ids used by the engine.
    this.EMPTY = 0;
    this.FIRE = this.id('fire');
    this.SMOKE = this.id('smoke');
    this.STEAM = this.id('steam');
    this.WATER = this.id('water');
    this.ASH = this.id('ash');
    this.EMBER = this.id('ember');
    this.EXPLOSION = this.id('explosion');
    this.OXYGEN = this.id('oxygen');
    this.PIPE = this.id('pipe');
    this.CONVEYOR = this.id('conveyor');
    this.SWITCH = this.id('switch');
    this.THERMOSTAT = this.id('thermostat');
    this.HEAT_SENSOR = this.id('heat_sensor');
    this.DIRT = this.id('dirt');
    this.MUD = this.id('mud');
    this.GRASS = this.id('grass');
    this.PLANT = this.id('plant');
    this.LEAVES = this.id('leaves');
    this.FLOWER = this.id('flower');
    this.VINE = this.id('vine');
    this.MOSS = this.id('moss');
    this.FUNGUS = this.id('fungus');
    this.CONCRETE = this.id('concrete');
    this.CLONER = this.id('cloner');
    this.SPOUT = this.id('spout');
    this.STOVE = this.id('stove');
    this.HEAT_LIMITER = this.id('heat_limiter');
    this.VOID = this.id('void');
    this.BEDROCK = this.id('bedrock');
    this.isWater = this.tagSets.get('water');
    this.isCarbon = this.tagSets.get('carbon');
  }

  /** Clamp a temperature into the stable range of material m (used for reaction products). */
  stabilize(m, t) {
    if (t <= this.coldT[m]) return this.coldT[m] + 3;
    if (t >= this.hotT[m]) return this.hotT[m] - 3;
    return t;
  }

  /** Materials visible in the palette, grouped by sidebar tab. */
  paletteByTab() {
    const map = new Map();
    for (const d of this.defs) {
      if (d.hidden) continue;
      if (!map.has(d.tab)) map.set(d.tab, []);
      map.get(d.tab).push(d);
    }
    return map;
  }
}

export { STATE };
