// Owns every world object: stamping into the cell grid, physics, contents exchange, persistence.
import { rng } from '../utils/MathUtils.js';
import { STATE } from '../materials/MaterialProperties.js';
import { MASK, isCavityKind } from './WorldObject.js';
import { integrate, conductObject, collides } from '../physics/ObjectPhysics.js';
import { createObject, deserializeObject } from './ObjectFactory.js';
import { Ragdoll } from './Ragdoll.js';
import { RopeSystem } from './Ropes.js';

export class ObjectManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.byId = new Map();
    this.nextId = 1;
    this.dolls = []; // ragdoll humans (verlet bodies, not stamped into the grid)
    this.ropes = new RopeSystem(this); // pins and ropes
    this.ctx = { game, world: null, reg: game.registry, objects: this, sim: null, fx: null, tick: 0 };
  }

  get world() { return this.game.world; }

  syncCtx() {
    const c = this.ctx;
    c.world = this.game.world;
    c.sim = this.game.sim;
    c.fx = this.game.particles;
    return c;
  }

  reset() {
    for (const o of this.list) this.unstamp(o);
    this.list = [];
    this.byId.clear();
    this.nextId = 1;
    this.dolls = [];
    this.ropes?.reset();
    if (this.game.tools) this.game.tools.heldDoll = null;
  }

  // ------------------------------------------------------------------ ragdolls

  /** Place a ragdoll human with its middle near (wx, wy), moving it up until it fits. */
  spawnDoll(wx, wy) {
    const world = this.world;
    for (const dx of [0, -6, 6, -12, 12]) {
      for (let up = 0; up <= 80; up++) {
        const doll = new Ragdoll(this.game, Math.max(6, Math.min(world.w - 6, wx + dx)), wy + 5 - up);
        let free = true;
        for (let k = 0; k < 12 && free; k++) if (doll.blocked(doll.x[k], doll.y[k], 1)) free = false;
        if (free) { this.dolls.push(doll); return doll; }
      }
    }
    return null;
  }

  removeDoll(d) {
    d.dead = true;
    const i = this.dolls.indexOf(d);
    if (i >= 0) this.dolls.splice(i, 1);
    this.game.tools?.onObjectRemoved(d);
  }

  /** Topmost ragdoll body part under (wx, wy): { doll, k } or null. */
  dollAt(wx, wy, maxD = 2) {
    for (let j = this.dolls.length - 1; j >= 0; j--) {
      const d = this.dolls[j];
      const k = d.pointNear(wx, wy, maxD);
      if (k >= 0) return { doll: d, k };
    }
    return null;
  }

  add(o) {
    if (o.id && this.byId.get(o.id) === o) {
      // Already managed: just re-stamp at its (possibly new) position.
      o.dirtyStamp = true;
      this.restamp(o);
      return o;
    }
    o.id = this.nextId++;
    o.dead = false;
    this.list.push(o);
    this.byId.set(o.id, o);
    o.dirtyStamp = true;
    this.syncCtx();
    this.restamp(o);
    return o;
  }

  remove(o) {
    this.unstamp(o);
    o.dead = true;
    const idx = this.list.indexOf(o);
    if (idx >= 0) this.list.splice(idx, 1);
    this.byId.delete(o.id);
    this.game.tools?.onObjectRemoved(o);
  }

  // ------------------------------------------------------------------ stamping

  unstamp(o) {
    const world = this.world;
    if (!world) return;
    const { objMask } = world;
    for (let s = 0; s < o.stampedCount; s++) {
      const i = o.stamped[s];
      if (objMask[i] === o.id || objMask[i] === -o.id) {
        objMask[i] = 0;
        world.wake(i);
      }
    }
    o.stampedCount = 0;
  }

  restamp(o) {
    this.unstamp(o);
    const world = this.world;
    const fp = o.getFootprint();
    const ox = o.ox, oy = o.oy;
    const W = world.w, H = world.h;
    const { objMask, objLocal, cells } = world;
    if (o.stamped.length < fp.count) o.stamped = new Int32Array(fp.count + 16);
    let c = 0;
    for (let k = 0; k < fp.count; k++) {
      const wx = ox + fp.offs[2 * k], wy = oy + fp.offs[2 * k + 1];
      if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
      const i = wy * W + wx;
      if (objMask[i] !== 0) continue;
      const kind = fp.kinds[k];
      const li = fp.loc[k];
      objMask[i] = kind === MASK.WALL ? o.id : -o.id;
      objLocal[i] = li;
      o.stamped[c++] = i;
      if (cells[i] !== 0) this.handleOverlap(o, i, li, kind);
      world.wake(i);
    }
    o.stampedCount = c;
    o.dirtyStamp = false;
  }

  /** A world cell ended up under an object: absorb it into the cavity or push it aside. */
  handleOverlap(o, i, li, kind) {
    const world = this.world, reg = this.game.registry;
    const m = world.cells[i];
    if (reg.indestructible[m]) return;
    if (isCavityKind(kind) && o.acceptContent(li, m)) {
      o.mat[li] = m;
      o.temp[li] = world.temp[i];
      o.life[li] = world.life[i];
      world.clearCell(i);
      return;
    }
    const s = reg.state[m];
    if (s === STATE.GAS || s === STATE.FIRE) { world.clearCell(i); return; }
    const W = world.w;
    const x = i % W, y = (i / W) | 0;
    const j = world.findFreeNear(x, y, 10);
    if (j >= 0) {
      world.cells[j] = m;
      world.temp[j] = world.temp[i];
      world.life[j] = world.life[i];
      world.burn[j] = world.burn[i];
      world.shade[j] = world.shade[i];
      world.wake(j);
    }
    world.clearCell(i);
  }

  // ------------------------------------------------------------------ simulation

  step(sim) {
    const ctx = this.syncCtx();
    ctx.tick = sim.tick;
    const list = this.list;
    for (let k = 0; k < list.length; k++) {
      const o = list[k];
      if (o.dead) continue;
      if (!o.held && !o.anchored) integrate(o, ctx);
      if (!o.dead && o.dirtyStamp) this.restamp(o);
    }
    let anyDead = false;
    for (let k = 0; k < list.length; k++) {
      const o = list[k];
      if (o.dead) { anyDead = true; continue; }
      conductObject(o, ctx);
      o.update(ctx);
      if (o.dead) anyDead = true;
      else if (o.dirtyStamp) this.restamp(o);
    }
    if (anyDead) {
      for (const o of [...list]) if (o.dead) this.remove(o);
    }
    // Moving objects are checked every tick (so they can't fall straight through), resting ones now and then.
    for (const o of [...list]) if (!o.dead && !o.held && ((sim.tick & 7) === 0 || Math.abs(o.vy) > 0.2 || Math.abs(o.vx) > 0.2)) this.touchSpecial(o);
    for (const d of this.dolls) d.step(ctx);
    for (const d of [...this.dolls]) if (d.dead) this.removeDoll(d);
    this.ropes.step();
  }

  /** Objects touching a Void vanish; objects touching a Cloner get copied (with a cooldown). */
  touchSpecial(o) {
    const world = this.world, reg = this.game.registry;
    const W = world.w, H = world.h;
    const fp = o.getFootprint();
    const ox = o.ox, oy = o.oy;
    let hit = 0;
    for (let k = 0; k < fp.count && !hit; k++) {
      const wx = ox + fp.offs[2 * k], wy = oy + fp.offs[2 * k + 1];
      for (const [dx, dy] of [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]]) {
        const x = wx + dx, y = wy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const m = world.cells[y * W + x];
        if (m === reg.VOID) { hit = 1; break; }
        if (m === reg.CLONER) hit = 2;
      }
    }
    if (hit === 1) {
      const b = o.bounds();
      this.game.particles?.dust((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 8, (b.x1 - b.x0) / 3);
      this.game.audio?.playAt('delete', (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
      this.remove(o);
    } else if (hit === 2) this.cloneObject(o);
  }

  cloneObject(o) {
    const tick = this.game.sim.tick;
    if ((o.cloneAt || 0) > tick || this.list.length >= 200) return;
    o.cloneAt = tick + 90;
    const copy = deserializeObject(this.game, JSON.parse(JSON.stringify(o.serialize())));
    if (!copy) return;
    const b = o.bounds();
    const placed = this.spawn(copy, (b.x0 + b.x1) / 2, b.y0 - (b.y1 - b.y0) / 2 - 3);
    if (placed) {
      placed.cloneAt = tick + 90;
      placed.vx = 0; placed.vy = 0;
      this.game.particles?.sparkle((b.x0 + b.x1) / 2, b.y0);
      this.game.audio?.play('chime', 0.4);
    }
  }

  cloneDoll(d) {
    const tick = this.game.sim.tick;
    if ((d.cloneAt || 0) > tick || this.dolls.length >= 40) return;
    d.cloneAt = tick + 90;
    const copy = Ragdoll.deserialize(this.game, JSON.parse(JSON.stringify(d.serialize())));
    if (!copy) return;
    const b = d.bounds();
    const lift = b.y1 - b.y0 + 4;
    for (let k = 0; k < copy.x.length; k++) { copy.y[k] -= lift; copy.py[k] = copy.fy[k] = copy.y[k]; copy.px[k] = copy.fx[k] = copy.x[k]; }
    for (let k = 0; k < copy.x.length; k++) if (copy.blocked(copy.x[k], copy.y[k], 1)) return;
    copy.cloneAt = tick + 90;
    this.dolls.push(copy);
    this.game.particles?.sparkle((b.x0 + b.x1) / 2, b.y0);
    this.game.audio?.play('chime', 0.4);
  }

  /** World cell i moves into cavity cell j of an object. Returns 2 if absorbed, else 0. */
  absorbFromWorld(j, i) {
    const world = this.world;
    const om = world.objMask[j];
    const o = this.byId.get(-om);
    if (!o) return 0;
    const li = world.objLocal[j];
    const m = world.cells[i];
    if (!o.acceptContent(li, m)) return 0;
    o.mat[li] = m;
    o.temp[li] = world.temp[i];
    o.life[li] = world.life[i];
    world.clearCell(i);
    return 2;
  }

  /**
   * Content leaving object o at local (lx, ly) enters the world (or another container).
   * Returns 1 if emitted, 2 if it moved inside o itself (aliasing), 0 if blocked.
   */
  emitFromObject(o, lx, ly, m, t, life = 0, srcLi = -1, dx = 0, dy = 0) {
    const world = this.world, reg = this.game.registry;
    // A rotated rim can alias onto the object's own wall pixels, so probe a little further
    // along the direction of travel before giving up.
    let i = -1, om = 0, wx = 0, wy = 0;
    for (let probe = 0; probe < 3; probe++) {
      const s = probe * 0.6;
      const [fx, fy] = o.localToWorld(lx + 0.5 + dx * s, ly + 0.5 + dy * s);
      wx = Math.floor(fx); wy = Math.floor(fy);
      if (wx < 0 || wy < 0 || wx >= world.w || wy >= world.h) return 0;
      i = wy * world.w + wx;
      om = world.objMask[i];
      if (om !== o.id) break;
      if (!dx && !dy) return 0;
    }
    if (om === o.id) return 0;
    if (om !== 0) {
      const oid = om < 0 ? -om : om;
      if (oid === o.id) {
        if (srcLi >= 0) {
          const li2 = world.objLocal[i];
          if (li2 !== srcLi && o.mat[li2] === 0 && isCavityKind(o.mask[li2]) && o.swapLocal) {
            o.swapLocal(srcLi, li2);
            return 2;
          }
        }
        return 0;
      }
      if (om > 0) return 0;
      const other = this.byId.get(oid);
      if (!other) return 0;
      const li2 = world.objLocal[i];
      if (other.acceptContent(li2, m)) {
        other.mat[li2] = m;
        other.temp[li2] = t;
        other.life[li2] = life;
        return 1;
      }
      return 0;
    }
    const cm = world.cells[i];
    if (cm !== 0) {
      const s = reg.state[cm];
      if (s !== STATE.GAS && s !== STATE.FIRE) return 0;
    }
    world.setCell(i, m, t);
    world.life[i] = life;
    if (t > 700 && rng() < 0.08) this.game.particles?.sparks(wx + 0.5, wy + 0.5, 1, t);
    return 1;
  }

  /** Item overlapping a container cavity: drop its pixels in as loose cells. */
  tryDepositAt(item, x, y) {
    const world = this.world;
    const fp = item.getFootprint();
    const W = world.w, H = world.h;
    const counts = new Map();
    for (let k = 0; k < fp.count; k++) {
      const wx = x + fp.offs[2 * k], wy = y + fp.offs[2 * k + 1];
      if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
      const om = world.objMask[wx + wy * W];
      if (om < 0 && om !== -item.id) counts.set(-om, (counts.get(-om) || 0) + 1);
    }
    if (!counts.size) return 'none';
    let best = null, bc = 0;
    for (const [id, c] of counts) if (c > bc) { bc = c; best = this.byId.get(id); }
    if (!best || !best.isContainer || !best.acceptsItems) return 'blocked';
    const pixels = [];
    for (let li = 0; li < item.mask.length; li++) if (item.mask[li] === MASK.WALL) pixels.push(li);
    if (best.freeCount() < pixels.length) return 'blocked';
    for (const m of new Set(pixels.map((li) => item.mat[li]))) if (!best.accepts(m)) return 'blocked';
    // Map each pixel to the nearest free cavity cell of the container.
    pixels.sort((a, b) => ((b / item.w) | 0) - ((a / item.w) | 0));
    for (const li of pixels) {
      const [fx, fy] = item.localToWorld((li % item.w) + 0.5, ((li / item.w) | 0) + 0.5);
      const [cx, cy] = best.worldToLocal(fx + (x - item.ox), fy + (y - item.oy));
      const lx = Math.floor(cx), ly = Math.floor(cy);
      const start = lx >= 0 && ly >= 0 && lx < best.w && ly < best.h ? ly * best.w + lx : -1;
      let target = best.findFreeCavity(start >= 0 && isCavityKind(best.mask[start]) ? start : -1);
      if (target < 0) target = best.findFreeCavity(-1);
      if (target < 0) break;
      best.mat[target] = item.mat[li];
      best.temp[target] = item.temp[li];
    }
    this.game.audio?.play('clink', 0.6);
    this.game.toast?.(`${item.name} dropped into the ${best.name.toLowerCase()}`);
    this.remove(item);
    return 'deposited';
  }

  /** Convert an item's pixels back into world cells. */
  fuseItem(item) {
    const world = this.world;
    const fp = item.getFootprint();
    const ox = item.ox, oy = item.oy, W = world.w, H = world.h;
    this.unstamp(item);
    const placed = [];
    for (let k = 0; k < fp.count; k++) {
      const wx = ox + fp.offs[2 * k], wy = oy + fp.offs[2 * k + 1];
      if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
      const i = wy * W + wx;
      if (world.objMask[i] !== 0) continue;
      const cm = world.cells[i];
      if (cm !== 0 && this.game.registry.state[cm] <= STATE.POWDER) continue;
      const li = fp.loc[k];
      world.setCell(i, item.mat[li], item.temp[li]);
      placed.push(i);
    }
    this.game.history?.markDirty();
    this.remove(item);
    this.game.toast?.(`Placed ${placed.length} cells into the world`);
  }

  applyImpulse(cx, cy, radius, power) {
    for (const o of this.list) {
      if (o.held || o.anchored) continue;
      const b = o.bounds();
      const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
      const dx = mx - cx, dy = my - cy;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const f = (1 - d / radius) * power * (o.heavy ? 0.3 : 1);
      o.vx += (dx / (d || 1)) * f;
      o.vy += (dy / (d || 1)) * f - f * 0.6;
    }
    for (const d of this.dolls) d.impulse(cx, cy, radius, power);
  }

  /** Topmost object at a world cell (held first, then by stamp, then loose bbox hit). */
  objectAt(wx, wy, slack = 0) {
    const world = this.world;
    if (!world) return null;
    const x = Math.floor(wx), y = Math.floor(wy);
    for (let k = this.list.length - 1; k >= 0; k--) {
      const o = this.list[k];
      if (o.held && this.footprintHit(o, x, y, slack)) return o;
    }
    if (x >= 0 && y >= 0 && x < world.w && y < world.h) {
      const om = world.objMask[y * world.w + x];
      if (om !== 0) return this.byId.get(Math.abs(om)) || null;
    }
    if (slack > 0) {
      for (let k = this.list.length - 1; k >= 0; k--) {
        const o = this.list[k];
        if (this.footprintHit(o, x, y, slack)) return o;
      }
    }
    return null;
  }

  footprintHit(o, x, y, slack) {
    const b = o.bounds();
    if (x < b.x0 - slack || x > b.x1 + slack || y < b.y0 - slack || y > b.y1 + slack) return false;
    const fp = o.getFootprint();
    const ox = o.ox, oy = o.oy;
    for (let k = 0; k < fp.count; k++) {
      const dx = ox + fp.offs[2 * k] - x, dy = oy + fp.offs[2 * k + 1] - y;
      if (dx >= -slack && dx <= slack && dy >= -slack && dy <= slack) return true;
    }
    return false;
  }

  /** Is there room for object o with its origin at (x, y)? */
  fits(o, x, y) {
    return !collides(o, x, y, this.syncCtx());
  }

  /** Create an object of `type` centred near (wx, wy); finds free space above if blocked. */
  spawn(type, wx, wy, opts = {}) {
    const o = typeof type === 'string' ? createObject(this.game, type) : type;
    const fp = o.getFootprint();
    // Position so that the object's visual centre is at (wx, wy).
    const cx = (fp.minX + fp.maxX) / 2, cy = (fp.minY + fp.maxY) / 2;
    let x = Math.round(wx - cx), y = Math.round(wy - cy);
    if (opts.bottom !== undefined) y = Math.round(opts.bottom - fp.maxY);
    const placeable = this.findFreeSpot(o, x, y, opts.searchUp ?? 80);
    if (!placeable) return null;
    o.x = placeable[0];
    o.y = placeable[1];
    return this.add(o);
  }

  findFreeSpot(o, x, y, maxUp = 80) {
    const world = this.world;
    const fp = o.getFootprint();
    x = Math.max(-fp.minX, Math.min(world.w - 1 - fp.maxX, x));
    o.id = o.id || -999999; // temporary id so self-checks work before add()
    for (let up = 0; up <= maxUp; up++) {
      if (this.fits(o, x, y - up)) { if (o.id === -999999) o.id = 0; return [x, y - up]; }
    }
    for (const dx of [-8, 8, -16, 16, -24, 24]) {
      if (this.fits(o, x + dx, y)) { if (o.id === -999999) o.id = 0; return [x + dx, y]; }
    }
    if (o.id === -999999) o.id = 0;
    return null;
  }

  serialize() {
    const objs = this.list.filter((o) => !o.dead);
    return [...objs.map((o) => o.serialize()), ...this.dolls.map((d) => d.serialize()), ...this.ropes.serialize(objs, this.dolls)];
  }

  load(list) {
    this.reset();
    let failed = 0;
    if (!Array.isArray(list)) return 0;
    const objs = [], dolls = [], ropes = [];
    for (const data of list) {
      try {
        if (data && data.type === 'ragdoll') {
          const d = Ragdoll.deserialize(this.game, data);
          dolls.push(d);
          if (d) this.dolls.push(d); else failed++;
          continue;
        }
        if (data && data.type === 'pin') {
          if (Number.isFinite(data.x) && Number.isFinite(data.y)) this.ropes.addPin(data.x, data.y);
          continue;
        }
        if (data && data.type === 'rope') { ropes.push(data); continue; }
        const o = deserializeObject(this.game, data);
        objs.push(o);
        if (o) this.add(o);
        else failed++;
      } catch (e) {
        console.warn('Failed to restore object', e);
        objs.push(null);
        failed++;
      }
    }
    for (const r of ropes) if (!this.ropes.loadRope(r, objs, dolls)) failed++;
    return failed;
  }
}
