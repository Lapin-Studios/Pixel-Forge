// Furnaces heat the open chamber inside them. Anything in the chamber (air, loose cells and
// objects such as crucibles) is driven toward the target temperature while the furnace burns.
import { Container } from '../objects/Container.js';
import { MASK, shapeFromFn } from '../objects/WorldObject.js';
import { rng, formatTemp } from '../utils/MathUtils.js';

export const FURNACE_INFO = {
  furnace: { name: 'Furnace', desc: 'Fuel-fired firebrick furnace (max 1650°C). Drop coal, charcoal, coke, wood or oil into the hopper on the left, then lower a crucible into the chamber.' },
  electric_furnace: { name: 'Electric Furnace', desc: 'Induction furnace (max 2400°C). Needs power: run wire from a battery (through a switch) to the copper terminal on its lower-left side.' },
};

const FUEL_TICKS = 300; // burn ticks per fuel point

/** Pull one fuel cell out of the hopper; returns fuel ticks gained. */
export function consumeHopperFuel(obj) {
  const reg = obj.reg;
  const { mask, mat } = obj;
  for (let li = mask.length - 1; li >= 0; li--) {
    if (mask[li] !== MASK.HOPPER) continue;
    const m = mat[li];
    if (m && reg.fuel[m] > 0) {
      mat[li] = 0;
      return reg.fuel[m] * FUEL_TICKS;
    }
  }
  return 0;
}

export function hopperFuelCells(obj) {
  let c = 0;
  for (let li = 0; li < obj.mask.length; li++) if (obj.mask[li] === MASK.HOPPER && obj.mat[li]) c++;
  return c;
}

/** Heat the chamber cells of a machine object toward `target`. */
export function heatChamber(obj, ctx, target, airRate, objRate) {
  const world = ctx.world;
  const fp = obj.getFootprint();
  const ch = fp.chamber;
  const ox = obj.ox, oy = obj.oy;
  const W = world.w, H = world.h;
  const { temp, objMask, objLocal } = world;
  let sum = 0, cnt = 0;
  for (let k = 0; k < ch.length; k += 3) {
    const wx = ox + ch[k], wy = oy + ch[k + 1];
    if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
    const i = wy * W + wx;
    const om = objMask[i];
    if (om === 0) {
      if (temp[i] < target) {
        temp[i] += (target - temp[i]) * airRate * world.reg.invCap[world.cells[i]] * 1.5;
        world.wake(i);
      }
      sum += temp[i];
      cnt++;
    } else if (om !== obj.id && om !== -obj.id) {
      const other = ctx.objects.byId.get(Math.abs(om));
      if (other) {
        const lj = objLocal[i];
        if (other.temp[lj] < target) other.temp[lj] += (target - other.temp[lj]) * objRate;
      }
    }
  }
  return cnt ? sum / cnt : NaN;
}

function furnaceShape(reg, electric) {
  const W = 34, H = 28;
  return shapeFromFn(reg, W, H, (x, y) => {
    const wall = electric ? (x === 0 || x === W - 1 || y === H - 1 ? 'steel' : 'firebrick') : 'firebrick';
    if (y >= 23) {
      if (electric && x === 0 && y >= 24 && y <= 26) return { k: MASK.WALL, mat: 'copper' }; // power terminal
      if (!electric && y === 23 && x >= 8 && x <= 29) return { k: MASK.WALL, mat: 'iron' }; // grate
      if (electric && y === 23 && x >= 8 && x <= 29) return { k: MASK.WALL, mat: 'graphite' };
      return { k: MASK.WALL, mat: wall };
    }
    if (x >= 8 && x <= 29) return { k: MASK.CHAMBER };
    if (!electric && x >= 2 && x <= 5 && y <= 9) return { k: MASK.HOPPER };
    if (electric && (x === 6 || x === 31) && y % 3 === 1) return { k: MASK.WALL, mat: 'copper' }; // induction coil
    return { k: MASK.WALL, mat: wall };
  });
}

export class Furnace extends Container {
  constructor(game, type = 'furnace') {
    const electric = type === 'electric_furnace';
    const shape = furnaceShape(game.registry, electric);
    super(game, { type, name: FURNACE_INFO[type].name, category: 'Machine', ...shape, heavy: true, impactSound: 'thud', looseSolids: true });
    this.isMachine = true;
    this.electric = electric;
    this.on = true;
    this.maxTemp = electric ? 2400 : 1650;
    this.target = electric ? 1600 : 1300;
    this.fuel = 0;
    this.maxFuel = 60 * 60 * 4;
    this.burning = false;
    this.powered = false;
    this.chamberTemp = NaN;
    this.terminals = electric ? [[0, 24], [0, 25], [0, 26]] : [];
  }

  accepts(m, li) {
    // Only the hopper takes cells, and only fuel.
    if (li !== undefined && this.mask[li] !== MASK.HOPPER) return false;
    return this.reg.fuel[m] > 0;
  }

  update(ctx) {
    this.simulateContents(ctx);
    if (this.electric) {
      if ((this.age & 7) === 0) {
        this.powered = false;
        for (const [lx, ly] of this.terminals) {
          const [fx, fy] = this.localToWorld(lx - 0.5, ly + 0.5);
          if (ctx.sim.electricity.poweredNear(Math.floor(fx), Math.floor(fy))) { this.powered = true; break; }
        }
      }
      this.burning = this.on && this.powered;
    } else {
      if (this.fuel < this.maxFuel - 3000) this.fuel += consumeHopperFuel(this);
      this.burning = this.on && this.fuel > 0;
      if (this.burning) this.fuel = Math.max(0, this.fuel - (0.5 + this.target / 2000));
    }
    if (this.burning) {
      this.chamberTemp = heatChamber(this, ctx, this.target, 0.05, this.electric ? 0.006 : 0.0045);
      this.emitFlames(ctx);
      if ((this.age & 63) === 0) ctx.game.audio?.play(this.electric ? 'hum' : 'crackle', 0.35);
    } else {
      this.chamberTemp = heatChamber(this, ctx, -9999, 0, 0);
    }
    if ((this.age++ & 15) === 0) this.checkWalls(ctx);
  }

  emitFlames(ctx) {
    if (!ctx.fx || rng() > 0.5) return;
    const lx = 8 + rng() * 22;
    const [wx, wy] = this.localToWorld(lx, 22.5);
    if (this.electric) ctx.fx.arc(wx, wy);
    else ctx.fx.flame(wx, wy, this.target);
  }

  describe() {
    const unit = this.game.settings?.get('tempUnit');
    const rows = [
      ['Status', this.burning ? 'Heating' : this.electric ? (this.powered ? 'Idle (switched off)' : 'No power — wire the terminal') : (this.fuel > 0 ? 'Idle (switched off)' : 'Out of fuel')],
      ['Chamber', formatTemp(this.chamberTemp, unit)],
      ['Target', formatTemp(this.target, unit)],
    ];
    const bars = [];
    if (!this.electric) {
      rows.push(['Fuel', `${Math.round(this.fuel / 60)} s burn + ${hopperFuelCells(this)} cells in hopper`]);
      bars.push({ label: 'Fuel', value: this.fuel / this.maxFuel, color: '#e0a23a' });
    } else {
      rows.push(['Power', this.powered ? 'Connected' : 'Disconnected']);
    }
    bars.push({ label: 'Chamber heat', value: Number.isFinite(this.chamberTemp) ? Math.min(1, this.chamberTemp / this.maxTemp) : 0, color: '#ff6a2a' });
    const controls = [
      { type: 'toggle', id: 'on', label: this.electric ? 'Power switch' : 'Burner', value: this.on, onChange: (v) => { this.on = v; } },
      { type: 'slider', id: 'target', label: 'Target temperature', min: 200, max: this.maxTemp, step: 10, value: this.target, format: (v) => formatTemp(v, unit), onChange: (v) => { this.target = v; } },
    ];
    if (!this.electric) controls.push({ type: 'button', id: 'refuel', label: 'Shovel in coal (+60 s)', onClick: () => { this.fuel = Math.min(this.maxFuel, this.fuel + 3600); } });
    return { title: this.name, subtitle: 'Machine', rows, bars, controls };
  }

  hint() {
    return this.electric ? 'Wire power to the copper terminal (lower-left) · lower a crucible into the chamber' : 'Drop fuel into the hopper · lower a crucible into the chamber · set target in the inspector';
  }

  saveState() { return { on: this.on, target: this.target, fuel: this.fuel }; }
  loadState(s) {
    if (!s) return;
    this.on = s.on ?? this.on;
    this.target = Math.min(this.maxTemp, s.target ?? this.target);
    this.fuel = s.fuel ?? this.fuel;
  }
}
