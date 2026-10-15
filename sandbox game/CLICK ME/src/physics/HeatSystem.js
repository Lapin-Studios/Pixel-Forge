// Explicit heat diffusion between neighbouring cells, restricted to active chunks.
import { CHUNK, CHUNK_SHIFT } from '../core/World.js';

export const HEAT_K = 0.22;
const AIR_RELAX = 0.004;
const WAKE_EPS = 0.04;

export function updateHeat(sim) {
  const world = sim.world, reg = sim.reg;
  const { w, h, cells, temp, objMask, active, cw, ch } = world;
  const cond = reg.cond, invCap = reg.invCap;
  const amb = world.ambient;
  const nextActive = world.nextActive;

  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      if (!active[cy * cw + cx]) continue;
      const x0 = cx << CHUNK_SHIFT, y0 = cy << CHUNK_SHIFT;
      const x1 = Math.min(x0 + CHUNK, w), y1 = Math.min(y0 + CHUNK, h);
      let maxDelta = 0;
      let edgeWake = 0; // bit flags: 1 right, 2 down
      for (let y = y0; y < y1; y++) {
        let i = y * w + x0;
        for (let x = x0; x < x1; x++, i++) {
          if (objMask[i] !== 0) continue;
          const m = cells[i];
          const ci = cond[m];
          let ti = temp[i];
          // right neighbour
          if (x + 1 < w) {
            const j = i + 1;
            if (objMask[j] === 0) {
              const mj = cells[j];
              const cj = cond[mj];
              const d = (temp[j] - ti) * (ci < cj ? ci : cj) * HEAT_K;
              if (d > WAKE_EPS || d < -WAKE_EPS) {
                ti += d * invCap[m];
                temp[j] -= d * invCap[mj];
                if (d > maxDelta) maxDelta = d; else if (-d > maxDelta) maxDelta = -d;
                if (x + 1 === x1) edgeWake |= 1;
              } else if (d !== 0) {
                ti += d * invCap[m];
                temp[j] -= d * invCap[mj];
              }
            }
          }
          // down neighbour
          if (y + 1 < h) {
            const j = i + w;
            if (objMask[j] === 0) {
              const mj = cells[j];
              const cj = cond[mj];
              const d = (temp[j] - ti) * (ci < cj ? ci : cj) * HEAT_K;
              if (d > WAKE_EPS || d < -WAKE_EPS) {
                ti += d * invCap[m];
                temp[j] -= d * invCap[mj];
                if (d > maxDelta) maxDelta = d; else if (-d > maxDelta) maxDelta = -d;
                if (y + 1 === y1) edgeWake |= 2;
              } else if (d !== 0) {
                ti += d * invCap[m];
                temp[j] -= d * invCap[mj];
              }
            }
          }
          // open air drifts back to ambient (convection / radiation losses)
          if (m === 0) {
            const dd = (amb - ti) * AIR_RELAX;
            ti += dd;
            if (dd > 0.002 || dd < -0.002) { if (maxDelta < WAKE_EPS * 1.01) maxDelta = WAKE_EPS * 1.01; }
          }
          if (ti > 9000) ti = 9000; else if (ti < -273) ti = -273;
          temp[i] = ti;
        }
      }
      if (maxDelta > WAKE_EPS) {
        nextActive[cy * cw + cx] = 1;
        if (edgeWake & 1 && cx + 1 < cw) nextActive[cy * cw + cx + 1] = 1;
        if (edgeWake & 2 && cy + 1 < ch) nextActive[(cy + 1) * cw + cx] = 1;
        // Neighbours to the left / above also exchanged heat through their edges.
        if (cx > 0) nextActive[cy * cw + cx - 1] = 1;
        if (cy > 0) nextActive[(cy - 1) * cw + cx] = 1;
      }
    }
  }
}
