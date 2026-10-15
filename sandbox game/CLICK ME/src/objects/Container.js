// Containers hold real cells in their cavity. Contents are simulated in the container's local
// frame with gravity rotated by the container's tilt, so tilting physically pours cells out of the rim.
import { rng, DIRS8, formatTemp } from '../utils/MathUtils.js';
import { STATE } from '../materials/MaterialProperties.js';
import { findReaction, rollReaction } from '../materials/Reactions.js';
import { transitionFor, pickOutcome, latentStep, phaseSound } from '../physics/PhaseTransitions.js';
import { WorldObject, MASK, isCavityKind } from './WorldObject.js';

const { SOLID, POWDER, LIQUID, GAS, FIRE } = STATE;
const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export class Container extends WorldObject {
  constructor(game, spec) {
    super(game, spec);
    this.isContainer = true;
    this.looseSolids = spec.looseSolids ?? true;
    this.acceptsItems = spec.acceptsItems ?? true;
    this.category = spec.category || 'Container';
    this.moveMark = new Uint8Array(this.w * this.h);
    this.tickMark = 1;
    this._order = null;
    this._orderKey = '';
    this.capacity = 0;
    for (let i = 0; i < this.mask.length; i++) if (isCavityKind(this.mask[i])) this.capacity++;
    this.pourCount = 0;
  }

  onMaskChanged() {
    super.onMaskChanged();
    this._orderKey = '';
  }

  accepts(m) {
    if (m === 0) return false;
    const s = this.reg.state[m];
    return s === POWDER || s === LIQUID || s === SOLID;
  }

  acceptContent(li, m) {
    return isCavityKind(this.mask[li]) && this.mat[li] === 0 && this.accepts(m, li);
  }

  /** Free cavity cells. */
  freeCount() {
    let c = 0;
    for (let i = 0; i < this.mask.length; i++) if (isCavityKind(this.mask[i]) && this.mat[i] === 0) c++;
    return c;
  }

  fillCount() {
    let c = 0;
    for (let i = 0; i < this.mask.length; i++) if (isCavityKind(this.mask[i]) && this.mat[i] !== 0) c++;
    return c;
  }

  /** Nearest free cavity cell to local index `from` (BFS over cavity cells). */
  findFreeCavity(from) {
    const { w, h, mask, mat } = this;
    if (from >= 0 && isCavityKind(mask[from]) && mat[from] === 0) return from;
    // Fallback: lowest free cell (in gravity direction) if no start given.
    const seen = new Uint8Array(w * h);
    const queue = [];
    if (from >= 0) { queue.push(from); seen[from] = 1; }
    else {
      for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) {
        const li = y * w + x;
        if (isCavityKind(mask[li]) && mat[li] === 0) return li;
      }
      return -1;
    }
    for (let q = 0; q < queue.length; q++) {
      const li = queue[q];
      const lx = li % w, ly = (li / w) | 0;
      for (const [dx, dy] of N4) {
        const nx = lx + dx, ny = ly + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni]) continue;
        seen[ni] = 1;
        if (mask[ni] === MASK.WALL) continue;
        if (isCavityKind(mask[ni]) && mat[ni] === 0) return ni;
        queue.push(ni);
      }
    }
    return -1;
  }

  /** Fill from the bottom with `count` cells of material key (used by presets / spawning). */
  fillWith(key, count, temp) {
    const m = this.reg.id(key);
    if (!m) return 0;
    const { w, h, mask, mat } = this;
    let placed = 0;
    const t = temp ?? (Number.isNaN(this.reg.defTemp[m]) ? (this.game.world?.ambient ?? 22) : this.reg.defTemp[m]);
    for (let y = h - 1; y >= 0 && placed < count; y--) {
      for (let x = 0; x < w && placed < count; x++) {
        const li = y * w + x;
        if (isCavityKind(mask[li]) && mat[li] === 0 && this.accepts(m, li)) {
          mat[li] = m;
          this.temp[li] = t;
          placed++;
        }
      }
    }
    return placed;
  }

  /** Remove one liquid content cell (used by pumps). */
  extractLiquid() {
    const { mask, mat } = this;
    // Take from the top-most liquid so pumps skim naturally.
    for (let li = 0; li < mask.length; li++) {
      if (!isCavityKind(mask[li])) continue;
      const m = mat[li];
      if (m !== 0 && this.reg.state[m] === LIQUID) {
        const t = this.temp[li];
        mat[li] = 0;
        return { m, t };
      }
    }
    return null;
  }

  insertContent(m, t) {
    const li = this.findFreeCavity(-1);
    if (li < 0 || !this.accepts(m, li)) return false;
    this.mat[li] = m;
    this.temp[li] = t;
    return true;
  }

  getOrder(gx, gy) {
    const key = `${Math.round(gx * 40)},${Math.round(gy * 40)},${this.maskVersion}`;
    if (key === this._orderKey) return this._order;
    const { w, mask } = this;
    const list = [];
    for (let li = 0; li < mask.length; li++) if (isCavityKind(mask[li])) list.push(li);
    list.sort((a, b) => {
      const pa = (a % w) * gx + ((a / w) | 0) * gy;
      const pb = (b % w) * gx + ((b / w) | 0) * gy;
      return pb - pa;
    });
    this._order = Int32Array.from(list);
    this._orderKey = key;
    return this._order;
  }

  update(ctx) {
    this.pourCount = 0;
    this.simulateContents(ctx);
    this.simulateContents(ctx);
    if (this.pourCount) this.pourSound();
    this.stir();
    this.contentChemistry(ctx);
    if ((this.age++ & 7) === 0) this.checkWalls(ctx);
  }

  /**
   * Convection: neighbouring liquids of similar density slowly intermix (so molten copper and tin
   * blend into bronze), while very different densities (metal vs slag, oil vs water) stay layered.
   */
  stir() {
    const reg = this.reg;
    const { w, h, mask, mat } = this;
    const order = this._order;
    if (!order) return;
    const n = Math.min(order.length, 24);
    for (let k = 0; k < n; k++) {
      const li = order[(rng() * order.length) | 0];
      const m = mat[li];
      if (!m || reg.state[m] !== LIQUID) continue;
      const d = N4[(rng() * 4) | 0];
      const nx = (li % w) + d[0], ny = ((li / w) | 0) + d[1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!isCavityKind(mask[ni])) continue;
      const mn = mat[ni];
      if (!mn || mn === m || reg.state[mn] !== LIQUID) continue;
      const da = reg.density[m], db = reg.density[mn];
      if (Math.abs(da - db) / Math.max(da, db) > 0.3) continue;
      this.swapLocal(li, ni);
    }
  }

  simulateContents(ctx) {
    const reg = this.reg;
    const { w, mat } = this;
    const a = this.angle;
    const gx = Math.sin(a), gy = Math.cos(a);
    const theta = Math.atan2(gy, gx) / (Math.PI / 4);
    const k0 = Math.floor(theta);
    const frac = theta - k0;
    const order = this.getOrder(gx, gy);
    this.tickMark = (this.tickMark % 250) + 1;
    const mark = this.tickMark;
    const moveMark = this.moveMark;

    for (let q = 0; q < order.length; q++) {
      const li = order[q];
      const m = mat[li];
      if (m === 0 || moveMark[li] === mark) continue;
      const st = reg.state[m];
      if (st === SOLID && !this.looseSolids) continue;
      if (st === LIQUID && reg.viscosity[m] > 0 && rng() < reg.viscosity[m] * 0.85) continue;
      let k = (rng() < frac ? k0 + 1 : k0) & 7;
      const rising = st === GAS || st === FIRE;
      if (rising) k = (k + 4) & 7;
      const lx = li % w, ly = (li / w) | 0;
      if (this.tryLocalMove(li, lx, ly, k, m, st, ctx) !== -1) continue;
      if (st === SOLID && rng() > 0.5) continue;
      const s = rng() < 0.5 ? 1 : -1;
      if (this.tryLocalMove(li, lx, ly, (k + s) & 7, m, st, ctx) !== -1) continue;
      if (this.tryLocalMove(li, lx, ly, (k - s) & 7, m, st, ctx) !== -1) continue;
      if (st === LIQUID || rising) {
        const spread = Math.max(1, Math.min(3, reg.spread[m]));
        for (let attempt = 0; attempt < 2; attempt++) {
          const sk = (k + (attempt === 0 ? 2 * s : -2 * s)) & 7;
          let cur = li, cx = lx, cy = ly, moved = false;
          for (let step = 0; step < spread; step++) {
            const r = this.tryLocalMove(cur, cx, cy, sk, m, st, ctx);
            if (r === -1) break;
            moved = true;
            if (r === -2) break;
            cur = r;
            cx = r % w;
            cy = (r / w) | 0;
          }
          if (moved) break;
        }
      }
    }
  }

  /** Returns new local index, -2 if the cell left the container, -1 if blocked. */
  tryLocalMove(li, lx, ly, k, m, st, ctx) {
    const d = DIRS8[k];
    const dx = d[0], dy = d[1];
    if (dx !== 0 && dy !== 0) {
      if (this.maskAt(lx + dx, ly) === MASK.WALL && this.maskAt(lx, ly + dy) === MASK.WALL) return -1;
    }
    const nx = lx + dx, ny = ly + dy;
    const { w, h, mask, mat } = this;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return this.emitCell(li, nx, ny, ctx, dx, dy);
    const ni = ny * w + nx;
    const kind = mask[ni];
    if (kind === MASK.WALL) return -1;
    if (kind === MASK.EXT || kind === MASK.CHAMBER) return this.emitCell(li, nx, ny, ctx, dx, dy);
    if (kind === MASK.HOPPER && mask[li] !== MASK.HOPPER) return -1;
    const mn = mat[ni];
    if (mn === 0) {
      this.swapLocal(li, ni);
      this.moveMark[ni] = this.tickMark;
      return ni;
    }
    const reg = this.reg;
    const sn = reg.state[mn];
    const rising = st === GAS || st === FIRE;
    if (rising) {
      if (sn !== GAS && sn !== FIRE) {
        this.swapLocal(li, ni);
        this.moveMark[ni] = this.tickMark;
        return ni;
      }
      return -1;
    }
    if ((sn === LIQUID || sn === GAS || sn === FIRE) && reg.density[m] > reg.density[mn]) {
      if (sn === LIQUID && st !== LIQUID && rng() < 0.4) return -1;
      this.swapLocal(li, ni);
      this.moveMark[ni] = this.tickMark;
      this.moveMark[li] = this.tickMark;
      return ni;
    }
    return -1;
  }

  /** Glug of molten metal, splash of liquid or hiss of pouring powder. */
  pourSound() {
    const audio = this.game.audio;
    if (!audio?.ctx) return;
    const reg = this.reg, m = this.lastPoured;
    if (!m) return;
    const molten = reg.render[m] === 2 && this.lastPouredT > 500;
    const name = molten ? 'pourMetal' : reg.state[m] === LIQUID ? 'pour' : 'pourSand';
    const b = this.bounds();
    audio.playAt(name, (b.x0 + b.x1) / 2, b.y0, Math.min(1, 0.45 + this.pourCount * 0.12));
  }

  swapLocal(a, b) {
    const { mat, temp, life } = this;
    let v = mat[a]; mat[a] = mat[b]; mat[b] = v;
    const t = temp[a]; temp[a] = temp[b]; temp[b] = t;
    v = life[a]; life[a] = life[b]; life[b] = v;
  }

  emitCell(li, nx, ny, ctx, dx = 0, dy = 0) {
    const m = this.mat[li];
    const res = ctx.objects.emitFromObject(this, nx, ny, m, this.temp[li], this.life[li], li, dx, dy);
    if (res === 1) {
      this.lastPoured = m;
      this.lastPouredT = this.temp[li];
      this.mat[li] = 0;
      this.life[li] = 0;
      this.pourCount = (this.pourCount || 0) + 1;
      return -2;
    }
    if (res === 2) return -2;
    return -1;
  }

  /** Phase changes and reactions between cells inside the container. */
  contentChemistry(ctx) {
    const reg = this.reg;
    const { w, h, mask, mat, temp } = this;
    for (let li = 0; li < mask.length; li++) {
      if (!isCavityKind(mask[li])) continue;
      const m = mat[li];
      if (m === 0) continue;
      const t = temp[li];
      if (t >= reg.hotT[m] || t <= reg.coldT[m]) {
        const tr = transitionFor(reg, m, t);
        if (tr && (tr.chance >= 1 || rng() < tr.chance) && latentStep(reg, m, tr === reg.hot[m], this.life, temp, li)) {
          const nm = pickOutcome(tr);
          mat[li] = nm;
          if (!Number.isNaN(tr.temp)) temp[li] = tr.temp;
          this.life[li] = 0;
          if (tr.emit) this.placeNear(li, tr.emit, t);
          this.game.discovery?.material(nm);
          if (this.game.audio?.ctx) {
            const [wx, wy] = this.localToWorld((li % w) + 0.5, ((li / w) | 0) + 0.5);
            phaseSound(this.game, m, nm, wx, wy);
          }
          if (reg.state[m] === LIQUID && reg.state[nm] === SOLID && t > 500 && rng() < 0.02) {
            const [wx, wy] = this.localToWorld((li % w) + 0.5, ((li / w) | 0) + 0.5);
            ctx.fx?.sparks(wx, wy, 1, t);
          }
          continue;
        }
      }
      if (reg.hasReaction[m] && rng() < 0.5) {
        const d = N4[(rng() * 4) | 0];
        const nx = (li % w) + d[0], ny = ((li / w) | 0) + d[1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!isCavityKind(mask[ni])) continue;
        const mb = mat[ni];
        if (mb === 0) continue;
        const tt = t > temp[ni] ? t : temp[ni];
        const r = findReaction(reg, m, mb, tt);
        if (!r || !rollReaction(r)) continue;
        if (r.outSelf >= 0) { mat[li] = r.outSelf; temp[li] = r.outSelf ? reg.stabilize(r.outSelf, temp[li] + r.heat) : temp[li]; this.game.discovery?.material(r.outSelf); }
        else temp[li] += r.heat;
        if (r.outOther >= 0) { mat[ni] = r.outOther; temp[ni] = r.outOther ? reg.stabilize(r.outOther, temp[ni] + r.heat) : temp[ni]; this.game.discovery?.material(r.outOther); }
        else temp[ni] += r.heat;
        this.game.discovery?.reaction(r.def.id);
      }
    }
  }

  placeNear(li, m, t) {
    const { w, h, mask, mat } = this;
    const lx = li % w, ly = (li / w) | 0;
    for (const [dx, dy] of N4) {
      const nx = lx + dx, ny = ly + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (isCavityKind(mask[ni]) && mat[ni] === 0) {
        mat[ni] = m;
        this.temp[ni] = this.reg.stabilize(m, t);
        return true;
      }
    }
    return false;
  }

  /** Summary of contents for the inspector: [{m, count, avgT}] sorted by count. */
  contentSummary() {
    const map = new Map();
    const { mask, mat, temp } = this;
    for (let li = 0; li < mask.length; li++) {
      if (!isCavityKind(mask[li])) continue;
      const m = mat[li];
      if (!m) continue;
      const e = map.get(m) || { m, count: 0, sumT: 0 };
      e.count++;
      e.sumT += temp[li];
      map.set(m, e);
    }
    return [...map.values()].map((e) => ({ m: e.m, count: e.count, avgT: e.sumT / e.count })).sort((a, b) => b.count - a.count);
  }

  moltenFraction() {
    let liq = 0, tot = 0;
    for (let li = 0; li < this.mask.length; li++) {
      if (!isCavityKind(this.mask[li])) continue;
      const m = this.mat[li];
      if (!m) continue;
      tot++;
      if (this.reg.state[m] === LIQUID) liq++;
    }
    return tot ? liq / tot : 0;
  }

  describe() {
    const unit = this.game.settings?.get('tempUnit');
    const d = super.describe();
    const fill = this.fillCount();
    d.rows.unshift(['Contents temp', formatTemp(this.avgTemp('content'), unit)]);
    d.rows.push(['Fill', `${fill} / ${this.capacity} cells`]);
    d.bars = [{ label: 'Fill', value: this.capacity ? fill / this.capacity : 0, color: '#6fa8dc' }];
    const molten = this.moltenFraction();
    if (fill) d.bars.push({ label: 'Molten', value: molten, color: '#ff8a2a' });
    d.contents = this.contentSummary();
    d.controls.push({ type: 'button', id: 'empty', label: 'Dump contents', onClick: () => this.dumpContents() });
    return d;
  }

  dumpContents() {
    const { mask, mat } = this;
    for (let li = 0; li < mask.length; li++) if (isCavityKind(mask[li])) { mat[li] = 0; this.life[li] = 0; }
  }

  hint() {
    return 'Drag to carry · Q/E or wheel to tilt and pour · R to level · Del to delete';
  }
}
