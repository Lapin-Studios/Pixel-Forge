// Liquid movement: fall, diagonal flow and horizontal dispersion with viscosity.
import { rng } from '../utils/MathUtils.js';

export function updateLiquid(sim, i, x, y, m) {
  const world = sim.world, reg = sim.reg;
  const w = world.w, h = world.h;
  const visc = reg.viscosity[m];
  if (visc > 0 && rng() < visc) {
    world.wake(i);
    return;
  }

  if (y < h - 1) {
    const below = i + w;
    const r = sim.tryMoveDown(i, below, m);
    if (r) {
      if (r === 1 && world.temp[below] > 800 && rng() < 0.004) sim.fx?.sparks(x, y + 1, 1, world.temp[below]);
      return;
    }
    const d = rng() < 0.5 ? -1 : 1;
    if (x + d >= 0 && x + d < w && sim.tryMoveDiag(i, below + d, i + d, m)) return;
    if (x - d >= 0 && x - d < w && sim.tryMoveDiag(i, below - d, i - d, m)) return;
  }

  const spread = reg.spread[m];
  if (spread === 0) return;
  let dir = rng() < 0.5 ? -1 : 1;
  const cells = world.cells;
  for (let attempt = 0; attempt < 2; attempt++, dir = -dir) {
    let cur = i, cx = x, moved = false;
    for (let k = 0; k < spread; k++) {
      const nx = cx + dir;
      if (nx < 0 || nx >= w) break;
      const n = cur + dir;
      const r = sim.tryMoveSide(cur, n, m);
      if (r === 0) break;
      if (r === 2) return; // absorbed into a container
      cur = n;
      cx = nx;
      moved = true;
      if (y < h - 1) {
        const b = cur + w;
        if (cells[b] === 0 && world.objMask[b] === 0) break; // will fall next tick
      }
    }
    if (moved) return;
  }
}
