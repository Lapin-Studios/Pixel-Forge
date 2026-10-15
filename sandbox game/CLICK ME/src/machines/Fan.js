// Powered fans push gases, fire and light powders along their facing direction.
import { rng } from '../utils/MathUtils.js';
import { STATE } from '../materials/MaterialProperties.js';

export const FAN_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // right, down, left, up
const RANGE = 14;

export function updateFan(sim, i, x, y, m) {
  const world = sim.world, reg = sim.reg;
  if (!world.power[i]) return true;
  world.wake(i);
  const [dx, dy] = FAN_DIRS[((world.life[i] % 4) + 4) % 4];
  const w = world.w, h = world.h;
  // Walk from far to near so cells are pushed once.
  let reach = 0;
  for (let k = 1; k <= RANGE; k++) {
    const nx = x + dx * k, ny = y + dy * k;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) break;
    const j = ny * w + nx;
    if (world.objMask[j] > 0) break;
    const mj = world.cells[j];
    if (mj !== 0 && reg.state[mj] === STATE.SOLID) break;
    reach = k;
  }
  for (let k = reach; k >= 1; k--) {
    const nx = x + dx * k, ny = y + dy * k;
    const j = ny * w + nx;
    const mj = world.cells[j];
    if (mj === 0) continue;
    const s = reg.state[mj];
    const light = s === STATE.GAS || s === STATE.FIRE || (s === STATE.POWDER && reg.density[mj] < 700);
    if (!light || rng() > 0.85 - k * 0.03) continue;
    const tx = nx + dx, ty = ny + dy;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
    const t = ty * w + tx;
    if (world.cells[t] === 0 && world.objMask[t] === 0) {
      world.swap(j, t);
      world.stamp[t] = sim.mark;
    }
  }
  return true;
}
