// The cell grid: flat typed arrays + chunked activity tracking.
import { rng } from '../utils/MathUtils.js';

export const CHUNK_SHIFT = 4;
export const CHUNK = 1 << CHUNK_SHIFT;

export class World {
  constructor(width, height, registry, ambient = 22) {
    this.reg = registry;
    this.w = width | 0;
    this.h = height | 0;
    this.size = this.w * this.h;
    this.ambient = ambient;
    const n = this.size;
    this.cells = new Uint16Array(n);   // material id
    this.temp = new Float32Array(n);   // °C
    this.life = new Int16Array(n);     // lifetime / growth / direction / setpoint / switch state
    this.burn = new Uint16Array(n);    // remaining burn ticks (0 = not burning)
    this.shade = new Uint8Array(n);    // per-cell colour variation
    this.stamp = new Uint8Array(n);    // update mark (prevents double updates per tick)
    this.power = new Uint8Array(n);    // electrical state
    this.pipe = new Uint16Array(n);    // material carried inside a pipe cell
    this.objMask = new Int32Array(n);  // >0 object wall id, <0 object cavity id
    this.objLocal = new Int32Array(n); // local cell index inside the owning object
    this.temp.fill(ambient);
    for (let i = 0; i < n; i++) this.shade[i] = (rng() * 256) | 0;

    this.cw = Math.ceil(this.w / CHUNK);
    this.ch = Math.ceil(this.h / CHUNK);
    this.active = new Uint8Array(this.cw * this.ch).fill(1);
    this.nextActive = new Uint8Array(this.cw * this.ch).fill(1);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  idx(x, y) {
    return y * this.w + x;
  }

  /** Mark the chunk containing cell i (and touching neighbours) active for the next tick. */
  wake(i) {
    const w = this.w;
    const y = (i / w) | 0;
    const x = i - y * w;
    const cx = x >> CHUNK_SHIFT, cy = y >> CHUNK_SHIFT;
    const cw = this.cw;
    const na = this.nextActive;
    na[cy * cw + cx] = 1;
    const lx = x & (CHUNK - 1), ly = y & (CHUNK - 1);
    if (lx === 0 && cx > 0) na[cy * cw + cx - 1] = 1;
    else if (lx === CHUNK - 1 && cx < cw - 1) na[cy * cw + cx + 1] = 1;
    if (ly === 0 && cy > 0) na[(cy - 1) * cw + cx] = 1;
    else if (ly === CHUNK - 1 && cy < this.ch - 1) na[(cy + 1) * cw + cx] = 1;
  }

  wakeAll() {
    this.active.fill(1);
    this.nextActive.fill(1);
  }

  wakeRect(x0, y0, x1, y1) {
    const cx0 = Math.max(0, (x0 >> CHUNK_SHIFT) - 1), cy0 = Math.max(0, (y0 >> CHUNK_SHIFT) - 1);
    const cx1 = Math.min(this.cw - 1, (x1 >> CHUNK_SHIFT) + 1), cy1 = Math.min(this.ch - 1, (y1 >> CHUNK_SHIFT) + 1);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.nextActive[cy * this.cw + cx] = 1;
  }

  beginTick() {
    const t = this.active;
    this.active = this.nextActive;
    this.nextActive = t;
    this.nextActive.fill(0);
  }

  activeChunkCount() {
    let c = 0;
    for (let k = 0; k < this.active.length; k++) c += this.active[k];
    return c;
  }

  initialLife(m) {
    const reg = this.reg;
    const lo = reg.lifeMin[m], hi = reg.lifeMax[m];
    if (hi > 0) return lo + ((rng() * (hi - lo + 1)) | 0);
    return 0;
  }

  /** Replace the cell with material m. t = temperature (defaults to material spawn temp / ambient). */
  setCell(i, m, t) {
    const reg = this.reg;
    this.cells[i] = m;
    if (t === undefined || Number.isNaN(t)) {
      const d = reg.defTemp[m];
      t = Number.isNaN(d) ? (m === 0 ? this.temp[i] : this.ambient) : d;
    }
    this.temp[i] = t;
    this.life[i] = this.initialLife(m);
    this.burn[i] = 0;
    this.shade[i] = (rng() * 256) | 0;
    if (m !== reg.PIPE) this.pipe[i] = 0;
    this.wake(i);
  }

  /** Change material but keep temperature / shade (phase changes, reactions). */
  transform(i, m, t) {
    this.cells[i] = m;
    if (t !== undefined && !Number.isNaN(t)) this.temp[i] = t;
    this.life[i] = this.initialLife(m);
    this.burn[i] = 0;
    if (m !== this.reg.PIPE) this.pipe[i] = 0;
    this.wake(i);
  }

  clearCell(i) {
    this.cells[i] = 0;
    this.life[i] = 0;
    this.burn[i] = 0;
    this.pipe[i] = 0;
    this.wake(i);
  }

  /** Swap two cells completely (movement). */
  swap(i, j) {
    const c = this.cells, t = this.temp, l = this.life, b = this.burn, s = this.shade;
    let v = c[i]; c[i] = c[j]; c[j] = v;
    let f = t[i]; t[i] = t[j]; t[j] = f;
    v = l[i]; l[i] = l[j]; l[j] = v;
    v = b[i]; b[i] = b[j]; b[j] = v;
    v = s[i]; s[i] = s[j]; s[j] = v;
    this.wake(i);
    this.wake(j);
  }

  clearAll() {
    this.cells.fill(0);
    this.temp.fill(this.ambient);
    this.life.fill(0);
    this.burn.fill(0);
    this.pipe.fill(0);
    this.power.fill(0);
    this.wakeAll();
  }

  countNonEmpty() {
    let c = 0;
    const cells = this.cells;
    for (let i = 0; i < cells.length; i++) if (cells[i] !== 0) c++;
    return c;
  }

  /** Find the nearest empty, object-free cell around (x, y), preferring upward. */
  findFreeNear(x, y, maxR = 8) {
    const w = this.w, h = this.h;
    for (let r = 1; r <= maxR; r++) {
      const cand = [[0, -r], [-r, 0], [r, 0], [-r, -r], [r, -r], [0, r], [-r, r], [r, r]];
      for (let k = 0; k < cand.length; k++) {
        const nx = x + cand[k][0], ny = y + cand[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const i = ny * w + nx;
        if (this.cells[i] === 0 && this.objMask[i] === 0) return i;
      }
    }
    return -1;
  }
}
