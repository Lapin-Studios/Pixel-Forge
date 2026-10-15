// Base class for every movable rigid object: a small local cell grid with a transform.
// Local cells are WALL (solid body), CAVITY / PART / HOPPER (hold contents) or CHAMBER (open, heated space).
import { rng, bytesToBase64, base64ToBytes, formatTemp } from '../utils/MathUtils.js';
import { STATE } from '../materials/MaterialProperties.js';
import { transitionFor, pickOutcome, latentStep } from '../physics/PhaseTransitions.js';

export const MASK = Object.freeze({ EXT: 0, WALL: 1, CAVITY: 2, PART: 3, CHAMBER: 4, HOPPER: 5 });
export const isCavityKind = (k) => k === 2 || k === 3 || k === 5;

/**
 * Parse an ASCII shape. legend maps characters to { k: MASK kind, mat?: material key }.
 * '.' and ' ' are always exterior.
 */
export function parseShape(reg, rows, legend) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const mask = new Uint8Array(w * h);
  const mat = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x] ?? '.';
      if (ch === '.' || ch === ' ') continue;
      const e = legend[ch];
      if (!e) throw new Error(`Shape legend missing "${ch}"`);
      mask[y * w + x] = e.k;
      if (e.mat) mat[y * w + x] = reg.id(e.mat);
    }
  }
  return { w, h, mask, mat };
}

/** Build a shape from a function (x, y) => { k, mat } | null. */
export function shapeFromFn(reg, w, h, fn) {
  const mask = new Uint8Array(w * h);
  const mat = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = fn(x, y);
      if (!e) continue;
      mask[y * w + x] = e.k;
      if (e.mat) mat[y * w + x] = reg.id(e.mat);
    }
  }
  return { w, h, mask, mat };
}

export class WorldObject {
  constructor(game, spec) {
    this.game = game;
    this.reg = game.registry;
    this.id = 0;
    this.type = spec.type;
    this.name = spec.name || 'Object';
    this.w = spec.w;
    this.h = spec.h;
    this.mask = spec.mask;
    this.mat = spec.mat;
    const n = this.w * this.h;
    const amb = game.world ? game.world.ambient : 22;
    this.temp = new Float32Array(n).fill(amb);
    this.life = new Int16Array(n);
    this.px = spec.pivot ? spec.pivot[0] : Math.floor(this.w / 2);
    this.py = spec.pivot ? spec.pivot[1] : Math.floor(this.h / 2);
    this.x = 0;
    this.y = 0;
    this.angle = 0;
    this.angVel = 0; // rad per tick (tipping / tumbling)
    this.vx = 0;
    this.vy = 0;
    this.held = false;
    this.anchored = !!spec.anchored;
    this.dead = false;
    this.heavy = !!spec.heavy;
    this.maskVersion = 0;
    this._fp = null;
    this._fpAngle = NaN;
    this._fpVersion = -1;
    this.stamped = new Int32Array(64);
    this.stampedCount = 0;
    this.dirtyStamp = true;
    this.isContainer = false;
    this.isItem = false;
    this.isMachine = false;
    this.looseSolids = true;
    this.age = 0;
    this.impactSound = spec.impactSound || 'clink';
    this.edge = null;
  }

  get ox() { return Math.round(this.x); }
  get oy() { return Math.round(this.y); }

  onMaskChanged() {
    this.maskVersion++;
    this.dirtyStamp = true;
    this.edge = null;
  }

  /** Footprint: world offsets (relative to the rounded origin) of every non-exterior local cell. */
  getFootprint() {
    if (this._fp && this._fpAngle === this.angle && this._fpVersion === this.maskVersion) return this._fp;
    const a = this.angle, ca = Math.cos(a), sa = Math.sin(a);
    const { w, h, px, py, mask } = this;
    const corners = [[-px, -py], [w - px, -py], [-px, h - py], [w - px, h - py]];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [cx, cy] of corners) {
      const rx = ca * cx - sa * cy, ry = sa * cx + ca * cy;
      if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
    }
    const x0 = Math.floor(minX) - 1, x1 = Math.ceil(maxX) + 1;
    const y0 = Math.floor(minY) - 1, y1 = Math.ceil(maxY) + 1;
    const offs = [], loc = [], kinds = [], chamber = [];
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (let dy = y0; dy <= y1; dy++) {
      for (let dx = x0; dx <= x1; dx++) {
        const wx = dx + 0.5, wy = dy + 0.5;
        const lx = px + ca * wx + sa * wy;
        const ly = py - sa * wx + ca * wy;
        if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue;
        const li = (ly | 0) * w + (lx | 0);
        const k = mask[li];
        if (k === MASK.EXT) continue;
        if (k === MASK.CHAMBER) { chamber.push(dx, dy, li); continue; }
        offs.push(dx, dy);
        loc.push(li);
        kinds.push(k);
        if (dx < bx0) bx0 = dx; if (dx > bx1) bx1 = dx;
        if (dy < by0) by0 = dy; if (dy > by1) by1 = dy;
      }
    }
    this._fp = {
      offs: Int32Array.from(offs),
      loc: Int32Array.from(loc),
      kinds: Uint8Array.from(kinds),
      count: loc.length,
      chamber: Int32Array.from(chamber),
      minX: bx0, maxX: bx1, minY: by0, maxY: by1,
    };
    this._fpAngle = this.angle;
    this._fpVersion = this.maskVersion;
    return this._fp;
  }

  /** World bounding box (inclusive cells) at the current position. */
  bounds() {
    const fp = this.getFootprint();
    const ox = this.ox, oy = this.oy;
    if (fp.count === 0) return { x0: ox, y0: oy, x1: ox, y1: oy };
    return { x0: ox + fp.minX, y0: oy + fp.minY, x1: ox + fp.maxX, y1: oy + fp.maxY };
  }

  localToWorld(lx, ly) {
    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    const rx = lx - this.px, ry = ly - this.py;
    return [this.ox + ca * rx - sa * ry, this.oy + sa * rx + ca * ry];
  }

  worldToLocal(wx, wy) {
    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    const rx = wx - this.ox, ry = wy - this.oy;
    return [this.px + ca * rx + sa * ry, this.py - sa * rx + ca * ry];
  }

  maskAt(lx, ly) {
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return MASK.EXT;
    return this.mask[ly * this.w + lx];
  }

  /** Edge flags for crisp pixel shading: bit0 top/left exposed, bit1 bottom/right exposed. */
  getEdges() {
    if (this.edge) return this.edge;
    const { w, h, mask } = this;
    const e = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const li = y * w + x;
        if (mask[li] !== MASK.WALL) continue;
        const up = this.maskAt(x, y - 1), left = this.maskAt(x - 1, y);
        const down = this.maskAt(x, y + 1), right = this.maskAt(x + 1, y);
        if (up !== MASK.WALL || left !== MASK.WALL) e[li] |= 1;
        if (down !== MASK.WALL || right !== MASK.WALL) e[li] |= 2;
      }
    }
    this.edge = e;
    return e;
  }

  acceptContent() { return false; }

  wallCount() {
    let c = 0;
    for (let i = 0; i < this.mask.length; i++) if (this.mask[i] === MASK.WALL) c++;
    return c;
  }

  avgTemp(kindFilter = null) {
    let s = 0, c = 0;
    for (let i = 0; i < this.mask.length; i++) {
      const k = this.mask[i];
      if (k === MASK.EXT || k === MASK.CHAMBER) continue;
      if (kindFilter === 'wall' && k !== MASK.WALL) continue;
      if (kindFilter === 'content' && (k === MASK.WALL || this.mat[i] === 0)) continue;
      s += this.temp[i];
      c++;
    }
    return c ? s / c : NaN;
  }

  maxTemp() {
    let m = -Infinity;
    for (let i = 0; i < this.mask.length; i++) if (this.mask[i] !== MASK.EXT && this.mask[i] !== MASK.CHAMBER && this.temp[i] > m) m = this.temp[i];
    return m;
  }

  /** Per-tick hook (containers, machines). */
  update() {}

  /**
   * Walls that exceed their melting / ignition point fail. Molten wall material is released into
   * the world, which breaches containers and melts cast items back into liquid metal.
   */
  checkWalls(ctx) {
    const reg = this.reg;
    const { mask, mat, temp } = this;
    let emissions = null;
    for (let li = 0; li < mask.length; li++) {
      if (mask[li] !== MASK.WALL) continue;
      const m = mat[li];
      const t = temp[li];
      let out = -1;
      if (t >= reg.hotT[m]) {
        const tr = transitionFor(reg, m, t);
        if (tr && (tr.chance >= 1 || rng() < tr.chance) && latentStep(reg, m, true, this.life, temp, li)) out = pickOutcome(tr);
      } else if (reg.flammable[m] > 0 && t >= reg.igniteT[m] && rng() < reg.flammable[m] * 0.5) {
        out = rng() < 0.7 ? reg.FIRE : pickOutcome(reg.burnTo[m]);
      }
      if (out < 0) continue;
      if (out !== 0 && reg.state[out] === STATE.SOLID) {
        mat[li] = out; // e.g. clay -> ceramic, stays part of the body
        continue;
      }
      mask[li] = MASK.EXT;
      mat[li] = 0;
      (emissions ||= []).push(li, out, t);
    }
    if (!emissions) return;
    // Sound: brittle walls crack, metal walls melt with a hiss, burning walls whoosh.
    if (this.game.audio?.ctx) {
      const b = this.bounds();
      const out = emissions[1];
      const sound = out === reg.FIRE ? 'whoosh' : out && reg.state[out] === STATE.LIQUID ? 'sizzle' : 'shatter';
      this.game.audio.playAt(sound, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0.7);
    }
    this.onMaskChanged();
    ctx.objects.restamp(this);
    for (let k = 0; k < emissions.length; k += 3) {
      const li = emissions[k], m = emissions[k + 1];
      if (m === 0) continue;
      const lx = li % this.w, ly = (li / this.w) | 0;
      ctx.objects.emitFromObject(this, lx, ly, m, reg.stabilize(m, emissions[k + 2]), 0);
      this.game.discovery?.material(m);
    }
    if (this.wallCount() === 0 && !this.hasContents()) this.dead = true;
  }

  hasContents() {
    for (let i = 0; i < this.mask.length; i++) if (isCavityKind(this.mask[i]) && this.mat[i] !== 0) return true;
    return false;
  }

  /** Data for the inspector panel. */
  describe() {
    return {
      title: this.name,
      subtitle: this.category || 'Object',
      rows: [
        ['Temperature', formatTemp(this.avgTemp('wall'), this.game.settings?.get('tempUnit'))],
        ['Angle', `${Math.round((this.angle * 180) / Math.PI)}°`],
      ],
      controls: [],
    };
  }

  hint() {
    return 'Drag to move · Q/E or wheel to tilt · Del to delete';
  }

  saveState() { return {}; }
  loadState() {}

  serialize() {
    return {
      type: this.type,
      name: this.name,
      x: this.x, y: this.y, angle: this.angle,
      vx: this.vx, vy: this.vy,
      anchored: this.anchored,
      w: this.w, h: this.h,
      mask: bytesToBase64(this.mask),
      mat: bytesToBase64(new Uint8Array(this.mat.buffer.slice(0))),
      temp: bytesToBase64(new Uint8Array(this.temp.buffer.slice(0))),
      state: this.saveState(),
    };
  }

  /** Restore grids from serialized data (sizes must match). */
  restoreGrids(data) {
    if (data.w !== this.w || data.h !== this.h) return false;
    const n = this.w * this.h;
    const mask = base64ToBytes(data.mask);
    const matBytes = base64ToBytes(data.mat);
    const tempBytes = base64ToBytes(data.temp);
    if (mask.length !== n || matBytes.length !== n * 2 || tempBytes.length !== n * 4) return false;
    const mat = new Uint16Array(matBytes.buffer.slice(matBytes.byteOffset, matBytes.byteOffset + n * 2));
    for (let i = 0; i < n; i++) if (mat[i] >= this.reg.count) mat[i] = 0;
    this.mask = mask;
    this.mat = mat;
    this.temp = new Float32Array(tempBytes.buffer.slice(tempBytes.byteOffset, tempBytes.byteOffset + n * 4));
    for (let i = 0; i < n; i++) if (!Number.isFinite(this.temp[i])) this.temp[i] = 22;
    this.onMaskChanged();
    return true;
  }
}
