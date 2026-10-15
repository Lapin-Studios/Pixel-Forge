// Cooling: powered Peltier cooling-element cells and the self-contained cooling station.
import { formatTemp, rng } from '../utils/MathUtils.js';
import { WorldObject, MASK, shapeFromFn } from '../objects/WorldObject.js';
import { radiateArea } from './Heater.js';

export const COOLER_INFO = {
  cooling_station: { name: 'Cooling Station', desc: 'Refrigerated quench station. Chills everything within 10 cells toward 5°C — park hot moulds or castings next to it.' },
};

export function updateCoolingElement(sim, i, x, y, m) {
  const world = sim.world;
  if (!world.power[i]) return true;
  world.wake(i);
  const t = world.temp[i];
  if (t > -60) world.temp[i] = t + (-60 - t) * 0.06;
  return true;
}

export class CoolingStation extends WorldObject {
  constructor(game) {
    const W = 16, H = 12;
    const shape = shapeFromFn(game.registry, W, H, (x, y) => {
      if (y <= 3) return x % 2 === 0 ? { k: MASK.WALL, mat: 'aluminum' } : null; // fins
      if (y >= 5 && y <= 8 && x >= 2 && x <= 13) return { k: MASK.WALL, mat: 'cooling_element' };
      return { k: MASK.WALL, mat: 'aluminum' };
    });
    super(game, { type: 'cooling_station', name: 'Cooling Station', ...shape, heavy: true, impactSound: 'clink' });
    this.category = 'Machine';
    this.isMachine = true;
    this.on = true;
    this.radius = 10;
    this.target = 5;
  }

  update(ctx) {
    if (this.on) {
      const [cx, cy] = this.localToWorld(this.w / 2, this.h / 2);
      radiateArea(ctx, this, cx, cy, this.radius, this.target, 0.03, 0.01, false);
      const { mask, temp } = this;
      for (let li = 0; li < mask.length; li++) if (mask[li] === MASK.WALL) temp[li] += (this.target - 10 - temp[li]) * 0.05;
      if (ctx.fx && rng() < 0.05) {
        const [fx, fy] = this.localToWorld(rng() * this.w, 0);
        ctx.fx.frost(fx, fy);
      }
    }
    if ((this.age++ & 15) === 0) this.checkWalls(ctx);
  }

  describe() {
    const unit = this.game.settings?.get('tempUnit');
    return {
      title: 'Cooling Station',
      subtitle: 'Machine · refrigerated quench',
      rows: [['Status', this.on ? 'Cooling' : 'Off'], ['Plate temp', formatTemp(this.avgTemp('wall'), unit)]],
      controls: [
        { type: 'toggle', id: 'on', label: 'Compressor', value: this.on, onChange: (v) => { this.on = v; } },
        { type: 'slider', id: 'target', label: 'Target temperature', min: -40, max: 60, step: 1, value: this.target, format: (v) => formatTemp(v, unit), onChange: (v) => { this.target = v; } },
      ],
    };
  }

  hint() {
    return 'Cools everything within 10 cells — park hot castings next to it';
  }

  saveState() { return { on: this.on, target: this.target }; }
  loadState(s) { if (s) { this.on = s.on ?? true; this.target = s.target ?? 5; } }
}
