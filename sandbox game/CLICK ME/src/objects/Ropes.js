// Pins and ropes. A pin is a fixed anchor in the world. A rope ties two things together — pins,
// objects (at a point on their body) or ragdoll parts — and never lets them get further apart
// than its length, so whatever hangs from it swings like a pendulum. Pinning an object or a body
// part directly holds it at that spot (an object can still swivel around the pin).
import { clamp } from '../utils/MathUtils.js';
import { collides } from '../physics/ObjectPhysics.js';
import { MASK } from './WorldObject.js';

const NODE_GAP = 2;      // cells between the rope's visual nodes
const ROPE_GRAVITY = 0.06;

export class RopeSystem {
  constructor(objects) {
    this.objects = objects;
    this.pins = [];
    this.ropes = [];
  }

  get game() { return this.objects.game; }

  reset() {
    this.pins = [];
    this.ropes = [];
  }

  // ------------------------------------------------------------------ building

  addPin(x, y) {
    const p = { x, y };
    this.pins.push(p);
    return p;
  }

  pinNear(wx, wy, r = 1.8) {
    let best = null, bd = r;
    for (const p of this.pins) {
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d <= bd) { bd = d; best = p; }
    }
    return best;
  }

  /** What's under (wx, wy) to tie a rope to (pin, ragdoll part, object point), or null. */
  attachmentAt(wx, wy) {
    const pin = this.pinNear(wx, wy);
    if (pin) return { kind: 'pin', pin };
    const hit = this.objects.dollAt(wx, wy, 2.5);
    if (hit) return { kind: 'doll', doll: hit.doll, k: hit.k };
    const o = this.objects.objectAt(wx, wy, 1);
    if (o) {
      const [lx, ly] = o.worldToLocal(wx, wy);
      return { kind: 'obj', obj: o, lx, ly };
    }
    return null;
  }

  pos(a) {
    if (a.kind === 'pin') return [a.pin.x, a.pin.y];
    if (a.kind === 'doll') return [a.doll.x[a.k], a.doll.y[a.k]];
    return a.obj.localToWorld(a.lx, a.ly);
  }

  aliveAtt(a) {
    if (a.kind === 'pin') return this.pins.includes(a.pin);
    if (a.kind === 'doll') return !a.doll.dead;
    return !a.obj.dead;
  }

  sameThing(a, b) {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'pin') return a.pin === b.pin;
    if (a.kind === 'doll') return a.doll === b.doll;
    return a.obj === b.obj;
  }

  addRope(a, b, len) {
    const [ax, ay] = this.pos(a), [bx, by] = this.pos(b);
    const d = Math.hypot(bx - ax, by - ay);
    const L = Math.max(0, len ?? d);
    const n = Math.max(2, Math.min(80, Math.ceil(L / NODE_GAP) + 1));
    const rope = { a, b, len: L, nx: new Float32Array(n), ny: new Float32Array(n), opx: new Float32Array(n), opy: new Float32Array(n), hidden: L < 0.5 };
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      rope.nx[i] = rope.opx[i] = ax + (bx - ax) * t;
      rope.ny[i] = rope.opy[i] = ay + (by - ay) * t;
    }
    this.ropes.push(rope);
    return rope;
  }

  /**
   * Pin tool: on a ragdoll part or an object, nail it to the world right there; elsewhere place a
   * bare pin to hang ropes from. Returns a short description for the toast.
   */
  placePin(wx, wy) {
    const hit = this.objects.dollAt(wx, wy, 2.5);
    if (hit) {
      const p = this.addPin(hit.doll.x[hit.k], hit.doll.y[hit.k]);
      this.addRope({ kind: 'pin', pin: p }, { kind: 'doll', doll: hit.doll, k: hit.k }, 0);
      return 'Pinned the ragdoll';
    }
    const o = this.objects.objectAt(wx, wy, 0);
    if (o) {
      const p = this.addPin(wx, wy);
      const [lx, ly] = o.worldToLocal(wx, wy);
      this.addRope({ kind: 'pin', pin: p }, { kind: 'obj', obj: o, lx, ly }, 0);
      return `Pinned the ${o.name.toLowerCase()} — it can swivel around the pin`;
    }
    this.addPin(wx, wy);
    return 'Pin placed — tie ropes to it with the Rope tool';
  }

  /** Remove the pin or rope nearest to (wx, wy). Returns true if something was removed. */
  removeAt(wx, wy) {
    const pin = this.pinNear(wx, wy, 2.2);
    if (pin) {
      this.pins.splice(this.pins.indexOf(pin), 1);
      this.ropes = this.ropes.filter((r) => !(r.a.kind === 'pin' && r.a.pin === pin) && !(r.b.kind === 'pin' && r.b.pin === pin));
      return true;
    }
    let best = -1, bd = 2.2;
    this.ropes.forEach((r, idx) => {
      for (let i = 0; i < r.nx.length; i++) {
        const d = Math.hypot(r.nx[i] - wx, r.ny[i] - wy);
        if (d < bd) { bd = d; best = idx; }
      }
    });
    if (best >= 0) { this.ropes.splice(best, 1); return true; }
    return false;
  }

  /** Drop ropes tied to something that was deleted. */
  prune() {
    if (this.ropes.some((r) => !this.aliveAtt(r.a) || !this.aliveAtt(r.b))) {
      this.ropes = this.ropes.filter((r) => this.aliveAtt(r.a) && this.aliveAtt(r.b));
    }
  }

  // ------------------------------------------------------------------ physics

  invMass(a) {
    if (a.kind === 'pin') return 0;
    if (a.kind === 'doll') return a.doll.grab === a.k ? 0 : 1;
    const o = a.obj;
    if (o.held || o.anchored) return 0;
    return 1 / Math.max(1, (o.massCells || (o.massCells = countBody(o))) / 40);
  }

  step() {
    this.prune();
    if (!this.ropes.length) return;
    const moved = new Set();
    for (const r of this.ropes) {
      for (let it = 0; it < 2; it++) this.constrain(r, moved);
    }
    for (const r of this.ropes) this.swing(r);
    for (const o of moved) this.objects.restamp(o);
    for (const r of this.ropes) this.simulateNodes(r);
  }

  /** Pull the two ends back to within the rope's length (mass-weighted), killing outward speed. */
  constrain(r, moved) {
    const [ax, ay] = this.pos(r.a), [bx, by] = this.pos(r.b);
    const dx = bx - ax, dy = by - ay;
    const d = Math.hypot(dx, dy);
    if (d <= r.len + 0.02 || d < 1e-4) return;
    const wa = this.invMass(r.a), wb = this.invMass(r.b), ws = wa + wb;
    if (ws === 0) return;
    const nx = dx / d, ny = dy / d;
    const excess = d - r.len;
    this.shift(r.a, nx * excess * (wa / ws), ny * excess * (wa / ws), -nx, -ny, moved);
    this.shift(r.b, -nx * excess * (wb / ws), -ny * excess * (wb / ws), nx, ny, moved);
  }

  /** Move an attachment by (dx, dy); (ox, oy) points away from the other end of the rope. */
  shift(a, dx, dy, ox, oy, moved) {
    if (!dx && !dy) return;
    if (a.kind === 'doll') {
      a.doll.x[a.k] += dx;
      a.doll.y[a.k] += dy;
      return;
    }
    if (a.kind !== 'obj') return;
    const o = a.obj;
    const ctx = this.objects.syncCtx();
    const px = o.x, py = o.y;
    o.x += dx; o.y += dy;
    if (collides(o, o.ox, o.oy, ctx, o.isItem)) {
      o.x = px + dx * 0.5; o.y = py + dy * 0.5;
      if (collides(o, o.ox, o.oy, ctx, o.isItem)) { o.x = px; o.y = py; }
    }
    // Tension removes the speed carrying it away from the anchor: what's left is the swing.
    const away = o.vx * ox + o.vy * oy;
    if (away > 0) { o.vx -= away * ox; o.vy -= away * oy; }
    if (o.ox !== Math.round(px) || o.oy !== Math.round(py)) moved.add(o);
    o.ropeTick = this.game.sim.tick;
  }

  /** A hanging object turns so its centre of mass sits below the point the rope holds. */
  swing(r) {
    for (const [att, other] of [[r.a, r.b], [r.b, r.a]]) {
      if (att.kind !== 'obj') continue;
      const o = att.obj;
      if (o.held || o.anchored || o.resting) { o.ropeSpin = 0; continue; }
      const [px, py] = this.pos(att);
      const [qx, qy] = this.pos(other);
      let tx = px - qx, ty = py - qy;
      const tl = Math.hypot(tx, ty);
      if (tl < 0.5 * Math.max(1, r.len) && r.len > 0.5) continue; // rope is slack
      if (tl < 1e-3) { tx = 0; ty = 1; } else { tx /= tl; ty /= tl; }
      const com = centreOfMass(o);
      const [cx, cy] = o.localToWorld(com[0], com[1]);
      const vx = cx - px, vy = cy - py;
      if (Math.hypot(vx, vy) < 0.5) continue;
      const diff = Math.atan2(vx * ty - vy * tx, vx * tx + vy * ty);
      o.ropeSpin = clamp((o.ropeSpin || 0) * 0.94 + diff * 0.01, -0.08, 0.08);
      o.angVel = 0;
      if (Math.abs(o.ropeSpin) < 1e-4) continue;
      rotateAboutLocal(o, o.ropeSpin, att.lx, att.ly, this.objects.syncCtx());
    }
  }

  /** Visual rope: a light verlet chain hanging between the two ends, sagging when slack. */
  simulateNodes(r) {
    const n = r.nx.length;
    const [ax, ay] = this.pos(r.a), [bx, by] = this.pos(r.b);
    const seg = r.len / (n - 1);
    const X = r.nx, Y = r.ny;
    for (let i = 1; i < n - 1; i++) {
      const vx = (X[i] - r.opx[i]) * 0.97, vy = (Y[i] - r.opy[i]) * 0.97 + ROPE_GRAVITY;
      r.opx[i] = X[i]; r.opy[i] = Y[i];
      X[i] += vx; Y[i] += vy;
    }
    X[0] = ax; Y[0] = ay; X[n - 1] = bx; Y[n - 1] = by;
    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < n - 1; i++) {
        const dx = X[i + 1] - X[i], dy = Y[i + 1] - Y[i];
        const d = Math.hypot(dx, dy);
        if (d <= seg || d < 1e-5) continue;
        const c = (d - seg) / d;
        const fa = i === 0 ? 0 : (i + 1 === n - 1 ? 1 : 0.5), fb = i + 1 === n - 1 ? 0 : (i === 0 ? 1 : 0.5);
        X[i] += dx * c * fa; Y[i] += dy * c * fa;
        X[i + 1] -= dx * c * fb; Y[i + 1] -= dy * c * fb;
      }
      X[0] = ax; Y[0] = ay; X[n - 1] = bx; Y[n - 1] = by;
    }
    // A slack rope lies on the ground instead of sinking through it. A taut rope is a straight pull,
    // so it's left alone, and the rope never snags on objects (including the one it's tied to).
    if (Math.hypot(bx - ax, by - ay) > r.len * 0.95) return;
    const world = this.game.world, state = this.game.registry.state;
    for (let i = 1; i < n - 1; i++) {
      const cx = Math.floor(X[i]), cy = Math.floor(Y[i]);
      if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) continue;
      const m = world.cells[cy * world.w + cx];
      if (m && state[m] <= 2) {
        const pcx = Math.floor(r.opx[i]), pcy = Math.floor(r.opy[i]);
        const pm = pcx >= 0 && pcy >= 0 && pcx < world.w && pcy < world.h ? world.cells[pcy * world.w + pcx] : 0;
        if (!(pm && state[pm] <= 2)) { X[i] = r.opx[i]; Y[i] = r.opy[i]; }
      }
    }
  }

  // ------------------------------------------------------------------ persistence

  serialize(objList, dollList) {
    const ref = (a) => {
      if (a.kind === 'pin') return { kind: 'pin', i: this.pins.indexOf(a.pin) };
      if (a.kind === 'doll') return { kind: 'doll', i: dollList.indexOf(a.doll), k: a.k };
      return { kind: 'obj', i: objList.indexOf(a.obj), lx: +a.lx.toFixed(2), ly: +a.ly.toFixed(2) };
    };
    return [
      ...this.pins.map((p) => ({ type: 'pin', x: +p.x.toFixed(2), y: +p.y.toFixed(2) })),
      ...this.ropes.map((r) => ({ type: 'rope', len: +r.len.toFixed(2), a: ref(r.a), b: ref(r.b) })),
    ];
  }

  /** Rebuild a rope from saved refs; objs / dolls are the loaded lists in saved order. */
  loadRope(d, objs, dolls) {
    const att = (ref) => {
      if (!ref) return null;
      if (ref.kind === 'pin') { const pin = this.pins[ref.i]; return pin ? { kind: 'pin', pin } : null; }
      if (ref.kind === 'doll') { const doll = dolls[ref.i]; return doll && ref.k >= 0 && ref.k < doll.x.length ? { kind: 'doll', doll, k: ref.k } : null; }
      const obj = objs[ref.i];
      return obj && Number.isFinite(ref.lx) && Number.isFinite(ref.ly) ? { kind: 'obj', obj, lx: ref.lx, ly: ref.ly } : null;
    };
    const a = att(d.a), b = att(d.b);
    if (!a || !b || !Number.isFinite(d.len)) return false;
    this.addRope(a, b, d.len);
    return true;
  }

  // ------------------------------------------------------------------ drawing

  draw(ctx, lw) {
    if (!this.ropes.length && !this.pins.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of this.ropes) {
      if (r.hidden) continue;
      ctx.strokeStyle = '#3a2a18';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(r.nx[0], r.ny[0]);
      for (let i = 1; i < r.nx.length; i++) ctx.lineTo(r.nx[i], r.ny[i]);
      ctx.stroke();
      ctx.strokeStyle = '#a07a46';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    for (const p of this.pins) {
      ctx.fillStyle = '#2a2a30';
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d4d6de';
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.75, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6a6c76';
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

function countBody(o) {
  let c = 0;
  for (let i = 0; i < o.mask.length; i++) if (o.mask[i] === MASK.WALL || o.mat[i]) c++;
  return c;
}

/** Centre of mass in local coordinates (body + contents), cached per shape. */
function centreOfMass(o) {
  if (o._com && o._comV === o.maskVersion && (o._comT || 0) > (o.game.sim.tick - 30)) return o._com;
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < o.mask.length; i++) {
    if (o.mask[i] !== MASK.WALL && !o.mat[i]) continue;
    sx += (i % o.w) + 0.5; sy += ((i / o.w) | 0) + 0.5; n++;
  }
  o._com = n ? [sx / n, sy / n] : [o.w / 2, o.h / 2];
  o._comV = o.maskVersion;
  o._comT = o.game.sim.tick;
  return o._com;
}

/** Rotate o by dA keeping local point (lx, ly) fixed in the world; reverts if it would collide. */
function rotateAboutLocal(o, dA, lx, ly, ctx) {
  const [px, py] = o.localToWorld(lx, ly);
  const pa = o.angle, ox = o.x, oy = o.y;
  o.angle += dA;
  const [qx, qy] = o.localToWorld(lx, ly);
  o.x += px - qx; o.y += py - qy;
  if (collides(o, o.ox, o.oy, ctx, o.isItem)) {
    o.angle = pa; o.x = ox; o.y = oy;
    o.ropeSpin = 0;
    return false;
  }
  o.dirtyStamp = true;
  return true;
}
