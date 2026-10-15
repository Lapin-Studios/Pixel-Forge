// Purely visual particles (sparks, splashes, steam, smoke). Capped pool — never affects the simulation.
import { rng, clamp } from '../utils/MathUtils.js';

const F_ADD = 1, F_GRAV = 2, F_DRAG = 4, F_RISE = 8;

export class Particles {
  constructor(max = 2400) {
    this.max = max;
    this.n = 0;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.r = new Uint8Array(max);
    this.g = new Uint8Array(max);
    this.b = new Uint8Array(max);
    this.size = new Float32Array(max);
    this.flags = new Uint8Array(max);
    this.enabled = true;
    this.density = 1;
  }

  clear() { this.n = 0; }

  spawn(x, y, vx, vy, life, r, g, b, size, flags) {
    if (!this.enabled) return;
    let i;
    if (this.n < this.max) i = this.n++;
    else i = (rng() * this.max) | 0; // recycle a random particle instead of growing
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.maxLife[i] = life;
    this.r[i] = r; this.g[i] = g; this.b[i] = b;
    this.size[i] = size; this.flags[i] = flags;
  }

  count(n) {
    const c = n * this.density;
    return Math.floor(c) + (rng() < c % 1 ? 1 : 0);
  }

  sparks(x, y, n = 3, temp = 1200) {
    const hot = clamp((temp - 600) / 1400, 0, 1);
    for (let k = this.count(n); k > 0; k--) {
      const a = -Math.PI / 2 + (rng() - 0.5) * 2.2;
      const s = 0.25 + rng() * 0.8;
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.25 + rng() * 0.4, 255, 150 + hot * 100, 40 + hot * 150, 0.5 + rng() * 0.5, F_ADD | F_GRAV);
    }
  }

  splash(x, y, n, r, g, b) {
    for (let k = this.count(n); k > 0; k--) {
      const a = -Math.PI / 2 + (rng() - 0.5) * 1.8;
      const s = 0.3 + rng() * 0.6;
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.5 + rng() * 0.4, r, g, b, 0.8, F_GRAV);
    }
  }

  steam(x, y, n = 2) {
    for (let k = this.count(n); k > 0; k--) {
      this.spawn(x + rng() - 0.5, y, (rng() - 0.5) * 0.3, -0.2 - rng() * 0.4, 0.8 + rng() * 1.2, 230, 236, 242, 1.5 + rng() * 2, F_DRAG | F_RISE);
    }
  }

  smoke(x, y, n = 2) {
    for (let k = this.count(n); k > 0; k--) {
      this.spawn(x, y, (rng() - 0.5) * 0.3, -0.15 - rng() * 0.25, 1.2 + rng() * 1.5, 55, 50, 46, 2 + rng() * 2, F_DRAG | F_RISE);
    }
  }

  embers(x, y, n = 1) {
    for (let k = this.count(n); k > 0; k--) {
      this.spawn(x, y, (rng() - 0.5) * 0.6, -0.3 - rng() * 0.6, 1 + rng() * 1.5, 255, 120, 30, 0.6, F_ADD | F_DRAG);
    }
  }

  flame(x, y, temp = 1000) {
    const hot = clamp((temp - 800) / 1000, 0, 1);
    this.spawn(x, y, (rng() - 0.5) * 0.3, -0.4 - rng() * 0.6, 0.3 + rng() * 0.4, 255, 110 + hot * 120, 20 + hot * 80, 1 + rng() * 1.2, F_ADD | F_DRAG | F_RISE);
  }

  arc(x, y) {
    for (let k = 0; k < 2; k++) {
      this.spawn(x, y, (rng() - 0.5) * 1.2, -rng() * 1.2, 0.15 + rng() * 0.2, 160, 210, 255, 0.6, F_ADD);
    }
  }

  frost(x, y) {
    this.spawn(x, y, (rng() - 0.5) * 0.2, 0.1 + rng() * 0.2, 1 + rng(), 200, 235, 255, 0.8, F_DRAG);
  }

  fizz(x, y) {
    this.spawn(x + 0.5, y, (rng() - 0.5) * 0.2, -0.3 - rng() * 0.3, 0.4 + rng() * 0.4, 190, 255, 140, 0.6, F_DRAG);
  }

  dust(x, y, n = 4, spread = 4) {
    for (let k = this.count(n); k > 0; k--) {
      this.spawn(x + (rng() - 0.5) * spread * 2, y - 0.5, (rng() - 0.5) * 0.35, -rng() * 0.2, 0.35 + rng() * 0.3, 150, 140, 125, 1, F_DRAG);
    }
  }

  sparkle(x, y) {
    for (let k = 0; k < 18; k++) {
      const a = rng() * Math.PI * 2, s = 0.3 + rng() * 1.2;
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.6 + rng() * 0.6, 255, 225, 120, 0.8, F_ADD | F_DRAG);
    }
  }

  explosion(x, y, power) {
    const n = Math.min(80, power * 8);
    for (let k = this.count(n); k > 0; k--) {
      const a = rng() * Math.PI * 2, s = 0.5 + rng() * power * 0.5;
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.3 + rng() * 0.8, 255, 180 + rng() * 75, 80, 0.8 + rng(), F_ADD | F_GRAV | F_DRAG);
    }
    this.smoke(x, y, power);
  }

  /** Let falling particles collide with solid ground (purely cosmetic). */
  setWorld(world, state) {
    this.world = world;
    this.stateLut = state;
  }

  /** dt in seconds. Velocities are cells per frame at 60fps. */
  update(dt) {
    const k = dt * 60;
    let n = this.n;
    const world = this.world, lut = this.stateLut;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        if (i !== n) this.copy(n, i);
        i--;
        continue;
      }
      const f = this.flags[i];
      if (f & F_GRAV) this.vy[i] += 0.06 * k;
      if (f & F_RISE) this.vy[i] -= 0.004 * k;
      if (f & F_DRAG) { this.vx[i] *= 1 - 0.04 * k; this.vy[i] *= 1 - 0.02 * k; }
      this.x[i] += this.vx[i] * k;
      this.y[i] += this.vy[i] * k;
      if ((f & F_GRAV) && world) {
        const cx = this.x[i] | 0, cy = this.y[i] | 0;
        if (cx >= 0 && cy >= 0 && cx < world.w && cy < world.h) {
          const idx = cy * world.w + cx;
          const m = world.cells[idx];
          if ((m !== 0 && lut[m] <= 2) || world.objMask[idx] > 0) {
            // Hit the ground: stop dead (no bouncing around) and fade out.
            this.y[i] -= this.vy[i] * k;
            this.vy[i] = 0;
            this.vx[i] = 0;
            this.flags[i] &= ~F_GRAV;
            this.life[i] = Math.min(this.life[i], 0.12);
          }
        }
      }
    }
    this.n = n;
  }

  copy(from, to) {
    this.x[to] = this.x[from]; this.y[to] = this.y[from];
    this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.r[to] = this.r[from]; this.g[to] = this.g[from]; this.b[to] = this.b[from];
    this.size[to] = this.size[from]; this.flags[to] = this.flags[from];
  }

  /** ctx must already be transformed into world space. */
  draw(ctx) {
    if (!this.n) return;
    ctx.save();
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalCompositeOperation = pass === 0 ? 'source-over' : 'lighter';
      for (let i = 0; i < this.n; i++) {
        const add = (this.flags[i] & F_ADD) !== 0;
        if ((pass === 1) !== add) continue;
        const t = this.life[i] / this.maxLife[i];
        const a = add ? t : t * 0.55;
        ctx.fillStyle = `rgba(${this.r[i]},${this.g[i]},${this.b[i]},${a.toFixed(3)})`;
        const s = this.size[i] * (add ? 1 : 1 + (1 - t));
        ctx.fillRect(this.x[i] - s / 2, this.y[i] - s / 2, s, s);
      }
    }
    ctx.restore();
  }
}
