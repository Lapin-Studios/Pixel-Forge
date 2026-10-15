// Pumps and pipes. Each pipe cell carries one cell of liquid. Liquid flows away from pumps
// (by BFS distance) and is released at the far end — into open space or into a container.
import { rng } from '../utils/MathUtils.js';
import { STATE, BEHAVIOR } from '../materials/MaterialProperties.js';

const N4 = [[0, 1], [-1, 0], [1, 0], [0, -1]];

export class PipeNetwork {
  constructor(sim) {
    this.sim = sim;
    this.dist = null;
    this.queue = null;
  }

  reset() {
    this.dist = null;
  }

  rebuild() {
    const world = this.sim.world, reg = this.sim.reg;
    const n = world.size, w = world.w, h = world.h;
    if (!this.dist || this.dist.length !== n) {
      this.dist = new Int16Array(n);
      this.queue = new Int32Array(n);
    }
    const dist = this.dist, q = this.queue, cells = world.cells;
    const PIPE = reg.PIPE, PUMP = reg.id('pump');
    dist.fill(-1);
    let qt = 0;
    for (let i = 0; i < n; i++) {
      if (cells[i] === PUMP) { dist[i] = 0; q[qt++] = i; }
    }
    let qh = 0;
    while (qh < qt) {
      const i = q[qh++];
      const y = (i / w) | 0, x = i - y * w;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dist[j] !== -1 || cells[j] !== PIPE) continue;
        dist[j] = Math.min(32000, dist[i] + 1);
        q[qt++] = j;
      }
    }
  }
}

export function updatePump(sim, i, x, y, m) {
  const world = sim.world, reg = sim.reg;
  if (!world.power[i]) return true;
  world.wake(i);
  const w = world.w, h = world.h;
  const PIPE = reg.PIPE;
  // Find an empty adjacent pipe to push into.
  let out = -1;
  for (const [dx, dy] of N4) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const j = ny * w + nx;
    if (world.cells[j] === PIPE && world.pipe[j] === 0) { out = j; break; }
  }
  if (out < 0) return true;
  // Intake: adjacent free liquid, or a container cavity.
  for (const [dx, dy] of N4) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const j = ny * w + nx;
    const om = world.objMask[j];
    if (om !== 0) {
      const obj = sim.game.objects.byId.get(Math.abs(om));
      if (obj && obj.isContainer && obj.extractLiquid) {
        const got = obj.extractLiquid();
        if (got) {
          world.pipe[out] = got.m;
          world.temp[out] = got.t;
          world.wake(out);
          return true;
        }
      }
      continue;
    }
    const mj = world.cells[j];
    if (mj !== 0 && reg.state[mj] === STATE.LIQUID && reg.behavior[mj] !== BEHAVIOR.PIPE) {
      world.pipe[out] = mj;
      world.temp[out] = world.temp[j];
      world.clearCell(j);
      world.wake(out);
      return true;
    }
  }
  return true;
}

export function updatePipe(sim, i, x, y, m) {
  const world = sim.world, reg = sim.reg;
  const pm = world.pipe[i];
  if (pm === 0) return true;
  world.wake(i);
  if (rng() < 0.15) return true;
  const w = world.w, h = world.h;
  const dist = sim.pipes.dist;
  const d = dist ? dist[i] : -1;
  const PIPE = reg.PIPE;
  let hasForward = false;
  const start = (rng() * 4) | 0;
  for (let k = 0; k < 4; k++) {
    const [dx, dy] = N4[(start + k) & 3];
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const j = ny * w + nx;
    if (world.cells[j] !== PIPE) continue;
    const dj = dist ? dist[j] : -1;
    const forward = d < 0 ? dj < 0 : dj > d;
    if (!forward) continue;
    hasForward = true;
    if (world.pipe[j] === 0) {
      world.pipe[j] = pm;
      world.temp[j] = world.temp[i];
      world.pipe[i] = 0;
      world.stamp[j] = sim.mark;
      world.wake(j);
      return true;
    }
  }
  if (hasForward) return true;
  // End of the line: release into open space or a container (prefer below).
  for (const [dx, dy] of N4) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const j = ny * w + nx;
    const om = world.objMask[j];
    if (om < 0) {
      const obj = sim.game.objects.byId.get(-om);
      const li = world.objLocal[j];
      if (obj && obj.acceptContent(li, pm)) {
        obj.mat[li] = pm;
        obj.temp[li] = world.temp[i];
        world.pipe[i] = 0;
        return true;
      }
      continue;
    }
    if (om > 0) continue;
    if (world.cells[j] === 0) {
      world.setCell(j, pm, world.temp[i]);
      world.pipe[i] = 0;
      return true;
    }
  }
  return true;
}
