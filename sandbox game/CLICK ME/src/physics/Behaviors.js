// Per-material special behaviours: plant growth, cloners, concrete setting and machine cells.
import { rng } from '../utils/MathUtils.js';
import { BEHAVIOR, STATE } from '../materials/MaterialProperties.js';
import { updateHeatingElement, updateIgniter, updateStove } from '../machines/Heater.js';
import { updateCoolingElement } from '../machines/Cooler.js';
import { updateFan } from '../machines/Fan.js';
import { updatePump, updatePipe } from '../machines/Pump.js';
import { updateConveyor } from '../machines/Conveyor.js';

const N8 = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
const SPOUT_DOWN = [2, 5, 6, 1, 3];
const SPOUT_UP = [0, 4, 7, 1, 3];

function neighbour(world, x, y, k) {
  const nx = x + N8[k][0], ny = y + N8[k][1];
  if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) return -1;
  return ny * world.w + nx;
}

function waterNearby(sim, x, y, r) {
  const world = sim.world, reg = sim.reg;
  for (let t = 0; t < 6; t++) {
    const nx = x + ((rng() * (2 * r + 1)) | 0) - r;
    const ny = y + ((rng() * (2 * r + 1)) | 0) - r;
    if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
    const m = world.cells[ny * world.w + nx];
    if (reg.isWater[m] || m === reg.MUD) return ny * world.w + nx;
  }
  return -1;
}

/** Returns true if the cell was consumed / should not move this tick. */
export function updateBehavior(sim, i, x, y, m, b) {
  const world = sim.world, reg = sim.reg;
  const w = world.w;
  switch (b) {
    case BEHAVIOR.SEED: {
      world.wake(i);
      if (y + 1 >= world.h || rng() > 0.02) return false;
      const below = world.cells[i + w];
      if ((below === reg.DIRT || below === reg.MUD || below === reg.GRASS) && waterNearby(sim, x, y, 4) >= 0) {
        world.transform(i, reg.PLANT);
        world.life[i] = 18 + ((rng() * 30) | 0);
        sim.discover(reg.PLANT);
        return true;
      }
      return false;
    }
    case BEHAVIOR.PLANT: {
      const life = world.life[i];
      if (life <= 0) return true;
      world.wake(i);
      if (rng() > 0.04) return true;
      // drink water to keep growing
      const wj = waterNearby(sim, x, y, 3);
      if (wj >= 0 && rng() < 0.3) world.clearCell(wj);
      if (y === 0) { world.life[i] = 0; return true; }
      const up = i - w;
      if (life === 1) {
        if (world.cells[up] === 0 && world.objMask[up] === 0) { world.setCell(up, rng() < 0.6 ? reg.FLOWER : reg.LEAVES); sim.discover(reg.FLOWER); }
        world.life[i] = 0;
        return true;
      }
      const d = rng() < 0.5 ? -1 : 1;
      let target = up;
      if (rng() < 0.2 && x + d >= 0 && x + d < w) target = up + d;
      if (world.cells[target] === 0 && world.objMask[target] === 0) {
        world.setCell(target, reg.PLANT);
        world.life[target] = life - 1;
        world.life[i] = 0;
        // sprout a leaf
        if (rng() < 0.45) {
          const side = i + (rng() < 0.5 ? -1 : 1);
          const sx = side - y * w;
          if (sx >= 0 && sx < w && world.cells[side] === 0 && world.objMask[side] === 0) world.setCell(side, reg.LEAVES);
        }
      }
      return true;
    }
    case BEHAVIOR.GRASS: {
      if (rng() > 0.004) return true;
      world.wake(i);
      // smothered grass reverts to dirt
      if (y > 0) {
        const above = world.cells[i - w];
        const s = reg.state[above];
        if (above !== 0 && (s === STATE.SOLID || s === STATE.POWDER) && rng() < 0.2) { world.transform(i, reg.DIRT); return true; }
      }
      const j = neighbour(world, x, y, (rng() * 8) | 0);
      if (j >= 0 && world.cells[j] === reg.DIRT && j - w >= 0 && world.cells[j - w] === 0) world.transform(j, reg.GRASS);
      return true;
    }
    case BEHAVIOR.MOSS: {
      if (rng() > 0.003) return true;
      world.wake(i);
      const j = neighbour(world, x, y, (rng() * 8) | 0);
      if (j < 0) return true;
      const mj = world.cells[j];
      if ((reg.hasTag(mj, 'rock')) && waterNearby(sim, x, y, 3) >= 0) world.transform(j, reg.MOSS);
      return true;
    }
    case BEHAVIOR.VINE: {
      const life = world.life[i];
      if (life <= 0) return true;
      world.wake(i);
      if (rng() > 0.04 || y + 1 >= world.h) return true;
      const below = i + w;
      if (world.cells[below] === 0 && world.objMask[below] === 0) {
        world.setCell(below, reg.VINE);
        world.life[below] = life - 1;
        if (rng() < 0.15) {
          const side = below + (rng() < 0.5 ? -1 : 1);
          if (side >= 0 && side < world.size && world.cells[side] === 0 && world.objMask[side] === 0) world.setCell(side, reg.LEAVES);
        }
      }
      world.life[i] = 0;
      return true;
    }
    case BEHAVIOR.FUNGUS: {
      if (rng() > 0.006) return true;
      world.wake(i);
      const j = neighbour(world, x, y, (rng() * 8) | 0);
      if (j < 0) return true;
      const mj = world.cells[j];
      if (reg.hasTag(mj, 'organic') && mj !== reg.FUNGUS && reg.state[mj] !== STATE.LIQUID) {
        world.transform(j, reg.FUNGUS);
      } else if (rng() < 0.02 && waterNearby(sim, x, y, 4) < 0) {
        world.transform(i, reg.DIRT); // dries out
      }
      return true;
    }
    case BEHAVIOR.LEAF: {
      // Leaves without any plant support slowly wither and fall as ash/seeds.
      if (rng() > 0.0015) return true;
      let support = false;
      for (let k = 0; k < 8; k++) {
        const j = neighbour(world, x, y, k);
        if (j >= 0) {
          const mj = world.cells[j];
          if (mj === reg.PLANT || mj === reg.VINE || mj === reg.LEAVES || mj === reg.FLOWER || reg.hasTag(mj, 'wood')) { support = true; break; }
        }
      }
      if (!support) world.transform(i, rng() < 0.2 ? sim.reg.id('seed') : reg.ASH);
      return true;
    }
    case BEHAVIOR.CLONER: {
      world.wake(i);
      let src = world.life[i];
      if (src === 0) {
        for (let k = 0; k < 4; k++) {
          const j = neighbour(world, x, y, k);
          if (j < 0) continue;
          const mj = world.cells[j];
          if (mj !== 0 && mj !== reg.CLONER && mj !== reg.VOID) { world.life[i] = mj; break; }
        }
        return true;
      }
      if (rng() > 0.35) return true;
      const j = neighbour(world, x, y, (rng() * 4) | 0);
      if (j >= 0 && world.cells[j] === 0 && world.objMask[j] === 0) world.setCell(j, src);
      return true;
    }
    case BEHAVIOR.VOID: {
      world.wake(i);
      for (let k = 0; k < 4; k++) {
        const j = neighbour(world, x, y, k);
        if (j < 0) continue;
        const mj = world.cells[j];
        if (mj !== 0 && mj !== reg.VOID && !reg.indestructible[mj]) world.clearCell(j);
      }
      return true;
    }
    case BEHAVIOR.CONCRETE: {
      const l = world.life[i] + 1;
      world.life[i] = l;
      world.wake(i);
      if (l > 400 && rng() < 0.02) {
        world.transform(i, reg.CONCRETE);
        sim.discover(reg.CONCRETE);
        return true;
      }
      return false;
    }
    case BEHAVIOR.HEATER: return updateHeatingElement(sim, i, x, y, m);
    case BEHAVIOR.COOLER: return updateCoolingElement(sim, i, x, y, m);
    case BEHAVIOR.FAN: return updateFan(sim, i, x, y, m);
    case BEHAVIOR.PUMP: return updatePump(sim, i, x, y, m);
    case BEHAVIOR.PIPE: return updatePipe(sim, i, x, y, m);
    case BEHAVIOR.CONVEYOR: return updateConveyor(sim, i, x, y, m);
    case BEHAVIOR.IGNITER: return updateIgniter(sim, i, x, y, m);
    case BEHAVIOR.STOVE: return updateStove(sim, i, x, y, m);
    case BEHAVIOR.LIMITER: {
      // Powered Heat Limiter: registers itself; the cap is applied at the end of the tick
      // (after heat has spread) so nothing in range ever ends a tick above the limit.
      if (!world.power[i]) return true;
      world.wake(i);
      sim.limiters.push(i);
      return true;
    }
    case BEHAVIOR.SPOUT: {
      // Endless source: pushes its material into an empty neighbour every tick
      // (downward first for powders and liquids, upward first for gases).
      world.wake(i);
      const src = world.life[i];
      if (!src || !reg.defs[src] || src === reg.SPOUT) return true;
      const up = reg.state[src] >= STATE.GAS;
      const order = up ? SPOUT_UP : SPOUT_DOWN;
      for (let k = 0; k < order.length; k++) {
        const j = neighbour(world, x, y, order[k]);
        if (j >= 0 && world.cells[j] === 0 && world.objMask[j] === 0) { world.setCell(j, src); sim.discover(src); break; }
      }
      return true;
    }
    case BEHAVIOR.BUZZER: {
      if (!world.power[i]) return true;
      world.wake(i);
      if ((sim.tick & 15) === 0) sim.game.audio?.play('buzz');
      return true;
    }
    default: return false;
  }
}
