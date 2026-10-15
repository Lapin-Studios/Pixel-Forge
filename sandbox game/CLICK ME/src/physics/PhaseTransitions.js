// Melting, freezing, boiling, condensation and other temperature-driven changes.
import { rng } from '../utils/MathUtils.js';
import { STATE } from '../materials/MaterialProperties.js';

/**
 * Accumulate latent heat (reg.latent[m], in °C-equivalents of the cell's own heat capacity) for a
 * melting / freezing cell. Returns true when the phase change may happen now; otherwise pins the
 * temperature at the transition point. lifeArr / tempArr / idx address world or object arrays.
 */
export function latentStep(reg, m, hot, lifeArr, tempArr, idx) {
  if (hot ? !reg.hotLatent[m] : !reg.coldLatent[m]) return true;
  const t = tempArr[idx];
  const over = hot ? t - reg.hotT[m] : reg.coldT[m] - t;
  // life arrays are Int16: store the accumulated heat in 1/16 °C so slow cooling still adds up.
  const acc = Math.min(32000, (lifeArr[idx] > 0 ? lifeArr[idx] : 0) + Math.ceil(over * 16));
  if (acc >= reg.latent[m] * 16) return true;
  lifeArr[idx] = acc;
  tempArr[idx] = hot ? reg.hotT[m] - 0.01 : reg.coldT[m] + 0.01;
  return false;
}

const soundCache = new Map();

/** Which sound (if any) a change from material m to nm makes — ice cracking, popcorn, frying, melting. */
function phaseSoundName(reg, m, nm) {
  const key = m * 65536 + nm;
  let s = soundCache.get(key);
  if (s !== undefined) return s;
  s = '';
  const a = reg.defs[m], b = reg.defs[nm];
  if (a && b) {
    if (a.key === 'popcorn_kernel') s = 'pop';
    else if (a.stateId === STATE.LIQUID && b.stateId === STATE.SOLID && (b.key === 'ice' || b.key === 'popsicle')) s = 'iceCrack';
    else if (a.cat === 'food' && b.cat === 'food' && reg.hot[m] && reg.hot[m].ids.includes(nm)) s = 'fry';
    else if ((a.cat === 'metal' || a.cat === 'alloy') && a.stateId !== STATE.LIQUID && b.stateId === STATE.LIQUID) s = 'melt';
  }
  soundCache.set(key, s);
  return s;
}

/** Play the phase-change sound for m -> nm at a world position. */
export function phaseSound(game, m, nm, wx, wy) {
  const audio = game?.audio;
  if (!audio?.ctx) return;
  const s = phaseSoundName(game.registry, m, nm);
  if (s) audio.playAt(s, wx, wy, s === 'melt' ? 0.8 : 0.7);
}

export function pickOutcome(tr) {
  if (tr.single >= 0) return tr.single;
  let r = rng() * tr.total;
  for (let k = 0; k < tr.ids.length; k++) {
    r -= tr.weights[k];
    if (r <= 0) return tr.ids[k];
  }
  return tr.ids[tr.ids.length - 1];
}

/** Returns the transition that applies to material m at temperature t, or null. */
export function transitionFor(reg, m, t) {
  if (t >= reg.hotT[m]) return reg.hot[m];
  if (t <= reg.coldT[m]) return reg.cold[m];
  return null;
}

/** Apply a phase change to world cell i. Returns true if the cell changed. */
export function applyPhaseChange(sim, i, x, y, m, t) {
  const reg = sim.reg, world = sim.world;
  const tr = transitionFor(reg, m, t);
  if (!tr) return false;
  // A falling liquid droplet doesn't solidify into a floating static cell: it freezes on landing.
  if (tr === reg.cold[m] && reg.state[m] === STATE.LIQUID && y + 1 < world.h) {
    const nm0 = tr.single >= 0 ? tr.single : tr.ids[0];
    if (reg.state[nm0] === STATE.SOLID) {
      const below = i + world.w;
      const mb = world.cells[below];
      if (world.objMask[below] === 0 && (mb === 0 || reg.state[mb] >= STATE.GAS)) {
        world.wake(i);
        return false;
      }
    }
  }
  if (tr.chance < 1 && rng() > tr.chance) {
    world.wake(i);
    return false;
  }
  if (!latentStep(reg, m, tr === reg.hot[m], world.life, world.temp, i)) {
    world.wake(i);
    return false;
  }
  const nm = pickOutcome(tr);
  const nt = Number.isNaN(tr.temp) ? world.temp[i] : tr.temp;
  if (nm === 0) world.clearCell(i);
  else world.transform(i, nm, nt);

  if (tr.emit) emitNear(sim, x, y, tr.emit, nt);

  // Effects
  phaseSound(sim.game, m, nm, x, y);
  const fromState = reg.state[m], toState = reg.state[nm];
  if (toState === STATE.GAS && fromState === STATE.LIQUID && reg.isWater[m]) {
    if (rng() < 0.15) sim.fx?.steam(x, y, 1);
    sim.game?.audio?.playAt('sizzle', x, y, 0.3);
  } else if (fromState === STATE.LIQUID && toState === STATE.SOLID && t > 500 && rng() < 0.05) {
    sim.fx?.sparks(x, y, 1, t);
  } else if (!Number.isNaN(tr.temp) && tr.temp > 2000) {
    sim.fx?.sparks(x, y, 3, tr.temp);
  }
  sim.discover(nm);
  return true;
}

/** Place a gas (or other byproduct) into an empty neighbour if one exists. */
export function emitNear(sim, x, y, m, t) {
  const world = sim.world, w = world.w, h = world.h;
  const order = rng() < 0.5 ? [[0, -1], [-1, 0], [1, 0], [0, 1]] : [[0, -1], [1, 0], [-1, 0], [0, 1]];
  for (const [dx, dy] of order) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const j = ny * w + nx;
    if (world.cells[j] === 0 && world.objMask[j] === 0) {
      world.setCell(j, m, sim.reg.stabilize(m, t));
      sim.discover(m);
      return true;
    }
  }
  return false;
}
