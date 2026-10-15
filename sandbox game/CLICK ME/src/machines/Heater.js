// Heating: powered nichrome heating-element cells, igniters, and the fuel-burning space heater.
import { rng, formatTemp } from '../utils/MathUtils.js';
import { Container } from '../objects/Container.js';
import { MASK, shapeFromFn } from '../objects/WorldObject.js';
import { consumeHopperFuel, hopperFuelCells } from './Furnace.js';

export const HEATER_INFO = {
  fuel_heater: { name: 'Fuel Heater', desc: 'Iron stove that radiates heat (up to 700°C) to everything within 10 cells. Feed fuel into its top hopper.' },
};

export function updateHeatingElement(sim, i, x, y, m) {
  const world = sim.world;
  if (!world.power[i]) return true;
  world.wake(i);
  const t = world.temp[i];
  if (t < 1100) world.temp[i] = t + (1100 - t) * 0.06;
  return true;
}

/** Electric stove: heats toward 260°C while powered, and warms whatever sits right on top of it. */
export function updateStove(sim, i, x, y, m) {
  const world = sim.world;
  if (!world.power[i]) return true;
  world.wake(i);
  const t = world.temp[i];
  if (t < 260) world.temp[i] = t + (260 - t) * 0.08;
  if (y > 0) {
    const j = i - world.w;
    const om = world.objMask[j];
    if (om !== 0) {
      const o = sim.game.objects.byId.get(Math.abs(om));
      if (o) {
        const li = world.objLocal[j];
        if (o.temp[li] < 260) o.temp[li] += (260 - o.temp[li]) * 0.05;
      }
    } else if (world.cells[j] !== 0 && world.temp[j] < 260) {
      world.temp[j] += (260 - world.temp[j]) * 0.03;
      world.wake(j);
    }
  }
  return true;
}

export function updateIgniter(sim, i, x, y, m) {
  const world = sim.world, reg = sim.reg;
  if (!world.power[i]) return true;
  world.wake(i);
  if (world.temp[i] < 900) world.temp[i] += 40;
  if (rng() > 0.25) return true;
  const w = world.w, h = world.h;
  const dirs = [[0, -1], [1, 0], [-1, 0], [0, 1]];
  const [dx, dy] = dirs[(rng() * 4) | 0];
  const nx = x + dx, ny = y + dy;
  if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true;
  const j = ny * w + nx;
  if (world.cells[j] === 0 && world.objMask[j] === 0) {
    world.setCell(j, reg.FIRE, 950);
    if (rng() < 0.2) sim.fx?.sparks(nx, ny, 2, 1400);
  } else if (world.objMask[j] === 0) {
    world.temp[j] += 60;
    world.wake(j);
  }
  return true;
}

/** Push temperature of world cells and object cells within radius r of (cx, cy) toward target. */
export function radiateArea(ctx, self, cx, cy, r, target, rate, objRate, onlyIfBelow) {
  const world = ctx.world;
  const W = world.w, H = world.h;
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  const { temp, objMask, objLocal, cells } = world;
  const invCap = world.reg.invCap;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
      if (d2 > r2) continue;
      const f = 1 - Math.sqrt(d2) / r;
      const i = y * W + x;
      const om = objMask[i];
      if (om === 0) {
        const t = temp[i];
        if (onlyIfBelow ? t < target : t > target) {
          temp[i] = t + (target - t) * rate * f * invCap[cells[i]];
          world.wake(i);
        }
      } else if (om !== self.id && om !== -self.id) {
        const o = ctx.objects.byId.get(Math.abs(om));
        if (!o) continue;
        const lj = objLocal[i];
        const t = o.temp[lj];
        if (onlyIfBelow ? t < target : t > target) o.temp[lj] = t + (target - t) * objRate * f;
      }
    }
  }
}

export class FuelHeater extends Container {
  constructor(game) {
    const W = 12, H = 14;
    const shape = shapeFromFn(game.registry, W, H, (x, y) => {
      if (y <= 4 && x >= 3 && x <= 8) return { k: MASK.HOPPER };
      if (y <= 4 && (x < 2 || x > 9)) return null;
      if (y >= 7 && y <= 10 && x >= 3 && x <= 8) return { k: MASK.WALL, mat: 'firebrick' }; // fire window
      return { k: MASK.WALL, mat: 'iron' };
    });
    super(game, { type: 'fuel_heater', name: 'Fuel Heater', category: 'Machine', ...shape, heavy: true, impactSound: 'clink' });
    this.isMachine = true;
    this.on = true;
    this.fuel = 60 * 60;
    this.maxFuel = 60 * 60 * 3;
    this.burning = false;
    this.radius = 10;
    this.target = 700;
  }

  accepts(m, li) {
    if (li !== undefined && this.mask[li] !== MASK.HOPPER) return false;
    return this.reg.fuel[m] > 0;
  }

  update(ctx) {
    this.simulateContents(ctx);
    if (this.fuel < this.maxFuel - 3000) this.fuel += consumeHopperFuel(this);
    this.burning = this.on && this.fuel > 0;
    if (this.burning) {
      this.fuel -= 1;
      const [cx, cy] = this.localToWorld(this.w / 2, 9);
      radiateArea(ctx, this, cx, cy, this.radius, this.target, 0.02, 0.006, true);
      // The fire window itself glows.
      for (let y = 7; y <= 10; y++) for (let x = 3; x <= 8; x++) {
        const li = y * this.w + x;
        this.temp[li] += (this.target + 100 - this.temp[li]) * 0.05;
      }
      if (ctx.fx && rng() < 0.2) {
        const [fx, fy] = this.localToWorld(3 + rng() * 6, 8 + rng() * 2);
        ctx.fx.flame(fx, fy, 900);
      }
    }
    if ((this.age++ & 15) === 0) this.checkWalls(ctx);
  }

  describe() {
    const unit = this.game.settings?.get('tempUnit');
    return {
      title: 'Fuel Heater',
      subtitle: 'Machine · radiant heater',
      rows: [
        ['Status', this.burning ? 'Burning' : this.fuel > 0 ? 'Off' : 'Out of fuel'],
        ['Fuel', `${Math.round(this.fuel / 60)} s + ${hopperFuelCells(this)} cells in hopper`],
        ['Body temp', formatTemp(this.avgTemp('wall'), unit)],
      ],
      bars: [{ label: 'Fuel', value: this.fuel / this.maxFuel, color: '#e0a23a' }],
      controls: [
        { type: 'toggle', id: 'on', label: 'Burner', value: this.on, onChange: (v) => { this.on = v; } },
        { type: 'slider', id: 'target', label: 'Output temperature', min: 100, max: 700, step: 10, value: this.target, format: (v) => formatTemp(v, unit), onChange: (v) => { this.target = v; } },
      ],
    };
  }

  hint() {
    return 'Feed fuel into the top hopper · heats everything within 10 cells';
  }

  saveState() { return { on: this.on, fuel: this.fuel, target: this.target }; }
  loadState(s) { if (s) { this.on = s.on ?? true; this.fuel = s.fuel ?? this.fuel; this.target = s.target ?? this.target; } }
}
