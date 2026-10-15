// Gas and fire movement: buoyancy by density, random drift, lifetimes.
import { rng } from '../utils/MathUtils.js';
import { AIR_DENSITY } from '../materials/MaterialProperties.js';
import { ignite } from './Combustion.js';

export function updateGas(sim, i, x, y, m) {
  const world = sim.world, reg = sim.reg;
  const w = world.w;

  if (reg.lifeMax[m] > 0) {
    const l = world.life[i] - 1;
    if (l <= 0) { world.clearCell(i); return; }
    world.life[i] = l;
    world.wake(i);
  }

  const rising = reg.density[m] < AIR_DENSITY;
  const dy = rising ? -1 : 1;

  if (rng() < 0.3) {
    const d = rng() < 0.5 ? -1 : 1;
    if (x + d >= 0 && x + d < w && sim.tryMoveGas(i, i + d, m, rising)) return;
  }

  const ny = y + dy;
  if (ny < 0 || ny >= world.h) {
    // Light gases slowly vent out of the top of the world.
    if (ny < 0 && rng() < 0.004) world.clearCell(i);
    return;
  }
  const t = i + dy * w;
  if (sim.tryMoveGas(i, t, m, rising)) return;
  const d = rng() < 0.5 ? -1 : 1;
  if (x + d >= 0 && x + d < w && sim.tryMoveGas(i, t + d, m, rising)) return;
  if (x - d >= 0 && x - d < w && sim.tryMoveGas(i, t - d, m, rising)) return;
  if (x + d >= 0 && x + d < w && sim.tryMoveGas(i, i + d, m, rising)) return;
}

export function updateFire(sim, i, x, y, m) {
  const world = sim.world, reg = sim.reg;
  const w = world.w, h = world.h;
  const l = world.life[i] - 1;
  if (l <= 0) {
    if (m === reg.FIRE && rng() < 0.18) world.transform(i, reg.SMOKE, world.temp[i] * 0.5);
    else world.clearCell(i);
    return;
  }
  world.life[i] = l;
  world.wake(i);
  const ft = reg.burnTemp[m];
  if (world.temp[i] < ft) world.temp[i] = ft;

  // Heat / ignite a random neighbour.
  const k = (rng() * 4) | 0;
  let j = -1;
  if (k === 0 && y > 0) j = i - w;
  else if (k === 1 && y < h - 1) j = i + w;
  else if (k === 2 && x > 0) j = i - 1;
  else if (k === 3 && x < w - 1) j = i + 1;
  if (j >= 0 && world.objMask[j] === 0) {
    const mj = world.cells[j];
    if (mj !== 0 && mj !== m) {
      world.temp[j] += (ft - world.temp[j]) * 0.06 * reg.invCap[mj];
      world.wake(j);
      if (reg.flammable[mj] > 0 && world.burn[j] === 0 && world.temp[j] >= reg.igniteT[mj] * 0.6 && rng() < reg.flammable[mj] * 3) {
        ignite(sim, j, mj);
      }
    }
  }

  // Flicker upward.
  if (y > 0) {
    const d = ((rng() * 3) | 0) - 1;
    if (x + d >= 0 && x + d < w && sim.tryMoveGas(i, i - w + d, m, true)) return;
    if (sim.tryMoveGas(i, i - w, m, true)) return;
  }
}
