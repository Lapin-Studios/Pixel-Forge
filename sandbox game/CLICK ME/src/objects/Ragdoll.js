// Ragdoll human in the style of People Playground: a side-on, realistically proportioned body
// made of separate parts (head, upper / middle / lower body, upper and lower arms and legs, feet)
// on a verlet skeleton. It never moves on its own — it is dragged by any part with the Hand tool,
// flops under gravity, collides with cells and objects, and reacts to the world: impacts, heat
// and fire, cold, electric shocks, acid, drowning and explosions — with per-limb wounds and burns,
// broken bones, bleeding and a face that shows how it's doing.
import { rng, clamp, hash2 } from '../utils/MathUtils.js';
import { STATE, HEAT_LUT, heatIndex } from '../materials/MaterialProperties.js';

// ------------------------------------------------------------------ skeleton

const P = {
  HEAD: 0, NECK: 1, CHEST: 2, BELLY: 3, PELVIS: 4,
  FAR_ELBOW: 5, FAR_HAND: 6, NEAR_ELBOW: 7, NEAR_HAND: 8,
  FAR_KNEE: 9, FAR_FOOT: 10, NEAR_KNEE: 11, NEAR_FOOT: 12,
};
const PART_NAMES = ['head', 'neck', 'upper body', 'middle body', 'lower body', 'back upper arm', 'back forearm',
  'front upper arm', 'front forearm', 'back thigh', 'back shin', 'front thigh', 'front shin'];
// Body scale (cells per unit) — big enough for People Playground-style blocky parts with outlines.
const S = 1.35;
// Standing pose facing right, relative to the pelvis (y grows downward). Near and far limbs line up,
// so a person standing side-on shows one arm and one leg, like People Playground.
const POSE = [
  [0.4, -15.2], [0, -12.2], [0.1, -8.2], [0, -4.2], [0, 0],
  [0, -6.4], [0.4, -0.6], [0, -6.4], [0.4, -0.6],
  [0.5, 7.6], [0.1, 15.2], [0.5, 7.6], [0.1, 15.2],
].map(([x, y]) => [x * S, y * S]);
// Collision radius per point (cells).
const RADIUS = [3.4, 1.8, 2.6, 2.5, 2.6, 1.5, 1.4, 1.5, 1.4, 1.7, 1.5, 1.7, 1.5];
// Bones: [a, b, length]
const BONES = [
  [P.HEAD, P.NECK, 3.05], [P.NECK, P.CHEST, 4], [P.CHEST, P.BELLY, 4], [P.BELLY, P.PELVIS, 4.2],
  [P.NECK, P.FAR_ELBOW, 5.8], [P.FAR_ELBOW, P.FAR_HAND, 5.8], [P.NECK, P.NEAR_ELBOW, 5.8], [P.NEAR_ELBOW, P.NEAR_HAND, 5.8],
  [P.PELVIS, P.FAR_KNEE, 7.6], [P.FAR_KNEE, P.FAR_FOOT, 7.6], [P.PELVIS, P.NEAR_KNEE, 7.6], [P.NEAR_KNEE, P.NEAR_FOOT, 7.6],
].map(([a, b, l]) => [a, b, l * S]);
// Each part's parent (the bone it hangs from) — used to place wounds along the limb.
const PARENT = [P.NECK, P.CHEST, P.NECK, P.CHEST, P.BELLY, P.NECK, P.FAR_ELBOW, P.NECK, P.NEAR_ELBOW, P.PELVIS, P.FAR_KNEE, P.PELVIS, P.NEAR_KNEE];
// Joint limits as distance ranges [a, b, min, max, limb] — keep joints from folding through themselves.
// `limb` names the joint that, once broken, lets the limit go floppy.
const LIMITS = [
  [P.HEAD, P.CHEST, 5.6, 7.1, -1],      // neck flexes a little
  [P.NECK, P.BELLY, 7.2, 8.05, -1],     // spine
  [P.CHEST, P.PELVIS, 7.2, 8.3, -1],
  [P.NECK, P.PELVIS, 10.5, 12.3, -1],
  [P.HEAD, P.PELVIS, 13, 15.3, -1],
  [P.NECK, P.FAR_HAND, 3.5, 11.65, P.FAR_ELBOW],
  [P.NECK, P.NEAR_HAND, 3.5, 11.65, P.NEAR_ELBOW],
  [P.PELVIS, P.FAR_FOOT, 8, 15.25, P.FAR_KNEE],
  [P.PELVIS, P.NEAR_FOOT, 8, 15.25, P.NEAR_KNEE],
  [P.CHEST, P.FAR_KNEE, 7, 15.9, -1],
  [P.CHEST, P.NEAR_KNEE, 7, 15.9, -1],
].map(([a, b, mn, mx, limb]) => [a, b, mn * S, mx * S, limb]);
// Muscles that hold a standing pose: [point, strength]
const BALANCE = [[P.PELVIS, 1], [P.BELLY, 1], [P.CHEST, 1], [P.NECK, 1], [P.HEAD, 0.8], [P.FAR_KNEE, 0.7], [P.NEAR_KNEE, 0.7],
  [P.FAR_ELBOW, 0.25], [P.NEAR_ELBOW, 0.25], [P.FAR_HAND, 0.2], [P.NEAR_HAND, 0.2]];
const N = 13;
const GRAVITY = 0.07;
const MAX_V = 4.5;
const BODY_TEMP = 37;
const TORSO = new Set([P.HEAD, P.NECK, P.CHEST, P.BELLY, P.PELVIS]);

// ------------------------------------------------------------------ look

const rgb = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const FILL = [168, 168, 180];          // People Playground grey
const LINE_K = 0.76;                      // part outlines are a darker shade of the fill
const OUTLINE = rgb(34, 34, 40);          // thin dark rim around the whole silhouette
const CHAR = [36, 30, 28], ICE = [178, 220, 246], BLUE = [120, 140, 210];
const FAR = 0.82;                         // far-side arm and leg are drawn darker
const HEAD_HALF = 3.6;                    // head is a square block with cut corners
const RES = 4;                            // sprite pixels per world cell (finer than the grid)
const EDGE = 0.5;                         // outline thickness in cells

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

let nextDollId = 1;

export class Ragdoll {
  constructor(game, x, y) {
    this.game = game;
    this.id = `doll${nextDollId++}`;
    this.isRagdoll = true;
    this.name = 'Ragdoll Human';
    this.type = 'ragdoll';
    this.x = new Float32Array(N); this.y = new Float32Array(N);
    this.px = new Float32Array(N); this.py = new Float32Array(N);
    this.fx = new Float32Array(N); this.fy = new Float32Array(N); // last free (non-solid) position
    this.mx = new Float32Array(N); this.my = new Float32Array(N); // position after this tick's move
    this.contact = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      this.x[k] = this.px[k] = this.fx[k] = x + POSE[k][0];
      this.y[k] = this.py[k] = this.fy[k] = y + POSE[k][1];
    }
    this.health = 100;
    this.temp = BODY_TEMP;
    this.oxygen = 600;
    this.facing = 1;        // 1 = facing right, -1 = facing left
    this.burnt = new Float32Array(N); // 0..1 charring per body part
    this.wound = new Float32Array(N); // wounds / bruises per body part
    this.seed = (rng() * 1e6) | 0;
    this.onFire = 0;        // ticks left burning
    this.shock = 0;         // ticks left being electrocuted
    this.hurt = 0;          // ticks left showing pain
    this.broken = new Set(); // broken bone point indices
    this.frozen = null;     // rigid distance table while frozen solid
    this.bleed = 0;
    this.blink = 0;
    this.grab = -1;         // point index held by the hand
    this.dead = false;      // removed from the world (ObjectManager convention)
    this.age = 0;
    this.lastCry = 0;
    this.lastImpact = 0;
    this.knockdown = 0;     // ticks before he tries to stand again
    this.standT = 1;        // 0..1 how firmly he's holding himself up
    this.standing = false;
  }

  get alive() { return this.health > 0; }

  /** Overall charring (0..1). */
  get char() {
    let s = 0;
    for (let k = 0; k < N; k++) s += this.burnt[k];
    return s / N;
  }

  burn(k, amount) {
    if (k >= 0) this.burnt[k] = Math.min(1, this.burnt[k] + amount);
    else for (let j = 0; j < N; j++) this.burnt[j] = Math.min(1, this.burnt[j] + amount);
  }

  /** Unit vector pointing where the body faces (perpendicular to the spine). */
  forward() {
    const sx = this.x[P.NECK] - this.x[P.PELVIS], sy = this.y[P.NECK] - this.y[P.PELVIS];
    const l = Math.hypot(sx, sy) || 1;
    return [(-sy / l) * this.facing, (sx / l) * this.facing];
  }

  // ------------------------------------------------------------------ geometry

  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < N; k++) {
      const r = k === P.HEAD ? 5.5 : 3.5;
      x0 = Math.min(x0, this.x[k] - r); y0 = Math.min(y0, this.y[k] - r);
      x1 = Math.max(x1, this.x[k] + r); y1 = Math.max(y1, this.y[k] + r);
    }
    return { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1) - 1, y1: Math.ceil(y1) - 1 };
  }

  center() { return [this.x[P.BELLY], this.y[P.BELLY]]; }

  /** Nearest body point to (wx, wy) within `maxD`, or -1. */
  pointNear(wx, wy, maxD = 4) {
    let best = -1, bd = maxD * maxD;
    for (let k = 0; k < N; k++) {
      const r = k === P.HEAD ? 4 : 2.2;
      const dx = this.x[k] - wx, dy = this.y[k] - wy;
      const d = Math.max(0, Math.hypot(dx, dy) - r);
      if (d * d <= bd) { bd = d * d; best = k; }
    }
    if (best < 0) {
      // Also accept clicks on the limbs between joints.
      for (const [a, b] of BONES) {
        const ax = this.x[a], ay = this.y[a], bx = this.x[b], by = this.y[b];
        const vx = bx - ax, vy = by - ay;
        const t = clamp(((wx - ax) * vx + (wy - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
        const d = Math.hypot(ax + vx * t - wx, ay + vy * t - wy);
        if (d <= 3) return t < 0.5 ? a : b;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ world queries

  /** Is the cell at (cx, cy) something the body can't pass through? */
  solidCell(cx, cy) {
    const world = this.game.world;
    if (cx < 0 || cx >= world.w || cy >= world.h) return true;
    if (cy < 0) return false;
    const i = cy * world.w + cx;
    const om = world.objMask[i];
    const reg = this.game.registry;
    if (om > 0) return true;
    if (om < 0) {
      const o = this.game.objects.byId.get(-om);
      const m = o ? o.mat[world.objLocal[i]] : 0;
      return m !== 0 && reg.state[m] <= STATE.POWDER;
    }
    const m = world.cells[i];
    return m !== 0 && reg.state[m] <= STATE.POWDER && m !== reg.CLONER && m !== reg.VOID;
  }

  blocked(x, y, r) {
    const rr = r * 0.75;
    return this.solidCell(Math.floor(x), Math.floor(y))
      || this.solidCell(Math.floor(x - rr), Math.floor(y + rr)) || this.solidCell(Math.floor(x + rr), Math.floor(y + rr))
      || this.solidCell(Math.floor(x - rr), Math.floor(y - rr)) || this.solidCell(Math.floor(x + rr), Math.floor(y - rr))
      || this.solidCell(Math.floor(x), Math.floor(y + r)) || this.solidCell(Math.floor(x), Math.floor(y - r))
      || this.solidCell(Math.floor(x + r), Math.floor(y)) || this.solidCell(Math.floor(x - r), Math.floor(y));
  }

  /** Material + temperature of whatever fills the cell at (x, y). */
  sample(x, y) {
    const world = this.game.world;
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) return { m: 0, t: world.ambient, i: -1 };
    const i = cy * world.w + cx;
    const om = world.objMask[i];
    if (om !== 0) {
      const o = this.game.objects.byId.get(Math.abs(om));
      if (o) { const li = world.objLocal[i]; return { m: o.mat[li], t: o.temp[li], i, obj: o, li }; }
    }
    return { m: world.cells[i], t: world.temp[i], i };
  }

  // ------------------------------------------------------------------ simulation

  step(ctx) {
    const world = this.game.world;
    if (!world) return;
    this.age++;
    const reg = this.game.registry;
    const held = this.grab >= 0;
    const tools = this.game.tools;
    let maxImpact = 0, impactPart = -1;
    // Whole-body speed: a limb whipped by the solver can't hit harder than the body is moving.
    let cvx = 0, cvy = 0;
    for (let k = 0; k < N; k++) { cvx += this.x[k] - this.px[k]; cvy += this.y[k] - this.py[k]; }
    const bodySpeed = Math.hypot(cvx, cvy) / N;

    // --- integrate
    for (let k = 0; k < N; k++) {
      let vx = (this.x[k] - this.px[k]) * 0.995;
      let vy = (this.y[k] - this.py[k]) * 0.995 + GRAVITY;
      const s = this.sample(this.x[k], this.y[k]);
      const st = s.m ? reg.state[s.m] : 0;
      if (st === STATE.LIQUID) {
        // Drag + buoyancy: people float in water and bob on molten metal.
        const dens = clamp(reg.density[s.m] / 1000, 0.6, 3);
        vx *= 0.86; vy *= 0.86;
        vy -= GRAVITY * (TORSO.has(k) ? 1.22 : 0.95) * dens;
      }
      if (held) {
        // Carried: limbs hang and settle instead of whipping around.
        vx *= 0.86; vy = (vy - GRAVITY) * 0.86 + GRAVITY;
      } else {
        if (this.shock > 0) { vx += (rng() - 0.5) * 0.5; vy += (rng() - 0.5) * 0.5; }
        if ((this.onFire > 0 || this.hurt > 20) && this.alive && rng() < 0.08) { vx += (rng() - 0.5) * 0.35; vy -= rng() * 0.15; }
      }
      vx = clamp(vx, -MAX_V, MAX_V); vy = clamp(vy, -MAX_V, MAX_V);
      this.px[k] = this.x[k]; this.py[k] = this.y[k];
      if (held && k === this.grab) continue;
      const hit = Math.min(this.move(k, vx, vy), bodySpeed + 0.4);
      if (hit > maxImpact) { maxImpact = hit; impactPart = k; }
    }

    // --- the hand holds the grabbed part exactly at the cursor (full strength, no lag)
    if (held) this.followHand(tools.hover.wx, tools.hover.wy);
    else this.balance();

    this.mx.set(this.x); this.my.set(this.y);
    this.solveConstraints();
    this.resolveWalls();

    // --- impacts: one landing hurts once (the parts that hit right after only add the extra speed)
    const floor = Math.max(2, this.lastImpact);
    this.lastImpact = Math.max(0, this.lastImpact - 0.025);
    if (maxImpact > floor && !held) {
      const base = Math.max(0, maxImpact - 2) ** 2 - Math.max(0, floor - 2) ** 2;
      const dmg = base * 9 * (impactPart === P.HEAD ? 1.6 : 1);
      this.lastImpact = Math.max(this.lastImpact, maxImpact);
      this.damage(dmg, impactPart, 'impact');
      const [cx, cy] = [this.x[impactPart], this.y[impactPart]];
      this.game.audio?.playAt('thud', cx, cy, Math.min(1, 0.3 + maxImpact * 0.15));
      if (dmg > 22 && !TORSO.has(impactPart) && !this.broken.has(impactPart)) {
        this.broken.add(impactPart);
        this.game.audio?.playAt('crack', cx, cy, 1);
      }
    }

    this.environment(ctx);
    this.updateState();
  }

  /** Put the grabbed part exactly under the cursor (or as close as walls allow). */
  followHand(tx, ty) {
    const g = this.grab;
    if (g < 0) return;
    if (!this.blocked(tx, ty, RADIUS[g] * 0.6)) { this.x[g] = tx; this.y[g] = ty; }
    else this.move(g, tx - this.x[g], ty - this.y[g], true);
  }

  /** Dragging while the simulation is paused: pose the body without gravity or momentum. */
  dragPaused(tx, ty) {
    this.followHand(tx, ty);
    this.mx.set(this.x); this.my.set(this.y);
    this.solveConstraints();
    this.resolveWalls();
    this.px.set(this.x); this.py.set(this.y);
  }

  canBalance() {
    if (!this.alive || this.health < 25 || this.frozen || this.shock > 0 || this.onFire > 0 || this.knockdown > 0) return false;
    const s = this.sample(this.x[P.PELVIS], this.y[P.PELVIS]);
    return !(s.m && this.game.registry.state[s.m] === STATE.LIQUID);
  }

  onGround(k) {
    return this.solidCell(Math.floor(this.x[k]), Math.floor(this.y[k] + RADIUS[k] + 0.5));
  }

  /**
   * Stand up and stay up (he never walks): while a foot is on the ground, muscles pull the body
   * toward the standing pose above the feet — firmly when already upright, slowly when getting up.
   */
  balance() {
    this.standing = false;
    this.planted = 0;
    if (!this.canBalance()) { this.standT = Math.max(0, this.standT - 0.05); return; }
    const X = this.x, Y = this.y;
    const ff = P.FAR_FOOT, nf = P.NEAR_FOOT;
    const gf = this.onGround(ff), gn = this.onGround(nf);
    const fw = this.forward();
    if (!gf && !gn) {
      // Falling: throw the arms out in front to catch himself.
      this.standT = Math.max(0, this.standT - 0.02);
      const cx = X[P.CHEST] + fw[0] * 5 * S, cy = Y[P.CHEST] + 3 * S;
      this.pull(P.FAR_HAND, cx, cy, 0.12); this.pull(P.NEAR_HAND, cx, cy, 0.12);
      return;
    }
    this.standT = Math.min(1, this.standT + 0.01);
    // Feet on the ground stay planted (no sliding) while he holds himself up.
    this.planted = (gf ? 1 : 0) | (gn ? 2 : 0);
    let bx, by;
    if (gf && gn) { bx = (X[ff] + X[nf]) / 2; by = Math.max(Y[ff], Y[nf]); }
    else { const k = gf ? ff : nf; bx = X[k]; by = Y[k]; }
    const sx = X[P.NECK] - X[P.PELVIS], sy = Y[P.NECK] - Y[P.PELVIS];
    const upright = -sy / (Math.hypot(sx, sy) || 1);
    const strength = (upright > 0.75 ? 0.3 : 0.06) * this.standT * clamp(this.health / 70, 0.4, 1);
    const f = this.facing;
    const footX = (POSE[ff][0] + POSE[nf][0]) / 2, footY = POSE[ff][1];
    for (const [j, w] of BALANCE) {
      // Getting up off the ground: plant the hands on the floor under the chest and push.
      if (upright <= 0.4 && (j === P.FAR_HAND || j === P.NEAR_HAND)) {
        this.pull(j, X[P.CHEST] + fw[0] * 2 * S, Math.min(by, Y[P.NECK] + 9 * S), 0.1);
        continue;
      }
      this.pull(j, bx + (POSE[j][0] - footX) * f, by + (POSE[j][1] - footY), strength * w);
    }
    this.standing = upright > 0.85;
  }

  /** Move point j part of the way to (tx, ty), damping its speed so muscles don't wobble. */
  pull(j, tx, ty, k) {
    const nx = this.x[j] + (tx - this.x[j]) * k, ny = this.y[j] + (ty - this.y[j]) * k;
    if (this.blocked(nx, ny, RADIUS[j])) return;
    const vx = this.x[j] - this.px[j], vy = this.y[j] - this.py[j];
    this.x[j] = nx; this.y[j] = ny;
    this.px[j] = nx - vx * 0.6; this.py[j] = ny - vy * 0.6;
  }

  solveConstraints() {
    const held = this.grab >= 0;
    const inv = Ragdoll.inv || (Ragdoll.inv = new Float32Array(N));
    inv.fill(1);
    inv[P.HEAD] = 0.8; inv[P.CHEST] = 0.7; inv[P.BELLY] = 0.7; inv[P.PELVIS] = 0.7;
    if (held) inv[this.grab] = 0;
    else if (this.planted) {
      if (this.planted & 1) inv[P.FAR_FOOT] = 0.05;
      if (this.planted & 2) inv[P.NEAR_FOOT] = 0.05;
    }
    const stiff = this.alive ? 1 : 0.6;
    for (let it = 0; it < 12; it++) {
      for (const [a, b, len] of BONES) this.solve(a, b, len, len, inv, 1);
      if (this.frozen) {
        for (const [a, b, d] of this.frozen) this.solve(a, b, d, d, inv, 0.9);
      } else {
        for (const [a, b, mn, mx, limb] of LIMITS) {
          if (limb >= 0 && this.broken.has(limb)) continue;
          this.solve(a, b, mn, mx, inv, 0.5 * stiff);
        }
        this.bendJoints(0.5 * stiff);
      }
    }
  }

  resolveWalls() {
    for (let k = 0; k < N; k++) {
      const r = RADIUS[k];
      // The constraint solver may have dragged this part through a thin wall: walk the path from
      // where it was after moving (free) and stop at the last free spot.
      if (!this.blocked(this.x[k], this.y[k], r)) {
        if (this.pathBlocked(k)) { this.x[k] = this.mx[k]; this.y[k] = this.my[k]; this.px[k] = this.x[k]; this.py[k] = this.y[k]; }
        this.fx[k] = this.x[k]; this.fy[k] = this.y[k];
        this.stuck = 0;
        continue;
      }
      // Loose sand / powder around the body gets pushed aside instead of trapping it.
      if (this.shoveLoose(this.x[k], this.y[k], r) && !this.blocked(this.x[k], this.y[k], r)) continue;
      // Points the constraints pushed into a wall go back to where they were after moving (which was
      // free), without gaining speed — popping them out would make the body jitter at rest.
      if (!this.blocked(this.mx[k], this.my[k], r)) {
        this.x[k] = this.fx[k] = this.mx[k]; this.y[k] = this.fy[k] = this.my[k];
        this.px[k] = this.x[k]; this.py[k] = this.y[k];
        continue;
      }
      // Really stuck (something was painted or dropped onto it): find the nearest free spot.
      const free = this.nearestFree(this.x[k], this.y[k], r, 8);
      if (free) {
        this.x[k] = this.fx[k] = free[0]; this.y[k] = this.fy[k] = free[1];
        this.px[k] = this.x[k]; this.py[k] = this.y[k];
      } else {
        this.x[k] = this.fx[k]; this.y[k] = this.fy[k];
        // Crushed under something solid hurts; just being buried in sand doesn't.
        if (this.solidAround(this.x[k], this.y[k], r)) this.damage(0.35, k, 'crush');
      }
    }
  }

  /** Is any cell overlapping this part a real solid or an object (not just loose powder)? */
  solidAround(x, y, r) {
    const world = this.game.world, reg = this.game.registry;
    for (let yy = Math.floor(y - r); yy <= Math.floor(y + r); yy++) {
      for (let xx = Math.floor(x - r); xx <= Math.floor(x + r); xx++) {
        if (xx < 0 || yy < 0 || xx >= world.w || yy >= world.h) continue;
        const i = yy * world.w + xx;
        if (world.objMask[i] > 0) return true;
        const m = world.cells[i];
        if (m && reg.state[m] === STATE.SOLID && m !== reg.CLONER && m !== reg.VOID) return true;
      }
    }
    return false;
  }

  /** Is there a wall on the straight path from this tick's free position to the current one? */
  pathBlocked(k) {
    const x0 = this.mx[k], y0 = this.my[k], x1 = this.x[k], y1 = this.y[k];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 0.6) return false;
    const steps = Math.ceil(d / 0.5);
    const r = RADIUS[k] * 0.5;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (this.blocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)) return true;
    }
    return false;
  }

  /** Spiral outwards for the nearest position where a part of radius r fits. */
  nearestFree(x, y, r, maxR) {
    for (let d = 1; d <= maxR; d++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2 - Math.PI / 2; // try straight up first
        const nx = x + Math.cos(ang) * d, ny = y + Math.sin(ang) * d;
        if (!this.blocked(nx, ny, r)) return [nx, ny];
      }
    }
    return null;
  }

  /** Move loose powder cells that overlap a body part out of the way. Returns true if any moved. */
  shoveLoose(x, y, r) {
    const world = this.game.world, reg = this.game.registry;
    let movedAny = false, solid = false;
    for (let yy = Math.floor(y - r); yy <= Math.floor(y + r); yy++) {
      for (let xx = Math.floor(x - r); xx <= Math.floor(x + r); xx++) {
        if (xx < 0 || yy < 0 || xx >= world.w || yy >= world.h) continue;
        const i = yy * world.w + xx;
        if (world.objMask[i] !== 0) { solid = true; continue; }
        const m = world.cells[i];
        if (!m) continue;
        if (reg.state[m] !== STATE.POWDER) { if (reg.state[m] === STATE.SOLID) solid = true; continue; }
        const j = world.findFreeNear(xx, yy - Math.ceil(r) - 1, 6);
        if (j < 0) continue;
        world.cells[j] = m; world.temp[j] = world.temp[i]; world.life[j] = world.life[i];
        world.wake(j);
        world.clearCell(i);
        movedAny = true;
      }
    }
    return movedAny && !solid;
  }

  /** Move point k by (vx, vy) in small steps; returns the speed lost in a collision (impact). */
  move(k, vx, vy, kinematic = false) {
    const r = RADIUS[k];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy)) / 0.5));
    const sx = vx / steps, sy = vy / steps;
    let x = this.x[k], y = this.y[k];
    let hitX = false, hitY = false;
    for (let s = 0; s < steps; s++) {
      if (!hitX && !hitY && !this.blocked(x + sx, y + sy, r)) { x += sx; y += sy; continue; }
      if (!hitX && !this.blocked(x + sx, y, r)) x += sx; else hitX = true;
      if (!hitY && !this.blocked(x, y + sy, r)) y += sy; else hitY = true;
      if (hitX && hitY) break;
    }
    this.x[k] = x; this.y[k] = y;
    this.contact[k] = (hitX ? 1 : 0) | (hitY ? 2 : 0);
    if ((hitX || hitY) && Math.hypot(vx, vy) > 0.6) this.shoveObject(x + Math.sign(vx) * (r + 0.6), y + Math.sign(vy) * (r + 0.6), vx, vy);
    if (kinematic) return 0;
    // Bounce a little, slide with friction.
    let nvx = vx, nvy = vy, impact = 0;
    if (hitY) { impact = Math.abs(vy); nvy = -vy * 0.12; nvx = vx * (vy > 0 ? 0.72 : 0.9); }
    if (hitX) { impact = Math.max(impact, Math.abs(vx)); nvx = -vx * 0.12; nvy *= 0.9; }
    if (hitY && vy > 0) this.conveyorPush(k, (v) => { nvx = nvx * 0.5 + v; });
    this.px[k] = x - nvx; this.py[k] = y - nvy;
    return impact;
  }

  /** Knees only bend forward, elbows only backward, legs don't swing far behind the hips. */
  bendJoints(k) {
    const f = this.forward();
    const g = this.grab;
    if (!this.broken.has(P.FAR_KNEE) && g !== P.FAR_KNEE) this.bend(P.PELVIS, P.FAR_KNEE, P.FAR_FOOT, f, 1, k);
    if (!this.broken.has(P.NEAR_KNEE) && g !== P.NEAR_KNEE) this.bend(P.PELVIS, P.NEAR_KNEE, P.NEAR_FOOT, f, 1, k);
    if (!this.broken.has(P.FAR_ELBOW) && g !== P.FAR_ELBOW) this.bend(P.NECK, P.FAR_ELBOW, P.FAR_HAND, f, -1, k);
    if (!this.broken.has(P.NEAR_ELBOW) && g !== P.NEAR_ELBOW) this.bend(P.NECK, P.NEAR_ELBOW, P.NEAR_HAND, f, -1, k);
    for (const knee of [P.FAR_KNEE, P.NEAR_KNEE]) {
      if (knee === g) continue;
      const back = (this.x[knee] - this.x[P.PELVIS]) * f[0] + (this.y[knee] - this.y[P.PELVIS]) * f[1];
      const lim = -2.6 * S;
      if (back < lim) { this.x[knee] += f[0] * (lim - back) * k; this.y[knee] += f[1] * (lim - back) * k; }
    }
  }

  /** Keep joint j on the `dir` side (+1 forward / -1 backward) of the line from a to b. */
  bend(a, j, b, f, dir, k) {
    const ax = this.x[a], ay = this.y[a];
    const lx = this.x[b] - ax, ly = this.y[b] - ay;
    const t = ((this.x[j] - ax) * lx + (this.y[j] - ay) * ly) / (lx * lx + ly * ly || 1);
    const off = ((this.x[j] - ax - lx * t) * f[0] + (this.y[j] - ay - ly * t) * f[1]) * dir;
    if (off >= 0.25) return;
    const push = (0.25 - off) * k * dir;
    this.x[j] += f[0] * push;
    this.y[j] += f[1] * push;
  }

  /** Push a loose object the body ran into, a little (it's much heavier than one limb). */
  shoveObject(wx, wy, vx, vy) {
    const world = this.game.world;
    const cx = Math.floor(wx), cy = Math.floor(wy);
    if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) return;
    const om = world.objMask[cy * world.w + cx];
    if (om <= 0) return;
    const o = this.game.objects.byId.get(om);
    if (!o || o.held || o.anchored) return;
    let cells = o.massCells;
    if (!cells) { cells = 0; for (let i = 0; i < o.mask.length; i++) if (o.mask[i]) cells++; o.massCells = cells; }
    const f = clamp(12 / cells, 0.02, 0.5);
    o.vx = clamp(o.vx + vx * f, -2.5, 2.5);
    if (vy < 0) o.vy = clamp(o.vy + vy * f, -2.5, 2.5);
  }

  conveyorPush(k, apply) {
    const world = this.game.world, reg = this.game.registry;
    const cx = Math.floor(this.x[k]), cy = Math.floor(this.y[k] + RADIUS[k] + 0.6);
    if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) return;
    const i = cy * world.w + cx;
    if (world.cells[i] === reg.CONVEYOR && world.power[i]) apply(world.life[i] < 0 ? -0.35 : 0.35);
  }

  solve(a, b, mn, mx, inv, k) {
    const dx = this.x[b] - this.x[a], dy = this.y[b] - this.y[a];
    const d = Math.hypot(dx, dy) || 0.0001;
    let target;
    if (d < mn) target = mn; else if (d > mx) target = mx; else return;
    const wa = inv[a], wb = inv[b], ws = wa + wb;
    if (ws === 0) return;
    const diff = ((d - target) / d) * k;
    const ox = dx * diff, oy = dy * diff;
    this.x[a] += ox * (wa / ws); this.y[a] += oy * (wa / ws);
    this.x[b] -= ox * (wb / ws); this.y[b] -= oy * (wb / ws);
  }

  /** Heat, fire, cold, electricity, acid, water — everything the body touches. */
  environment() {
    const game = this.game, world = game.world, reg = game.registry;
    const fx = game.particles, audio = game.audio;
    let heatDmg = 0, touchFire = false, inWater = 0, acid = 0, shocked = false, envSum = 0, envN = 0;
    for (let k = 0; k < N; k++) {
      const s = this.sample(this.x[k], this.y[k]);
      const m = s.m;
      const t = s.t;
      if (m !== 0 || s.obj) { envSum += t; envN += 2; }
      else { envSum += t; envN += 1; }
      if (t > 60) {
        const d = Math.min(0.5, (t - 60) * 0.00018);
        heatDmg += d;
        this.burn(k, d * 0.045);
      }
      if (m === reg.VOID && !s.obj) { this.vanish(); return; }
      if (m === reg.CLONER && !s.obj) this.game.objects.cloneDoll(this);
      if (m) {
        const st = reg.state[m];
        if (st === STATE.FIRE || (s.i >= 0 && !s.obj && world.burn[s.i])) touchFire = true;
        if (st === STATE.LIQUID && reg.isWater[m]) inWater++;
        if (reg.hasTag(m, 'acid')) { acid++; this.burn(k, 0.0015); this.wound[k] = Math.min(2, this.wound[k] + 0.002); }
        if (k === P.HEAD && st === STATE.LIQUID) this.oxygen -= 1;
      }
      // Contact with live wiring right next to the body.
      const r = RADIUS[k] + 0.7;
      for (let d = 0; d < 4 && !shocked; d++) {
        const cx = Math.floor(this.x[k] + (d === 0 ? r : d === 1 ? -r : 0)), cy = Math.floor(this.y[k] + (d === 2 ? r : d === 3 ? -r : 0));
        if (cx >= 0 && cy >= 0 && cx < world.w && cy < world.h && world.power[cy * world.w + cx]) shocked = true;
      }
      // Burning bodies set things alight and warm the air around them.
      if (this.onFire > 0 && s.i >= 0 && !s.obj) {
        world.temp[s.i] = Math.max(world.temp[s.i], 160);
        world.wake(s.i);
      }
    }
    const head = this.sample(this.x[P.HEAD], this.y[P.HEAD]);
    if (!(head.m && reg.state[head.m] === STATE.LIQUID)) this.oxygen = Math.min(600, this.oxygen + 4);

    // Body temperature follows the surroundings (people keep themselves near 37 °C while alive).
    const env = envSum / Math.max(1, envN);
    this.temp += (env - this.temp) * (inWater ? 0.02 : 0.003);
    if (this.alive) this.temp += (BODY_TEMP - this.temp) * 0.02;
    if (this.onFire > 0) this.temp = Math.max(this.temp, 60 + Math.min(300, this.onFire));

    if (heatDmg > 0) this.damage(heatDmg, -1, 'heat');
    if ((touchFire || this.temp > 220) && !inWater && this.onFire <= 0) {
      this.onFire = 420;
      audio?.playAt('whoosh', this.x[P.BELLY], this.y[P.BELLY], 0.7);
    }
    if (this.onFire > 0) {
      this.onFire--;
      if (inWater) { this.onFire = 0; fx?.steam(this.x[P.BELLY], this.y[P.BELLY], 4); audio?.playAt('sizzle', this.x[P.BELLY], this.y[P.BELLY], 0.8); }
      this.damage(0.07, -1, 'fire');
      const k = (rng() * N) | 0;
      this.burn(k, 0.012);
      fx?.flame(this.x[k] + (rng() - 0.5) * 2, this.y[k] - 1, 1000);
      if (rng() < 0.3) fx?.smoke(this.x[k], this.y[k] - 2, 1);
      if (rng() < 0.04) this.igniteNear(k);
      if (this.alive && rng() < 0.03) this.cry('scream');
    }
    if (this.temp < -5 && !this.frozen) this.freeze();
    else if (this.frozen && this.temp > 3) { this.frozen = null; audio?.playAt('iceCrack', this.x[P.BELLY], this.y[P.BELLY], 0.7); }
    if (this.temp < -15) this.damage(0.03, -1, 'cold');
    if (this.frozen && rng() < 0.05) fx?.frost(this.x[(rng() * N) | 0], this.y[(rng() * N) | 0]);

    if (shocked) {
      if (this.shock <= 0) audio?.playAt('zap', this.x[P.BELLY], this.y[P.BELLY], 1);
      this.shock = 8;
      this.damage(0.3, -1, 'shock');
      if (rng() < 0.5) fx?.arc(this.x[(rng() * N) | 0], this.y[(rng() * N) | 0]);
      audio?.playAt('zap', this.x[P.BELLY], this.y[P.BELLY], 0.6);
    } else if (this.shock > 0) this.shock--;

    if (acid) {
      this.damage(acid * 0.035, -1, 'acid');
      if (rng() < 0.3) fx?.fizz(this.x[(rng() * N) | 0], this.y[(rng() * N) | 0]);
      audio?.playAt('fizz', this.x[P.BELLY], this.y[P.BELLY], 0.5);
    }
    if (this.oxygen <= 0) { this.oxygen = 0; this.damage(0.25, -1, 'drown'); }
    if (this.oxygen < 600 && head.m && reg.state[head.m] === STATE.LIQUID && rng() < 0.06) {
      fx?.spawn(this.x[P.HEAD], this.y[P.HEAD] - 2, (rng() - 0.5) * 0.2, -0.3, 0.8, 200, 230, 255, 0.8, 12);
      if (rng() < 0.3) audio?.playAt('bubble', this.x[P.HEAD], this.y[P.HEAD], 0.4);
    }

    // Bleeding: drips while badly hurt.
    if (this.bleed > 0) {
      this.bleed = Math.max(0, this.bleed - 0.02);
      if (rng() < 0.04 * Math.min(3, this.bleed)) this.dripBlood(this.mostWounded());
    }

    // Burnt to a crisp: crumble into ash.
    if (!this.alive && this.char >= 1 && this.temp > 150) this.crumble();
  }

  /** A body part to bleed from, weighted by how badly each part is wounded. */
  mostWounded() {
    let total = 0;
    for (let k = 0; k < N; k++) total += this.wound[k];
    if (total <= 0) return (rng() * N) | 0;
    let r = rng() * total;
    for (let k = 0; k < N; k++) { r -= this.wound[k]; if (r <= 0) return k; }
    return P.BELLY;
  }

  updateState() {
    if (this.hurt > 0) this.hurt--;
    if (this.knockdown > 0) this.knockdown--;
    if (this.blink > 0) this.blink--;
    else if (rng() < 0.006) this.blink = 8;
  }

  // ------------------------------------------------------------------ reactions

  damage(amount, part, cause) {
    if (amount <= 0 || this.dead) return;
    const was = this.health;
    this.health = Math.max(0, this.health - amount);
    if (amount > 1.5) this.hurt = Math.min(90, this.hurt + 20 + amount * 2);
    if (amount > 6 && (cause === 'impact' || cause === 'explosion' || cause === 'crush')) { this.knockdown = Math.max(this.knockdown, 40 + amount * 3); this.standT = 0; }
    if (part >= 0 && (cause === 'impact' || cause === 'crush')) this.wound[part] = Math.min(2, this.wound[part] + amount * 0.03);
    if (cause === 'explosion') for (let j = 0; j < N; j++) this.wound[j] = Math.min(2, this.wound[j] + amount * 0.006 * rng());
    if (cause === 'impact' && amount > 6) {
      this.bleed += amount * 0.06;
      const k = part >= 0 ? part : P.BELLY;
      const n = Math.min(14, 2 + amount * 0.4);
      this.game.particles?.splash(this.x[k], this.y[k], n, 150, 18, 24);
      if (amount > 14) for (let j = 0; j < Math.min(4, amount / 10); j++) this.dripBlood(k);
    }
    if (was > 0 && this.health <= 0) {
      this.cry('groan');
      this.game.toast?.(`💀 The ragdoll died (${{ impact: 'blunt force', heat: 'burns', fire: 'burns', cold: 'hypothermia', shock: 'electrocution', acid: 'acid burns', drown: 'drowning', crush: 'crushed', explosion: 'explosion' }[cause] || cause})`, 'warn');
    } else if (this.alive && amount > 4) this.cry(amount > 18 ? 'ow' : 'oof');
  }

  cry(kind) {
    const now = this.game.frame || 0;
    if (kind !== 'groan' && now - this.lastCry < 25) return;
    this.lastCry = now;
    const [x, y] = [this.x[P.HEAD], this.y[P.HEAD]];
    this.game.audio?.playAt(kind, x, y, 0.9);
  }

  freeze() {
    // Lock every pair of points at its current distance: the body becomes a rigid statue.
    const list = [];
    for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) list.push([a, b, Math.hypot(this.x[b] - this.x[a], this.y[b] - this.y[a])]);
    this.frozen = list;
    this.game.audio?.playAt('iceCrack', this.x[P.BELLY], this.y[P.BELLY], 0.9);
  }

  igniteNear(k) {
    const world = this.game.world, reg = this.game.registry;
    const cx = Math.floor(this.x[k] + (rng() - 0.5) * 4), cy = Math.floor(this.y[k] - 1 - rng() * 3);
    if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) return;
    const i = cy * world.w + cx;
    if (world.cells[i] === 0 && world.objMask[i] === 0) world.setCell(i, reg.FIRE, 700);
  }

  dripBlood(k) {
    const world = this.game.world, reg = this.game.registry;
    const blood = reg.id('blood');
    if (!blood) return;
    const cx = Math.floor(this.x[k] + (rng() - 0.5) * 2), cy = Math.floor(this.y[k] + 1);
    if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) return;
    const i = cy * world.w + cx;
    if (world.cells[i] === 0 && world.objMask[i] === 0) world.setCell(i, blood, BODY_TEMP);
  }

  /** Swallowed by a Void. */
  vanish() {
    const [cx, cy] = this.center();
    this.game.particles?.dust(cx, cy, 10, 6);
    this.game.audio?.playAt('delete', cx, cy);
    this.dead = true;
  }

  crumble() {
    const world = this.game.world, reg = this.game.registry;
    const ash = reg.id('ash');
    for (let k = 0; k < N; k++) {
      for (let j = 0; j < 6; j++) {
        const cx = Math.floor(this.x[k] + (rng() - 0.5) * 3), cy = Math.floor(this.y[k] + (rng() - 0.5) * 3);
        if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) continue;
        const i = cy * world.w + cx;
        if (world.cells[i] === 0 && world.objMask[i] === 0) world.setCell(i, ash, 200);
      }
      this.game.particles?.smoke(this.x[k], this.y[k], 2);
    }
    this.game.audio?.playAt('crackle', this.x[P.BELLY], this.y[P.BELLY], 1);
    this.game.toast?.('🔥 The ragdoll burnt to ash.', 'warn');
    this.dead = true;
  }

  /** Explosion / blast push. */
  impulse(cx, cy, radius, power) {
    let hit = 0;
    for (let k = 0; k < N; k++) {
      const dx = this.x[k] - cx, dy = this.y[k] - cy;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const f = (1 - d / radius) * power * 1.6;
      this.px[k] -= (dx / (d || 1)) * f;
      this.py[k] -= (dy / (d || 1)) * f - f * 0.5;
      hit = Math.max(hit, f);
    }
    if (hit > 0) {
      if (this.grab >= 0) this.game.tools?.releaseDoll?.();
      this.damage(hit * 14, P.BELLY, 'explosion');
      if (hit > 1) { this.onFire = Math.max(this.onFire, 120); this.burn(-1, hit * 0.05); }
    }
  }

  /** Heat gun / freeze spray aimed at the body. */
  heatAt(wx, wy, r, delta) {
    let n = 0;
    for (let k = 0; k < N; k++) if (Math.hypot(this.x[k] - wx, this.y[k] - wy) <= r + RADIUS[k]) n++;
    if (!n) return false;
    this.temp = clamp(this.temp + delta * n * 0.012, -200, 3000);
    return true;
  }

  heal() {
    this.health = 100; this.temp = BODY_TEMP; this.oxygen = 600;
    this.burnt.fill(0); this.wound.fill(0);
    this.onFire = 0; this.shock = 0; this.hurt = 0; this.bleed = 0; this.frozen = null;
    this.broken.clear();
    this.knockdown = 0;
  }

  /** Turn around: mirror the body across its spine so knees and elbows still bend the right way. */
  flip() {
    this.facing = -this.facing;
    const ax = this.x[P.PELVIS], ay = this.y[P.PELVIS];
    const sx = this.x[P.NECK] - ax, sy = this.y[P.NECK] - ay;
    const l2 = sx * sx + sy * sy || 1;
    for (let k = 0; k < N; k++) {
      for (const [X, Y] of [[this.x, this.y], [this.px, this.py]]) {
        const dx = X[k] - ax, dy = Y[k] - ay;
        const t = (dx * sx + dy * sy) / l2;
        X[k] = ax + 2 * sx * t - dx;
        Y[k] = ay + 2 * sy * t - dy;
      }
    }
  }

  // ------------------------------------------------------------------ inspector

  status() {
    if (!this.alive) return '💀 Dead';
    if (this.onFire > 0) return '🔥 On fire!';
    if (this.shock > 0) return '⚡ Being electrocuted';
    if (this.frozen) return '🧊 Frozen solid';
    if (this.oxygen < 600 && this.oxygen < 300) return '🫧 Drowning';
    if (this.health < 25) return '😵 Unconscious';
    if (this.grab >= 0) return '😨 Being carried';
    if (this.standing) return '🧍 Standing';
    if (this.knockdown > 0) return '😖 Knocked down';
    if (this.hurt > 0) return '😣 In pain';
    return '🙂 Fine';
  }

  describe() {
    const unit = this.game.settings.get('tempUnit');
    const t = unit === 'F' ? `${Math.round(this.temp * 9 / 5 + 32)} °F` : unit === 'K' ? `${Math.round(this.temp + 273.15)} K` : `${Math.round(this.temp)} °C`;
    const rows = [['Status', this.status()], ['Body temp', t]];
    if (this.broken.size) rows.push(['Broken', [...this.broken].map((k) => PART_NAMES[k]).join(', ')]);
    return {
      title: 'Ragdoll Human',
      subtitle: 'Reactive human · drag with the Hand tool',
      rows,
      bars: [
        { label: 'Health', value: this.health / 100, color: this.health > 50 ? 'var(--good)' : this.health > 20 ? 'var(--warn)' : 'var(--bad)' },
        { label: 'Air', value: this.oxygen / 600, color: 'var(--steel)' },
        { label: 'Burns', value: this.char, color: '#8a5a3a' },
      ],
      controls: [
        { type: 'button', id: 'heal', label: this.alive ? '❤ Heal' : '❤ Revive', primary: true, onClick: () => { this.heal(); this.game.audio?.play('chime'); } },
        { type: 'button', id: 'flip', label: '↔ Flip facing', onClick: () => this.flip() },
      ],
    };
  }

  // ------------------------------------------------------------------ persistence

  serialize() {
    return {
      type: 'ragdoll',
      pts: Array.from({ length: N }, (_, k) => [+this.x[k].toFixed(2), +this.y[k].toFixed(2)]),
      health: this.health, temp: this.temp, oxygen: this.oxygen, facing: this.facing,
      burnt: Array.from(this.burnt, (v) => +v.toFixed(3)), wound: Array.from(this.wound, (v) => +v.toFixed(3)),
      onFire: this.onFire, broken: [...this.broken], frozen: !!this.frozen,
    };
  }

  static deserialize(game, d) {
    if (!d || !Array.isArray(d.pts) || d.pts.length !== N) return null;
    const doll = new Ragdoll(game, 0, 0);
    for (let k = 0; k < N; k++) {
      const [x, y] = d.pts[k];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      doll.x[k] = doll.px[k] = doll.fx[k] = x;
      doll.y[k] = doll.py[k] = doll.fy[k] = y;
    }
    doll.health = clamp(Number(d.health) || 0, 0, 100);
    doll.temp = Number.isFinite(d.temp) ? d.temp : BODY_TEMP;
    doll.oxygen = Number.isFinite(d.oxygen) ? d.oxygen : 600;
    doll.facing = d.facing === -1 ? -1 : 1;
    if (Array.isArray(d.burnt) && d.burnt.length === N) d.burnt.forEach((v, k) => { doll.burnt[k] = clamp(Number(v) || 0, 0, 1); });
    if (Array.isArray(d.wound) && d.wound.length === N) d.wound.forEach((v, k) => { doll.wound[k] = clamp(Number(v) || 0, 0, 2); });
    doll.onFire = Number(d.onFire) || 0;
    if (Array.isArray(d.broken)) for (const k of d.broken) if (k >= 0 && k < N) doll.broken.add(k);
    if (d.frozen) doll.freeze();
    return doll;
  }

  // ------------------------------------------------------------------ rendering

  /**
   * Draw the body into its own canvas at RES pixels per world cell (much finer than the cell grid,
   * so it reads clearly), People Playground style: every part is a flat grey block with its own
   * darker outline, drawn back to front. Returns where to place it in world cells.
   */
  renderSprite(opts) {
    const b = this.bounds();
    const x0 = b.x0 - 1, y0 = b.y0 - 1;
    const cw = b.x1 - b.x0 + 3, ch = b.y1 - b.y0 + 3;
    if (cw <= 0 || ch <= 0 || cw > 300 || ch > 300) return null;
    const bw = cw * RES, bh = ch * RES;
    if (!this.canvas) this.canvas = document.createElement('canvas');
    const cvs = this.canvas;
    if (cvs.width !== bw || cvs.height !== bh || !this.image) {
      cvs.width = bw; cvs.height = bh;
      this.cctx = cvs.getContext('2d');
      this.image = this.cctx.createImageData(bw, bh);
      this.px32 = new Uint32Array(this.image.data.buffer);
    }
    const px = this.px32;
    px.fill(0);

    const heat = opts.heatView;
    const heatCol = heat ? HEAT_LUT[heatIndex(this.temp)] : 0;
    const skeleton = this.shock > 0 && ((opts.tick >> 1) & 1) === 0;
    const X = this.x, Y = this.y;
    const inv = 1 / RES;

    /** Colour of a part: grey, then burns, frost and drowning-blue; far limbs darker. */
    const tone = (base, a, c, shade = 1) => {
      let col = base;
      const burnt = (this.burnt[a] + this.burnt[c]) / 2;
      if (burnt > 0) col = mix(col, CHAR, Math.min(1, burnt) * 0.9);
      if (this.frozen) col = mix(col, ICE, 0.45);
      if (this.oxygen < 300) col = mix(col, BLUE, (300 - this.oxygen) / 700);
      return [col[0] * shade, col[1] * shade, col[2] * shade];
    };
    const pack = (c, k = 1) => rgb(clamp(c[0] * k, 0, 255) | 0, clamp(c[1] * k, 0, 255) | 0, clamp(c[2] * k, 0, 255) | 0);

    /** Oriented block from (ax, ay) to (bx, by) in world cells, half-width hw, extended e0 / e1 past each end. */
    const box = (ax, ay, bx, by, hw, e0, e1, fillC, lineC) => {
      let dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 0.001;
      dx /= len; dy /= len;
      const nx = -dy, ny = dx;
      const u0 = -e0, u1 = len + e1;
      const reach = (len + e0 + e1) / 2 + hw + 0.5;
      const cx = ax + dx * (u0 + u1) / 2, cy = ay + dy * (u0 + u1) / 2;
      const iy0 = Math.max(0, Math.floor((cy - reach - y0) * RES)), iy1 = Math.min(bh - 1, Math.ceil((cy + reach - y0) * RES));
      const ix0 = Math.max(0, Math.floor((cx - reach - x0) * RES)), ix1 = Math.min(bw - 1, Math.ceil((cx + reach - x0) * RES));
      for (let yy = iy0; yy <= iy1; yy++) {
        const qy = y0 + (yy + 0.5) * inv - ay;
        for (let xx = ix0; xx <= ix1; xx++) {
          const qx = x0 + (xx + 0.5) * inv - ax;
          const u = qx * dx + qy * dy, v = qx * nx + qy * ny;
          if (u < u0 || u > u1 || v < -hw || v > hw) continue;
          const edge = u - u0 < EDGE || u1 - u < EDGE || hw - Math.abs(v) < EDGE;
          px[yy * bw + xx] = heat ? heatCol : edge ? lineC : fillC;
        }
      }
    };
    const part = (a, c, hw, e0, e1, shade = 1) => {
      const col = tone(FILL, a, c, shade);
      box(X[a], Y[a], X[c], Y[c], hw, e0, e1, pack(col), pack(col, LINE_K));
    };
    /** The foot sticks out forward from the bottom of the shin (an L shape). */
    const foot = (knee, ankle, shade) => {
      let dx = X[ankle] - X[knee], dy = Y[ankle] - Y[knee];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      const fx = dy * this.facing, fy = -dx * this.facing;
      const sx = X[ankle] + dx * 0.3 - fx * 1.2, sy = Y[ankle] + dy * 0.3 - fy * 1.2;
      const col = tone(FILL, ankle, ankle, shade);
      box(sx, sy, sx + fx * 4.4, sy + fy * 4.4, 1.25, 0, 0, pack(col), pack(col, LINE_K));
    };
    const leg = (hip, knee, ankle, shade) => {
      foot(knee, ankle, shade);
      part(hip, knee, 2.1, 0.6, 0.6, shade);
      part(knee, ankle, 1.95, 0.5, 1.55, shade);
    };
    const arm = (elbow, hand, shade) => {
      part(P.NECK, elbow, 1.9, 0.7, 0.6, shade);
      part(elbow, hand, 1.8, 0.5, 1.1, shade);
    };

    if (skeleton) {
      const dark = pack([30, 34, 52]), bone = pack([240, 240, 228]);
      for (const [a, c] of BONES) box(X[a], Y[a], X[c], Y[c], TORSO.has(a) && TORSO.has(c) ? 3 : 1.9, 0.6, 0.6, dark, dark);
      box(X[P.HEAD], Y[P.HEAD] - HEAD_HALF, X[P.HEAD], Y[P.HEAD] + HEAD_HALF, HEAD_HALF, 0, 0, dark, dark);
      for (const [a, c] of BONES) box(X[a], Y[a], X[c], Y[c], 0.55, 0, 0, bone, bone);
      box(X[P.HEAD], Y[P.HEAD] - 2.2, X[P.HEAD], Y[P.HEAD] + 2.2, 2.2, 0, 0, bone, bone);
    } else {
      // Back to front: far arm and leg, torso, head, near leg, near arm (over the body, like PP).
      arm(P.FAR_ELBOW, P.FAR_HAND, FAR);
      leg(P.PELVIS, P.FAR_KNEE, P.FAR_FOOT, FAR);
      part(P.BELLY, P.PELVIS, 3.1, 0.4, 1.4);
      part(P.CHEST, P.BELLY, 3.0, 0.4, 0.4);
      part(P.NECK, P.CHEST, 3.1, 0.4, 0.6);
      this.drawHead(px, bw, bh, x0, y0, heatCol, tone, pack);
      leg(P.PELVIS, P.NEAR_KNEE, P.NEAR_FOOT, 1);
      arm(P.NEAR_ELBOW, P.NEAR_HAND, 1);
      if (!heat) this.drawWounds(px, bw, bh, x0, y0);
    }

    // Thin dark rim around the silhouette so he stands out against any background.
    for (let yy = 0; yy < bh; yy++) {
      for (let xx = 0; xx < bw; xx++) {
        const i = yy * bw + xx;
        if (px[i]) continue;
        if ((xx > 0 && px[i - 1] && px[i - 1] !== OUTLINE) || (xx < bw - 1 && px[i + 1] && px[i + 1] !== OUTLINE)
          || (yy > 0 && px[i - bw] && px[i - bw] !== OUTLINE) || (yy < bh - 1 && px[i + bw] && px[i + bw] !== OUTLINE)) px[i] = OUTLINE;
      }
    }
    this.cctx.putImageData(this.image, 0, 0);
    return { canvas: cvs, x: x0, y: y0, w: cw, h: ch };
  }

  /** Bruises and bloody wounds painted onto the parts that were hurt (stable from frame to frame). */
  drawWounds(px, bw, bh, x0, y0) {
    for (let k = 0; k < N; k++) {
      const w = this.wound[k];
      if (w < 0.08) continue;
      const p = PARENT[k];
      const ax = this.x[k], ay = this.y[k];
      const vx = this.x[p] - ax, vy = this.y[p] - ay;
      const l = Math.hypot(vx, vy) || 1;
      const nx = -vy / l, ny = vx / l;
      const marks = Math.min(16, Math.round(w * 12));
      for (let j = 0; j < marks; j++) {
        const t = hash2(k, j, this.seed) * (k === P.HEAD ? 0.2 : 0.75);
        const o = (hash2(k, j + 40, this.seed) - 0.5) * (TORSO.has(k) ? 4.4 : 2.4);
        const size = 1 + ((hash2(k, j + 80, this.seed) * 3) | 0);
        const cx = Math.floor((ax + vx * t + nx * o - x0) * RES), cy = Math.floor((ay + vy * t + ny * o - y0) * RES);
        const c = w < 0.3 ? rgb(150, 96, 122) : (j % 3 === 0 ? rgb(178, 30, 34) : w > 0.9 ? rgb(84, 8, 12) : rgb(128, 16, 22));
        for (let yy = cy; yy < cy + size; yy++) {
          for (let xx = cx; xx < cx + size; xx++) {
            if (xx < 0 || yy < 0 || xx >= bw || yy >= bh || !px[yy * bw + xx]) continue;
            px[yy * bw + xx] = c;
          }
        }
      }
    }
  }

  faceName() {
    if (!this.alive) return 'dead';
    if (this.onFire > 0 || this.shock > 0) return 'scream';
    if (this.frozen) return 'out';
    if (this.oxygen < 400) return 'drown';
    if (this.health < 25) return 'out';
    if (this.hurt > 0) return 'pain';
    const vy = this.y[P.HEAD] - this.py[P.HEAD], vx = this.x[P.HEAD] - this.px[P.HEAD];
    if (this.grab >= 0 || vy > 1.6 || Math.abs(vx) > 2) return 'scared';
    if (this.blink > 0) return 'blink';
    return 'calm';
  }

  /** Square head with cut corners and a single eye, like People Playground. */
  drawHead(px, bw, bh, x0, y0, heatCol, tone, pack) {
    const hx = this.x[P.HEAD], hy = this.y[P.HEAD];
    let ux = hx - this.x[P.NECK], uy = hy - this.y[P.NECK];
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul; // "up" along the neck
    const fwx = -uy * this.facing, fwy = ux * this.facing; // where the face points
    const c = tone(FILL, P.HEAD, P.HEAD);
    const fill = heatCol || pack(c), line = heatCol || pack(c, LINE_K), eye = heatCol || pack(c, 0.68);
    const face = this.faceName();
    const closed = face === 'blink' || face === 'out' || face === 'dead' || face === 'pain' || face === 'scream';
    const eyeTop = closed ? 0.7 : face === 'scared' ? 2.4 : 1.6;
    const HS = HEAD_HALF, corner = 1.1;
    const r = HS * 1.5;
    const inv = 1 / RES;
    const iy0 = Math.max(0, Math.floor((hy - r - y0) * RES)), iy1 = Math.min(bh - 1, Math.ceil((hy + r - y0) * RES));
    const ix0 = Math.max(0, Math.floor((hx - r - x0) * RES)), ix1 = Math.min(bw - 1, Math.ceil((hx + r - x0) * RES));
    for (let yy = iy0; yy <= iy1; yy++) {
      for (let xx = ix0; xx <= ix1; xx++) {
        const qx = x0 + (xx + 0.5) * inv - hx, qy = y0 + (yy + 0.5) * inv - hy;
        const f = qx * fwx + qy * fwy, u = qx * ux + qy * uy;
        const af = Math.abs(f), au = Math.abs(u);
        if (af > HS || au > HS) continue;
        // Rounded corners
        const cf = af - (HS - corner), cu = au - (HS - corner);
        if (cf > 0 && cu > 0 && cf * cf + cu * cu > corner * corner) continue;
        const edge = HS - af < EDGE || HS - au < EDGE || (cf > 0 && cu > 0 && cf * cf + cu * cu > (corner - EDGE) * (corner - EDGE));
        let col = edge ? line : fill;
        if (!edge && f >= 0.8 && f < 2.4 && u >= -0.1 && u < eyeTop) col = eye;
        px[yy * bw + xx] = col;
      }
    }
  }
}

/** Palette icon for the ragdoll. */
export function drawRagdollIcon(canvas) {
  const doll = new Ragdoll({ world: { w: 60, h: 60 } }, 30, 30);
  const s = doll.renderSprite({ tick: 1, heatView: false });
  const size = Math.max(s.canvas.width, s.canvas.height);
  canvas.width = size; canvas.height = size;
  canvas.getContext('2d').drawImage(s.canvas, (size - s.canvas.width) / 2, (size - s.canvas.height) / 2);
}
