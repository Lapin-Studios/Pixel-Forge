// Kitchen appliances: pot and frying pan (containers), hot plate (contact heating),
// oven (heated chamber) and fridge (chilled chamber).
import { Container } from '../objects/Container.js';
import { WorldObject, MASK, parseShape, shapeFromFn, isCavityKind } from '../objects/WorldObject.js';
import { heatChamber } from './Furnace.js';
import { formatTemp, rng } from '../utils/MathUtils.js';

export const KITCHEN_INFO = {
  cooking_pot: { name: 'Cooking Pot', desc: 'Steel pot. Set it on the hot plate or in the oven to boil, simmer and cook. Tilt to pour.' },
  frying_pan: { name: 'Frying Pan', desc: 'Shallow pan with a handle. Fry eggs, pancakes and fries on the hot plate.' },
  hot_plate: { name: 'Hot Plate', desc: 'Electric cooktop. Anything resting on it heats toward the set temperature (50–400°C).' },
  oven: { name: 'Oven', desc: 'Bakes everything inside its chamber at the set temperature (50–300°C). Lower a pot or pan in, or paint dough straight inside.' },
  fridge: { name: 'Fridge', desc: 'Chills everything inside its chamber (-25–10°C). Use it for ice cream, popsicles and setting chocolate.' },
};

const POT_ROWS = [
  '.##oooooooooooo##.',
  '###oooooooooooo###',
  '.##oooooooooooo##.',
  '.##oooooooooooo##.',
  '.##oooooooooooo##.',
  '.##oooooooooooo##.',
  '.##oooooooooooo##.',
  '.##oooooooooooo##.',
  '.##oooooooooooo##.',
  '.################.',
  '..##############..',
];

const PAN_ROWS = [
  '#oooooooooooooo#..........',
  '#oooooooooooooo#..........',
  '##########################',
  '.##############...........',
];

/**
 * Pots and pans stir themselves: neighbouring ingredients swap places now and then, so flour and
 * milk become batter, rice meets the water and so on without reaching for the Mix tool.
 */
function selfStir(o, swaps) {
  const { w, h, mask, mat } = o;
  for (let k = 0; k < swaps; k++) {
    const a = (rng() * mat.length) | 0;
    if (!mat[a] || !isCavityKind(mask[a])) continue;
    const d = (rng() * 4) | 0;
    const ax = a % w, ay = (a / w) | 0;
    const bx = ax + (d === 0 ? 1 : d === 1 ? -1 : 0), by = ay + (d === 2 ? 1 : d === 3 ? -1 : 0);
    if (bx < 0 || by < 0 || bx >= w || by >= h) continue;
    const b = by * w + bx;
    if (!mat[b] || mat[b] === mat[a] || !isCavityKind(mask[b])) continue;
    const reg = o.game.registry;
    if (reg.state[mat[a]] === STATE_SOLID || reg.state[mat[b]] === STATE_SOLID) continue; // finished food stays put
    o.swapLocal(a, b);
  }
}
const STATE_SOLID = 1;

export class CookingPot extends Container {
  constructor(game) {
    const shape = parseShape(game.registry, POT_ROWS, { '#': { k: MASK.WALL, mat: 'steel' }, o: { k: MASK.CAVITY } });
    super(game, { type: 'cooking_pot', name: 'Cooking Pot', category: 'Kitchen', ...shape, impactSound: 'clink' });
  }

  update(ctx) {
    super.update(ctx);
    if (!this.dead) selfStir(this, 10);
  }
}

export class FryingPan extends Container {
  constructor(game) {
    const shape = parseShape(game.registry, PAN_ROWS, { '#': { k: MASK.WALL, mat: 'iron' }, o: { k: MASK.CAVITY } });
    super(game, { type: 'frying_pan', name: 'Frying Pan', category: 'Kitchen', ...shape, pivot: [22, 2], impactSound: 'clink' });
  }

  update(ctx) {
    super.update(ctx);
    if (!this.dead) selfStir(this, 6);
  }
}

// One-click cooking settings: hot enough to cook, too cool to burn.
const PLATE_PRESETS = [
  ['🍳 Eggs / meat', 120], ['🥞 Pancakes', 170], ['🍟 Fries', 190], ['🍿 Popcorn', 200], ['🍬 Caramel', 200], ['🍚 Simmer', 105],
];
const OVEN_PRESETS = [['🍞 Bread', 200], ['🎂 Cake', 180], ['🥔 Potato', 180], ['🍞 Toast', 250], ['🍎 Baked apple', 150]];
const FRIDGE_PRESETS = [['🍦 Ice cream', -18], ['🧊 Popsicles', -10], ['🍫 Set chocolate', 5]];
const presetButtons = (list, obj) => list.map(([label, t]) => ({
  type: 'button', id: `preset-${t}-${label}`, label: `${label} · ${t}°C`,
  onClick: () => { obj.target = t; obj.on = true; obj.game.toast?.(`${obj.name} set to ${t}°C for ${label.replace(/^\S+\s/, '').toLowerCase()}`); },
}));

export class HotPlate extends WorldObject {
  constructor(game) {
    const W = 26, H = 6;
    const shape = shapeFromFn(game.registry, W, H, (x, y) => {
      if (y === 0 && x >= 1 && x <= W - 2) return { k: MASK.WALL, mat: 'heating_element' };
      if (y >= 1 && y <= 3) return { k: MASK.WALL, mat: 'steel' };
      if (y >= 4 && ((x >= 1 && x <= 3) || (x >= W - 4 && x <= W - 2))) return { k: MASK.WALL, mat: 'steel' };
      return null;
    });
    super(game, { type: 'hot_plate', name: 'Hot Plate', ...shape, heavy: true, impactSound: 'clink' });
    this.category = 'Kitchen';
    this.isMachine = true;
    this.on = true;
    this.target = 170;
    this.age = 0;
  }

  update(ctx) {
    if (this.on) {
      const { w, temp } = this;
      for (let x = 1; x <= w - 2; x++) {
        const t = temp[x];
        if (t < this.target) temp[x] = t + (this.target - t) * 0.08;
      }
      // Warm the pot or pan sitting on the plate directly, so cooking doesn't wait on slow conduction.
      if ((this.age & 7) === 0) this.warmResting(ctx);
      if (ctx.fx && this.target > 250 && rng() < 0.02) {
        const [fx, fy] = this.localToWorld(1 + rng() * (w - 2), -0.5);
        ctx.fx.steam(fx, fy, 1);
      }
    }
    if ((this.age++ & 15) === 0) this.checkWalls(ctx);
  }

  warmResting(ctx) {
    const world = ctx.world;
    if (!world) return;
    const seen = new Set();
    for (let x = 1; x <= this.w - 2; x += 2) {
      const [fx, fy] = this.localToWorld(x + 0.5, -0.5);
      const wx = Math.floor(fx), wy = Math.floor(fy);
      if (wx < 0 || wy < 0 || wx >= world.w || wy >= world.h) continue;
      const om = world.objMask[wy * world.w + wx];
      const o = om ? ctx.objects.byId.get(Math.abs(om)) : null;
      if (!o || o === this || seen.has(o) || !o.isContainer) continue;
      seen.add(o);
      const t = this.target;
      for (let i = 0; i < o.temp.length; i++) {
        if (!o.mask[i]) continue;
        if (o.temp[i] < t) o.temp[i] += (t - o.temp[i]) * 0.02;
      }
    }
  }

  labelText(unit) {
    return `${this.on ? '♨ ' : ''}${formatTemp(this.avgTempTop(), unit)}`;
  }

  avgTempTop() {
    let s = 0;
    for (let x = 1; x <= this.w - 2; x++) s += this.temp[x];
    return s / (this.w - 2);
  }

  describe() {
    const unit = this.game.settings?.get('tempUnit');
    return {
      title: 'Hot Plate',
      subtitle: 'Kitchen · cooktop',
      rows: [['Status', this.on ? 'Heating' : 'Off'], ['Surface', formatTemp(this.avgTempTop(), unit)], ['Target', formatTemp(this.target, unit)]],
      controls: [
        { type: 'toggle', id: 'on', label: 'Power', value: this.on, onChange: (v) => { this.on = v; } },
        { type: 'slider', id: 'target', label: 'Temperature', min: 50, max: 400, step: 5, value: this.target, format: (v) => formatTemp(v, unit), onChange: (v) => { this.target = v; } },
        { type: 'note', id: 'presets', label: "Quick settings — pick what you're cooking:" },
        ...presetButtons(PLATE_PRESETS, this),
      ],
    };
  }

  hint() { return "Rest a pot or pan on top — pick what you're cooking in the inspector"; }
  saveState() { return { on: this.on, target: this.target }; }
  loadState(s) { if (s) { this.on = s.on ?? true; this.target = s.target ?? this.target; } }
}

/** Push chamber cells (world cells and other objects' cells) down toward target. */
function coolChamber(obj, ctx, target, airRate, objRate) {
  const world = ctx.world;
  const ch = obj.getFootprint().chamber;
  const ox = obj.ox, oy = obj.oy, W = world.w, H = world.h;
  const { temp, objMask, objLocal } = world;
  let sum = 0, cnt = 0;
  for (let k = 0; k < ch.length; k += 3) {
    const wx = ox + ch[k], wy = oy + ch[k + 1];
    if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
    const i = wy * W + wx;
    const om = objMask[i];
    if (om === 0) {
      if (temp[i] > target) {
        temp[i] += (target - temp[i]) * airRate * world.reg.invCap[world.cells[i]] * 1.5;
        world.wake(i);
      }
      sum += temp[i];
      cnt++;
    } else if (om !== obj.id && om !== -obj.id) {
      const other = ctx.objects.byId.get(Math.abs(om));
      if (other) {
        const lj = objLocal[i];
        if (other.temp[lj] > target) other.temp[lj] += (target - other.temp[lj]) * objRate;
      }
    }
  }
  return cnt ? sum / cnt : NaN;
}

function applianceShape(reg, outer, inner) {
  const W = 32, H = 26;
  return shapeFromFn(reg, W, H, (x, y) => {
    const side = x < 3 || x >= W - 3;
    if (y >= H - 3 || side) {
      const isOuter = x === 0 || x === W - 1 || y === H - 1;
      return { k: MASK.WALL, mat: isOuter ? outer : inner };
    }
    return { k: MASK.CHAMBER };
  });
}

export class ChamberAppliance extends WorldObject {
  constructor(game, type) {
    const fridge = type === 'fridge';
    const shape = applianceShape(game.registry, fridge ? 'aluminum' : 'steel', 'insulation');
    super(game, { type, name: KITCHEN_INFO[type].name, ...shape, heavy: true, impactSound: 'thud' });
    this.category = 'Kitchen';
    this.isMachine = true;
    this.fridge = fridge;
    this.on = true;
    this.target = fridge ? -18 : 180;
    this.min = fridge ? -25 : 50;
    this.max = fridge ? 10 : 300;
    this.chamberTemp = NaN;
  }

  update(ctx) {
    if (this.on) {
      this.chamberTemp = this.fridge
        ? coolChamber(this, ctx, this.target, 0.05, 0.006)
        : heatChamber(this, ctx, this.target, 0.05, 0.006);
      if (ctx.fx && rng() < 0.03) {
        const [fx, fy] = this.localToWorld(3 + rng() * (this.w - 6), this.h - 4);
        if (this.fridge) ctx.fx.frost(fx, fy - 2); else ctx.fx.steam(fx, fy - 1, 1);
      }
    } else {
      this.chamberTemp = heatChamber(this, ctx, -9999, 0, 0);
    }
    if ((this.age++ & 15) === 0) this.checkWalls(ctx);
  }

  labelText(unit) {
    return `${this.on ? (this.fridge ? '❄ ' : '♨ ') : ''}${formatTemp(this.chamberTemp, unit)}`;
  }

  describe() {
    const unit = this.game.settings?.get('tempUnit');
    return {
      title: this.name,
      subtitle: 'Kitchen appliance',
      rows: [['Status', this.on ? (this.fridge ? 'Cooling' : 'Baking') : 'Off'], ['Chamber', formatTemp(this.chamberTemp, unit)], ['Target', formatTemp(this.target, unit)]],
      controls: [
        { type: 'toggle', id: 'on', label: 'Power', value: this.on, onChange: (v) => { this.on = v; } },
        { type: 'slider', id: 'target', label: 'Temperature', min: this.min, max: this.max, step: 1, value: this.target, format: (v) => formatTemp(v, unit), onChange: (v) => { this.target = v; } },
        { type: 'note', id: 'presets', label: "Quick settings — pick what you're making:" },
        ...presetButtons(this.fridge ? FRIDGE_PRESETS : OVEN_PRESETS, this),
      ],
    };
  }

  hint() {
    return this.fridge ? 'Put food inside to chill it — set the temperature in the inspector' : 'Put a pot or pan inside, or paint dough/batter straight into the chamber';
  }

  saveState() { return { on: this.on, target: this.target }; }
  loadState(s) { if (s) { this.on = s.on ?? true; this.target = Math.max(this.min, Math.min(this.max, s.target ?? this.target)); } }
}
