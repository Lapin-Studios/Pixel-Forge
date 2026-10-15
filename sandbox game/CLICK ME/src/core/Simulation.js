// Cellular simulation driver: movement, reactions, combustion, heat, electricity, pipes.
import { rng } from '../utils/MathUtils.js';
import { STATE } from '../materials/MaterialProperties.js';
import { findReaction, rollReaction } from '../materials/Reactions.js';
import { updatePowder } from '../physics/Gravity.js';
import { updateLiquid } from '../physics/LiquidPhysics.js';
import { updateGas, updateFire } from '../physics/GasPhysics.js';
import { updateHeat } from '../physics/HeatSystem.js';
import { applyPhaseChange } from '../physics/PhaseTransitions.js';
import { tryIgnite, updateBurning } from '../physics/Combustion.js';
import { updateBehavior } from '../physics/Behaviors.js';
import { Electricity } from '../machines/Electricity.js';
import { PipeNetwork } from '../machines/Pump.js';

const { SOLID, POWDER, LIQUID, GAS, FIRE } = STATE;

/** Heat Limiter range in cells. */
const LIMIT_R = 12;

export class Simulation {
  constructor(game) {
    this.game = game;
    this.reg = game.registry;
    this.world = null;
    this.tick = 0;
    this.limiters = [];
    this.mark = 1;
    this.fx = null; // particle sink (set by Game)
    this.electricity = new Electricity(this);
    this.pipes = new PipeNetwork(this);
  }

  setWorld(world) {
    this.world = world;
    this.electricity.reset();
    this.pipes.reset();
  }

  discover(m) {
    this.game.discovery?.material(m);
  }

  step() {
    const world = this.world;
    if (!world) return;
    this.tick++;
    this.limiters = []; // powered Heat Limiters register here during the cell pass
    this.mark = (this.mark % 255) + 1;
    world.beginTick();
    if (this.tick % 4 === 0) this.electricity.update();
    if (this.tick % 20 === 1) this.pipes.rebuild();
    this.updateCells();
    updateHeat(this);
    this.game.objects.step(this);
    if (this.limiters.length) this.applyLimiters();
  }

  /** Every powered Heat Limiter caps temperatures within LIMIT_R cells (cells, objects, ragdolls). */
  applyLimiters() {
    const world = this.world, w = world.w, h = world.h;
    const objs = this.game.objects;
    const R = LIMIT_R;
    for (const i of this.limiters) {
      if (world.cells[i] !== this.reg.HEAT_LIMITER) continue;
      const lim = world.life[i];
      const x = i % w, y = (i / w) | 0;
      const y0 = Math.max(0, y - R), y1 = Math.min(h - 1, y + R);
      const x0 = Math.max(0, x - R), x1 = Math.min(w - 1, x + R);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const j = yy * w + xx;
          if (world.temp[j] > lim) world.temp[j] = lim;
          const om = world.objMask[j];
          if (om !== 0) {
            const o = objs.byId.get(om < 0 ? -om : om);
            if (o) { const li = world.objLocal[j]; if (o.temp[li] > lim) o.temp[li] = lim; }
          }
        }
      }
      for (const d of objs.dolls) {
        if (d.temp > lim && Math.abs(d.x[3] - x) <= R + 6 && Math.abs(d.y[3] - y) <= R + 12) { d.temp = lim; if (lim < 220) d.onFire = 0; }
      }
    }
  }


  updateCells() {
    const world = this.world;
    const { w, h, cells, stamp } = world;
    const active = world.active;
    const cw = world.cw;
    const mark = this.mark;
    for (let y = h - 1; y >= 0; y--) {
      const rowBase = (y >> 4) * cw;
      const ltr = rng() < 0.5;
      for (let c = 0; c < cw; c++) {
        const cx = ltr ? c : cw - 1 - c;
        if (!active[rowBase + cx]) continue;
        const x0 = cx << 4;
        const x1 = Math.min(x0 + 16, w);
        const base = y * w;
        if (ltr) {
          for (let x = x0; x < x1; x++) {
            const i = base + x;
            const m = cells[i];
            if (m !== 0 && stamp[i] !== mark) this.updateCell(i, x, y, m);
          }
        } else {
          for (let x = x1 - 1; x >= x0; x--) {
            const i = base + x;
            const m = cells[i];
            if (m !== 0 && stamp[i] !== mark) this.updateCell(i, x, y, m);
          }
        }
      }
    }
  }

  updateCell(i, x, y, m) {
    const reg = this.reg, world = this.world;
    if (world.burn[i] !== 0) {
      if (updateBurning(this, i, x, y, m)) return;
      m = world.cells[i];
      if (m === 0) return;
    }
    const t = world.temp[i];
    // Burning cells finish burning before any other heat-driven change (no pyrolysis mid-fire).
    if (world.burn[i] === 0 && (t >= reg.hotT[m] || t <= reg.coldT[m]) && applyPhaseChange(this, i, x, y, m, t)) return;
    if (reg.flammable[m] !== 0 && world.burn[i] === 0 && t >= reg.igniteT[m]) {
      tryIgnite(this, i, x, y, m);
      if (world.cells[i] !== m) return;
    }
    if (reg.hasReaction[m] && this.tryReactions(i, x, y, m)) return;
    const b = reg.behavior[m];
    if (b !== 0 && updateBehavior(this, i, x, y, m, b)) return;
    switch (reg.state[m]) {
      case POWDER: updatePowder(this, i, x, y, m); break;
      case LIQUID: updateLiquid(this, i, x, y, m); break;
      case GAS: updateGas(this, i, x, y, m); break;
      case FIRE: updateFire(this, i, x, y, m); break;
      default: break;
    }
  }

  tryReactions(i, x, y, m) {
    const world = this.world, reg = this.reg;
    const w = world.w, h = world.h;
    const k = (rng() * 4) | 0;
    let j;
    if (k === 0) { if (y === 0) return false; j = i - w; }
    else if (k === 1) { if (y === h - 1) return false; j = i + w; }
    else if (k === 2) { if (x === 0) return false; j = i - 1; }
    else { if (x === w - 1) return false; j = i + 1; }
    if (world.objMask[j] !== 0) return false;
    const mj = world.cells[j];
    if (mj === 0) return false;
    const ti = world.temp[i], tj = world.temp[j];
    const r = findReaction(reg, m, mj, ti > tj ? ti : tj);
    if (!r) return false;
    world.wake(i);
    if (!rollReaction(r)) return false;
    this.applyReaction(r, i, j);
    return r.outSelf >= 0;
  }

  applyReaction(r, i, j) {
    const world = this.world, reg = this.reg;
    const heat = r.heat;
    if (r.outSelf >= 0) {
      if (r.outSelf === 0) world.clearCell(i);
      else world.transform(i, r.outSelf, reg.stabilize(r.outSelf, world.temp[i] + heat));
      this.discover(r.outSelf);
    } else if (heat) world.temp[i] += heat;
    if (r.outOther >= 0) {
      if (r.outOther === 0) world.clearCell(j);
      else world.transform(j, r.outOther, reg.stabilize(r.outOther, world.temp[j] + heat));
      this.discover(r.outOther);
    } else if (heat) world.temp[j] += heat;
    world.stamp[j] = this.mark;
    this.game.discovery?.reaction(r.def.id);
    if (r.fx && this.fx) {
      const w = world.w;
      const x = i % w, y = (i / w) | 0;
      if (r.fx === 'steam') { this.fx.steam(x, y, 1); this.game.audio?.playAt('sizzle', x, y, 0.4); }
      else if (r.fx === 'fizz') { this.fx.fizz(x, y); this.game.audio?.playAt('fizz', x, y, 0.8); }
    }
  }

  // ---------------------------------------------------------------- movement primitives
  // Return codes: 0 = blocked, 1 = moved, 2 = absorbed into an object's cavity.

  move(i, j) {
    this.world.swap(i, j);
    this.world.stamp[j] = this.mark;
    this.world.stamp[i] = this.mark;
  }

  tryMoveDown(i, j, m) {
    const world = this.world;
    const om = world.objMask[j];
    if (om !== 0) return om < 0 ? this.game.objects.absorbFromWorld(j, i) : 0;
    const mj = world.cells[j];
    if (mj === 0) { this.move(i, j); return 1; }
    const reg = this.reg;
    const sj = reg.state[mj];
    if (sj >= LIQUID && reg.density[m] > reg.density[mj]) {
      if (sj === LIQUID && reg.state[m] === POWDER && rng() < 0.45) return 0; // drag while sinking
      if (sj === LIQUID && reg.state[m] !== LIQUID && rng() < 0.02) {
        const w = world.w;
        this.game.audio?.playAt('splash', j % w, (j / w) | 0, 0.5);
      }
      this.move(i, j);
      return 1;
    }
    return 0;
  }

  tryMoveDiag(i, j, side, m) {
    const world = this.world;
    // Don't squeeze through diagonal gaps between solids / object walls.
    if (world.objMask[side] > 0) return 0;
    const ms = world.cells[side];
    if (ms !== 0 && this.reg.state[ms] === SOLID) return 0;
    return this.tryMoveDown(i, j, m);
  }

  tryMoveSide(i, j, m) {
    const world = this.world;
    const om = world.objMask[j];
    if (om !== 0) return om < 0 ? this.game.objects.absorbFromWorld(j, i) : 0;
    const mj = world.cells[j];
    if (mj === 0) { this.move(i, j); return 1; }
    const sj = this.reg.state[mj];
    if (sj === GAS || sj === FIRE) { this.move(i, j); return 1; }
    return 0;
  }

  tryMoveGas(i, j, m, rising) {
    const world = this.world;
    if (world.objMask[j] !== 0) return 0;
    const mj = world.cells[j];
    if (mj === 0) { this.move(i, j); return 1; }
    const reg = this.reg;
    const sj = reg.state[mj];
    if (sj < LIQUID) return 0;
    if (rising ? reg.density[mj] > reg.density[m] : reg.density[mj] < reg.density[m]) {
      if (sj === LIQUID && rng() < 0.5) return 0;
      this.move(i, j);
      return 1;
    }
    return 0;
  }
}
