// Rigid-object physics: gravity, collision against the cell world and other objects, conveyors,
// and heat exchange between an object's local cells and everything it touches.
import { STATE } from '../materials/MaterialProperties.js';
import { MASK } from '../objects/WorldObject.js';
import { HEAT_K } from './HeatSystem.js';
import { conveyorDir } from '../machines/Conveyor.js';

export const GRAVITY = 0.12;
export const MAX_FALL = 3;
const AIR_FILM = 0.0012;

/**
 * Would object o overlap something solid with its origin at (ox, oy)?
 * Powders block resting objects but are pushed aside by held ones; liquids and gases are displaced.
 * allowCavity lets items enter other containers' cavities (they get deposited).
 */
export function collides(o, ox, oy, ctx, allowCavity = false) {
  const world = ctx.world;
  const W = world.w, H = world.h;
  const cells = world.cells, objMask = world.objMask, state = ctx.reg.state;
  const fp = o.getFootprint();
  const offs = fp.offs, kinds = fp.kinds, n = fp.count;
  const id = o.id, held = o.held;
  for (let k = 0; k < n; k++) {
    const wx = ox + offs[2 * k], wy = oy + offs[2 * k + 1];
    if (wx < 0 || wx >= W || wy >= H) return true;
    if (wy < 0) continue;
    const i = wy * W + wx;
    const om = objMask[i];
    if (om !== 0 && om !== id && om !== -id) {
      if (om < 0 && allowCavity) continue;
      return true;
    }
    const m = cells[i];
    if (m !== 0) {
      const s = state[m];
      if (s === STATE.SOLID) {
        if (m === ctx.reg.CLONER || m === ctx.reg.VOID) continue; // no collision: things fall into them
        return true;
      }
      if (s === STATE.POWDER && !held && kinds[k] === MASK.WALL) return true;
    }
  }
  return false;
}

function canOccupy(o, x, y, ctx) {
  if (collides(o, x, y, ctx, o.isItem)) return 0;
  if (o.isItem && !o.held) {
    const r = ctx.objects.tryDepositAt(o, x, y);
    if (r === 'deposited') return 2;
    if (r === 'blocked') return 0;
  }
  return 1;
}

/**
 * Buoyancy: how much of the object sits below a liquid surface (rows with liquid right beside them),
 * weighed against the object's own density (empty cavities count as air). Returns the upward
 * acceleration, or 0 when it isn't in liquid. Wood, carved wooden items and hollow light things float.
 */
function buoyancy(o, ctx) {
  const world = ctx.world, reg = ctx.reg;
  const W = world.w, H = world.h;
  const { cells, objMask } = world;
  const state = reg.state, density = reg.density;
  const fp = o.getFootprint();
  const ox = o.ox, oy = o.oy;
  let minY = Infinity, maxY = -Infinity;
  const rowMin = o._rowMin || (o._rowMin = new Map()), rowMax = o._rowMax || (o._rowMax = new Map());
  rowMin.clear(); rowMax.clear();
  let mass = 0, vol = 0;
  for (let k = 0; k < fp.count; k++) {
    const wx = ox + fp.offs[2 * k], wy = oy + fp.offs[2 * k + 1];
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
    const a = rowMin.get(wy);
    if (a === undefined || wx < a) rowMin.set(wy, wx);
    const b = rowMax.get(wy);
    if (b === undefined || wx > b) rowMax.set(wy, wx);
    const li = fp.loc[k], m = o.mat[li];
    vol++;
    if (m) mass += density[m];
  }
  if (!vol) return 0;
  const liquidAt = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    const i = y * W + x;
    if (objMask[i] !== 0) return 0;
    const m = cells[i];
    return m !== 0 && state[m] === STATE.LIQUID ? density[m] : 0;
  };
  let wetRows = 0, rows = 0, liq = 0;
  for (let y = minY; y <= maxY; y++) {
    if (!rowMin.has(y)) continue;
    rows++;
    const d = Math.max(liquidAt(rowMin.get(y) - 1, y), liquidAt(rowMax.get(y) + 1, y));
    if (d) { wetRows++; liq = Math.max(liq, d); }
  }
  if (!wetRows) {
    // Sitting on the surface: liquid directly under the bottom row gives a little lift.
    const d = liquidAt(rowMin.get(maxY), maxY + 1) || liquidAt(rowMax.get(maxY), maxY + 1);
    if (!d) return 0;
    wetRows = 0.35; liq = d;
  }
  const own = Math.max(1, mass / vol);
  return Math.min(GRAVITY * 3, GRAVITY * (wetRows / Math.max(1, rows)) * (liq / own));
}

export function integrate(o, ctx) {
  const fp = o.getFootprint();
  if (fp.count === 0) return;
  let ox = o.ox, oy = o.oy;
  let moved = false;

  const lift = buoyancy(o, ctx);
  o.inLiquid = lift > 0;
  o.vy = Math.min(o.vy + GRAVITY - lift, MAX_FALL);
  if (lift > 0) { o.vy *= 0.9; o.vx *= 0.96; }
  const ny = o.y + o.vy;
  const tY = Math.round(ny);
  if (tY !== oy) {
    const s = tY > oy ? 1 : -1;
    let blocked = false;
    while (oy !== tY) {
      const r = canOccupy(o, ox, oy + s, ctx);
      if (r === 2) return;
      if (r === 0) { blocked = true; break; }
      oy += s;
      moved = true;
    }
    if (blocked) {
      if (s > 0 && o.vy > 1.1) impact(o, ctx, o.vy);
      o.y = oy;
      o.vy = 0;
    } else o.y = ny;
  } else o.y = ny;

  if (o.vx > 0.02 || o.vx < -0.02) {
    const nx = o.x + o.vx;
    const tX = Math.round(nx);
    if (tX !== ox) {
      const s = tX > ox ? 1 : -1;
      let blocked = false;
      while (ox !== tX) {
        let r = canOccupy(o, ox + s, oy, ctx);
        if (r === 2) return;
        if (r === 0) {
          // Step up small ledges (1 cell) when sliding.
          r = canOccupy(o, ox + s, oy - 1, ctx);
          if (r === 2) return;
          if (r === 0) { blocked = true; break; }
          oy -= 1;
          o.y = oy;
        }
        ox += s;
        moved = true;
      }
      if (blocked) { o.x = ox; o.vx = 0; } else o.x = nx;
    } else o.x = nx;
  }

  const resting = collides(o, o.ox, o.oy + 1, ctx);
  o.resting = resting;
  if (resting) {
    const cdir = conveyorUnder(o, ctx);
    if (cdir) o.vx = cdir * 0.3;
    else o.vx *= 0.7;
    if (tip(o, ctx)) moved = true;
  } else {
    o.vx *= 0.995;
    if (tumble(o, ctx)) moved = true;
  }
  if (moved) o.dirtyStamp = true;
}

const HALF_PI = Math.PI / 2;

/** Convex hull (local coords, flat [x0,y0,x1,y1,...]) of the body cells' corners; cached per mask. */
function getHull(o) {
  if (o._hull && o._hullV === o.maskVersion) return o._hull;
  const seen = new Set();
  const pts = [];
  const { w, mask } = o;
  for (let li = 0; li < mask.length; li++) {
    if (mask[li] !== MASK.WALL) continue;
    const x = li % w, y = (li / w) | 0;
    for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
      const key = cx * 4096 + cy;
      if (!seen.has(key)) { seen.add(key); pts.push([cx, cy]); }
    }
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o2, a, b) => (a[0] - o2[0]) * (b[1] - o2[1]) - (a[1] - o2[1]) * (b[0] - o2[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  o._hull = hull.flat();
  o._hullV = o.maskVersion;
  return o._hull;
}

/**
 * Rotate o by dA around the world point (px, py), keeping that point fixed (the contact edge).
 * Lifts by a cell if rounding pushes it into the ground. Returns false (and reverts) if blocked.
 */
function rotateAbout(o, dA, px, py, ctx) {
  const prevA = o.angle, prevX = o.x, prevY = o.y;
  const [lx, ly] = o.worldToLocal(px, py);
  o.angle += dA;
  const [qx, qy] = o.localToWorld(lx, ly);
  o.x += px - qx;
  o.y += py - qy;
  for (const lift of [0, -1, -2, -3]) {
    if (!collides(o, o.ox, o.oy + lift, ctx, o.isItem)) {
      o.y += lift;
      return true;
    }
  }
  o.angle = prevA; o.x = prevX; o.y = prevY;
  return false;
}

/** Snap a nearly-flat resting object exactly onto the grid angle q (keeps its footprint crisp). */
function squareUp(o, q, ctx) {
  const prevA = o.angle, prevX = o.x, prevY = o.y;
  const b = o.bounds();
  const cx = (b.x0 + b.x1 + 1) / 2, by = b.y1 + 1;
  o.angle = q;
  const nb = o.bounds();
  o.x += cx - (nb.x0 + nb.x1 + 1) / 2;
  o.y += by - (nb.y1 + 1);
  for (const lift of [0, -1, -2, -3, -4]) {
    for (const shift of [0, -1, 1]) {
      if (!collides(o, o.ox + shift, o.oy + lift, ctx, o.isItem)) {
        o.x += shift;
        o.y += lift;
        return true;
      }
    }
  }
  o.angle = prevA; o.x = prevX; o.y = prevY;
  return false;
}

/**
 * Gravity torque for a resting object: find where it touches the ground, compare with its centre
 * of mass, and tip it over the supporting edge until it lies stably (then snap square to the grid).
 */
function tip(o, ctx) {
  const world = ctx.world, reg = ctx.reg;
  const W = world.w, H = world.h;
  const { cells, objMask } = world;
  const state = reg.state;
  const fp = o.getFootprint();
  const ox = o.ox, oy = o.oy, id = o.id;
  const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
  const ow = o.w, opx = o.px, opy = o.py;
  // Continuous local -> world (same transform as localToWorld, inlined for speed).
  const tx = (lx, ly) => ox + ca * (lx - opx) - sa * (ly - opy);
  const ty = (lx, ly) => oy + sa * (lx - opx) + ca * (ly - opy);

  // Centre of mass over body + contents, and contact cells (body cells sitting on something).
  let comX = 0, mass = 0;
  const contacts = [];
  for (let k = 0; k < fp.count; k++) {
    const kind = fp.kinds[k], li = fp.loc[k];
    const lx = li % ow, ly = (li / ow) | 0;
    if (kind === MASK.WALL || o.mat[li] !== 0) { comX += tx(lx + 0.5, ly + 0.5); mass++; }
    if (kind !== MASK.WALL) continue;
    const wx = ox + fp.offs[2 * k], by = oy + fp.offs[2 * k + 1] + 1;
    let contact = false;
    if (by >= H) contact = true;
    else if (wx >= 0 && wx < W && by >= 0) {
      const i = by * W + wx;
      const om = objMask[i];
      if (om === id || om === -id) continue;
      if (om !== 0) contact = true;
      else {
        const m = cells[i];
        if (m !== 0 && (state[m] === STATE.SOLID || state[m] === STATE.POWDER) && m !== reg.CLONER && m !== reg.VOID) contact = true;
      }
    }
    if (contact) contacts.push(lx, ly, wx);
  }
  if (!mass || !contacts.length) return false;
  comX /= mass;

  // Where it touches: x-range of the contact cells, and the lowest contact corner.
  let cMin = Infinity, cMax = -Infinity, maxY = -Infinity;
  const pts = [];
  for (let c = 0; c < contacts.length; c += 3) {
    const lx = contacts[c], ly = contacts[c + 1], wx = contacts[c + 2];
    if (wx < cMin) cMin = wx;
    if (wx > cMax) cMax = wx;
    for (let cy = 0; cy <= 1; cy++) for (let cx = 0; cx <= 1; cx++) {
      const X = tx(lx + cx, ly + cy), Y = ty(lx + cx, ly + cy);
      pts.push(X, Y);
      if (Y > maxY) maxY = Y;
    }
  }
  // The body rests on its outline (convex hull), which smooths away pixel steps: a tilted box
  // touches the floor at one hull corner even though several jagged edge pixels sit on the ground.
  const hull = getHull(o);
  let hMaxY = -Infinity;
  for (let v = 0; v < hull.length; v += 2) { const Y = ty(hull[v], hull[v + 1]); if (Y > hMaxY) hMaxY = Y; }
  let hMin = Infinity, hMax = -Infinity;
  for (let v = 0; v < hull.length; v += 2) {
    if (ty(hull[v], hull[v + 1]) < hMaxY - 0.25) continue;
    const X = tx(hull[v], hull[v + 1]);
    if (X < hMin) hMin = X;
    if (X > hMax) hMax = X;
  }
  let sMin = Math.max(hMin, cMin - 1), sMax = Math.min(hMax, cMax + 2);
  if (sMin > sMax) {
    // Resting in a hollow of its outline (e.g. on a bump): fall back to the lowest contact corners.
    sMin = Infinity; sMax = -Infinity;
    for (let p = 0; p < pts.length; p += 2) {
      if (pts[p + 1] < maxY - 0.1) continue;
      if (pts[p] < sMin) sMin = pts[p];
      if (pts[p] > sMax) sMax = pts[p];
    }
  }
  let lever = 0, px = 0;
  const py = maxY;
  const size = Math.max(4, fp.maxX - fp.minX + 1, fp.maxY - fp.minY + 1);
  if (comX > sMax + 0.05) { lever = comX - sMax; px = sMax; }
  else if (comX < sMin - 0.05) { lever = comX - sMin; px = sMin; }
  else if (sMax - sMin < Math.max(0.3, size * 0.18)) {
    // Balanced on a corner or a tiny bevel is an unstable equilibrium: tip toward the centre of
    // mass (or toward the nearest square orientation if it is dead centre).
    const rem = ((o.angle % HALF_PI) + HALF_PI) % HALF_PI;
    if (rem > 0.02 && rem < HALF_PI - 0.02) {
      const mid = (sMin + sMax) / 2;
      let dir = Math.sign(comX - mid);
      if (Math.abs(comX - mid) < 0.05) dir = rem < HALF_PI / 2 ? -1 : 1;
      lever = dir * Math.max(0.06, Math.abs(comX - mid));
      px = dir > 0 ? sMax : sMin;
    }
  }

  if (lever === 0) {
    // Stable: a face is down. Kill the spin, then square up when nearly flat for crisp pixels.
    if (Math.abs(o.angVel) > 0.015) impact(o, ctx, 1.2 + Math.abs(o.angVel) * 30);
    o.angVel = 0;
    const q = Math.round(o.angle / HALF_PI) * HALF_PI;
    const d = q - o.angle;
    if (d !== 0 && Math.abs(d) < 0.13) return squareUp(o, q, ctx);
    return false;
  }
  // Landing on a new face is an inelastic impact: torque reversing means the spin stops.
  if (o.angVel !== 0 && Math.sign(o.angVel) !== Math.sign(lever)) {
    if (Math.abs(o.angVel) > 0.015) impact(o, ctx, 1.2 + Math.abs(o.angVel) * 30);
    o.angVel = 0;
  }
  const acc = Math.min(0.01, (Math.abs(lever) * 0.012) / size);
  o.angVel = Math.max(-0.09, Math.min(0.09, o.angVel * 0.98 + Math.sign(lever) * acc));
  if (rotateAbout(o, o.angVel, px, py, ctx)) return true;
  o.angVel = 0;
  return false;
}

/** Spin carried through the air (after tipping off an edge or being thrown). */
function tumble(o, ctx) {
  if (o.angVel === 0) return false;
  o.angVel *= 0.99;
  if (Math.abs(o.angVel) < 0.001) { o.angVel = 0; return false; }
  const prev = o.angle;
  o.angle += o.angVel;
  if (collides(o, o.ox, o.oy, ctx, o.isItem)) {
    o.angle = prev;
    o.angVel *= -0.3;
    return false;
  }
  return true;
}

function conveyorUnder(o, ctx) {
  const world = ctx.world, W = world.w, H = world.h;
  const fp = o.getFootprint();
  const ox = o.ox, oy = o.oy;
  const C = ctx.reg.CONVEYOR;
  for (let k = 0; k < fp.count; k++) {
    if (fp.kinds[k] !== MASK.WALL) continue;
    const wx = ox + fp.offs[2 * k], wy = oy + fp.offs[2 * k + 1] + 1;
    if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
    const i = wy * W + wx;
    if (world.cells[i] === C && world.power[i]) return conveyorDir(world, i);
  }
  return 0;
}

function impact(o, ctx, speed) {
  const vol = Math.min(1, (speed - 1) / 2);
  const b = o.bounds();
  ctx.game.audio?.playAt(o.impactSound || 'thud', (b.x0 + b.x1) / 2, b.y1, 0.3 + vol * 0.7);
  if (ctx.fx) ctx.fx.dust((b.x0 + b.x1) / 2, b.y1 + 1, Math.round(3 + vol * 6), (b.x1 - b.x0) / 2);
}

/** Heat conduction inside the object and with every neighbouring world cell / object cell. */
export function conductObject(o, ctx) {
  const reg = ctx.reg;
  const cond = reg.cond, invCap = reg.invCap;
  const { w, h, mask, mat, temp } = o;
  const K = HEAT_K;

  for (let ly = 0; ly < h; ly++) {
    let li = ly * w;
    for (let lx = 0; lx < w; lx++, li++) {
      const k = mask[li];
      if (k === MASK.EXT || k === MASK.CHAMBER) continue;
      const m = mat[li];
      let ti = temp[li];
      const ci = cond[m];
      if (lx + 1 < w) {
        const lj = li + 1;
        const k2 = mask[lj];
        if (k2 !== MASK.EXT && k2 !== MASK.CHAMBER) {
          const m2 = mat[lj];
          const c = (ci < cond[m2] ? ci : cond[m2]) * K;
          const d = (temp[lj] - ti) * c;
          ti += d * invCap[m];
          temp[lj] -= d * invCap[m2];
        }
      }
      if (ly + 1 < h) {
        const lj = li + w;
        const k2 = mask[lj];
        if (k2 !== MASK.EXT && k2 !== MASK.CHAMBER) {
          const m2 = mat[lj];
          const c = (ci < cond[m2] ? ci : cond[m2]) * K;
          const d = (temp[lj] - ti) * c;
          ti += d * invCap[m];
          temp[lj] -= d * invCap[m2];
        }
      }
      temp[li] = ti;
    }
  }

  const world = ctx.world;
  const W = world.w, H = world.h;
  const { objMask, objLocal, cells } = world;
  const wt = world.temp;
  const id = o.id;
  const amb = world.ambient;
  const stamped = o.stamped;
  for (let s = 0; s < o.stampedCount; s++) {
    const i = stamped[s];
    const li = objLocal[i];
    const m = mat[li];
    let ti = temp[li];
    const ci = cond[m], ici = invCap[m];
    const y = (i / W) | 0, x = i - y * W;
    for (let d = 0; d < 4; d++) {
      let j;
      if (d === 0) { if (x === 0) continue; j = i - 1; }
      else if (d === 1) { if (x === W - 1) continue; j = i + 1; }
      else if (d === 2) { if (y === 0) continue; j = i - W; }
      else { if (y === H - 1) continue; j = i + W; }
      const om = objMask[j];
      if (om === id || om === -id) continue;
      if (om !== 0) {
        const oid = om < 0 ? -om : om;
        if (oid < id) continue; // each object pair is handled once
        const other = ctx.objects.byId.get(oid);
        if (!other) continue;
        const lj = objLocal[j];
        const m2 = other.mat[lj];
        const c = (ci < cond[m2] ? ci : cond[m2]) * K;
        const dT = (other.temp[lj] - ti) * c;
        ti += dT * ici;
        other.temp[lj] -= dT * invCap[m2];
        continue;
      }
      const mj = cells[j];
      if (mj === 0) {
        // Air has almost no heat capacity: a gentle film coefficient instead of solid contact,
        // otherwise a crucible carried through fresh air would freeze in seconds.
        const dT = (wt[j] - ti) * AIR_FILM;
        ti += dT * ici;
        wt[j] -= dT * 3;
        if (dT > 0.05 || dT < -0.05) world.wake(j);
        // Radiative losses from exposed faces (relative to the surrounding air, so a crucible
        // inside a hot furnace chamber loses almost nothing).
        const ex = ti - (wt[j] > amb ? wt[j] : amb);
        if (ex > 25 || ex < -25) {
          const tt = ti > 0 ? Math.min(1, ti / 1500) : 0;
          ti -= ex * (0.00012 + 0.0006 * tt * tt * tt);
        }
        continue;
      }
      const cj = cond[mj];
      const c = (ci < cj ? ci : cj) * K;
      const dT = (wt[j] - ti) * c;
      ti += dT * ici;
      wt[j] -= dT * invCap[mj];
      if (dT > 0.05 || dT < -0.05) world.wake(j);
    }
    temp[li] = ti;
  }
}
