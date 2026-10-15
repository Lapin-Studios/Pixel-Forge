// Burning, ignition and explosions.
import { rng } from '../utils/MathUtils.js';
import { STATE } from '../materials/MaterialProperties.js';
import { pickOutcome } from './PhaseTransitions.js';

const N4X = [0, 0, -1, 1];
const N4Y = [-1, 1, 0, 0];

export function ignite(sim, i, m) {
  const world = sim.world, reg = sim.reg;
  if (reg.explosive[m] > 0) {
    const w = world.w;
    explode(sim, i % w, (i / w) | 0, reg.explosive[m]);
    return;
  }
  const bt = reg.burnTime[m];
  const w = world.w;
  sim.game?.audio?.playAt('whoosh', i % w, (i / w) | 0, 0.5);
  if (bt <= 1) {
    world.setCell(i, reg.FIRE, reg.burnTemp[m]);
    return;
  }
  world.burn[i] = Math.max(1, (bt * (0.6 + rng() * 0.8)) | 0);
  world.wake(i);
}

/** Called when a flammable cell is above its ignition temperature. Needs air or oxygen. */
export function tryIgnite(sim, i, x, y, m) {
  const reg = sim.reg;
  if (rng() > reg.flammable[m]) return;
  if (!reg.selfOx[m] && reg.explosive[m] === 0 && !hasOxidizer(sim, i, x, y)) return;
  ignite(sim, i, m);
}

function hasOxidizer(sim, i, x, y) {
  const world = sim.world, w = world.w, h = world.h;
  const cells = world.cells, reg = sim.reg;
  for (let k = 0; k < 4; k++) {
    const nx = x + N4X[k], ny = y + N4Y[k];
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const j = ny * w + nx;
    if (world.objMask[j] !== 0) continue;
    const mj = cells[j];
    if (mj === 0 || mj === reg.OXYGEN || mj === reg.FIRE) return true;
  }
  return false;
}

/** Update a burning cell. Returns true if the cell was consumed. */
export function updateBurning(sim, i, x, y, m) {
  const world = sim.world, reg = sim.reg;
  const w = world.w, h = world.h;
  const cells = world.cells;
  const selfOx = reg.selfOx[m] === 1; // fuses carry their own oxidiser
  let air = -1, airCount = 0, oxygen = false;

  for (let k = 0; k < 4; k++) {
    const nx = x + N4X[k], ny = y + N4Y[k];
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const j = ny * w + nx;
    if (world.objMask[j] !== 0) continue;
    const mj = cells[j];
    if (reg.isWater[mj] && !selfOx) {
      // Extinguished: water flashes to steam.
      world.burn[i] = 0;
      world.transform(j, reg.STEAM, 110);
      world.temp[i] = Math.min(world.temp[i], reg.igniteT[m] - 40);
      sim.fx?.steam(nx, ny, 2);
      sim.game?.audio?.playAt('sizzle', nx, ny);
      return false;
    }
    if (mj === 0) { airCount++; if (air < 0 || k === 0) air = j; }
    else if (mj === reg.OXYGEN) { oxygen = true; airCount++; air = j; }
  }

  if (airCount === 0 && !selfOx && rng() < 0.04) {
    world.burn[i] = 0; // smothered
    return false;
  }

  const bt = reg.burnTemp[m] + (oxygen ? 300 : 0);
  if (world.temp[i] < bt) world.temp[i] += (bt - world.temp[i]) * (selfOx ? 0.5 : 0.25);
  if (selfOx) {
    if (rng() < 0.35) sim.fx?.sparks(x + 0.5, y, 1, 1300);
    sim.game?.audio?.playAt('fuse', x, y, 0.7);
  }

  if (air >= 0 && rng() < (selfOx ? 0.08 : oxygen ? 0.6 : 0.3)) {
    world.setCell(air, reg.FIRE, bt);
  } else if (air >= 0 && reg.burnSmoke[m] && rng() < 0.03) {
    world.setCell(air, reg.SMOKE);
  }
  if (rng() < 0.002) sim.fx?.embers(x, y, 1);

  let b = world.burn[i] - (oxygen ? 3 : 1);
  if (b <= 0) {
    world.burn[i] = 0;
    const nm = pickOutcome(reg.burnTo[m]);
    if (nm === 0) world.clearCell(i);
    else world.transform(i, nm, reg.stabilize(nm, world.temp[i]));
    sim.discover(nm);
    return true;
  }
  world.burn[i] = b;
  world.wake(i);
  return false;
}

/** Blast: destroys / ignites cells in a radius and shoves objects. */
export function explode(sim, cx, cy, power) {
  const world = sim.world, reg = sim.reg;
  const w = world.w, h = world.h;
  const r = Math.max(2, Math.round(power));
  const r2 = r * r;
  const cells = world.cells;
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= w) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const i = y * w + x;
      if (world.objMask[i] !== 0) continue;
      const m = cells[i];
      if (reg.indestructible[m]) continue;
      const f = 1 - Math.sqrt(d2) / r;
      const s = reg.state[m];
      if (m === 0 || s === STATE.GAS || s === STATE.FIRE) {
        if (rng() < f * 0.9) world.setCell(i, reg.EXPLOSION, 1200 + 900 * f);
      } else if (reg.explosive[m] > 0) {
        world.setCell(i, reg.EXPLOSION, 1800);
        world.temp[i] = 2000;
      } else if (s === STATE.LIQUID || s === STATE.POWDER) {
        if (rng() < f * 0.5) world.setCell(i, rng() < 0.5 ? reg.FIRE : reg.SMOKE, 900);
        else world.temp[i] += 300 * f;
      } else {
        if (rng() < f * f * 0.35) world.setCell(i, reg.FIRE, 900);
        else world.temp[i] += 250 * f;
      }
      world.wake(i);
    }
  }
  sim.game?.objects?.applyImpulse(cx, cy, r * 2.2, power * 0.6);
  sim.fx?.explosion(cx, cy, power);
  sim.game?.audio?.playAt('boom', cx, cy, Math.min(1, 0.4 + power / 10));
}
