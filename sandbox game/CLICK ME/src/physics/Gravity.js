// Powder movement: fall, sink through lighter fluids, slide diagonally into piles.
import { rng } from '../utils/MathUtils.js';

export function updatePowder(sim, i, x, y, m) {
  const world = sim.world;
  const w = world.w;
  if (y >= world.h - 1) return;
  const below = i + w;
  if (sim.tryMoveDown(i, below, m)) return;
  if (rng() > sim.reg.slide[m]) return;
  const d = rng() < 0.5 ? -1 : 1;
  const x1 = x + d;
  if (x1 >= 0 && x1 < w && sim.tryMoveDiag(i, below + d, i + d, m)) return;
  const x2 = x - d;
  if (x2 >= 0 && x2 < w && sim.tryMoveDiag(i, below - d, i - d, m)) return;
}
