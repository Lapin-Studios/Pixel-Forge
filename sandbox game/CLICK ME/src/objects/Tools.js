// Workshop tools: thermometer probe, water-cooled casting table and crafting workbench.
import { WorldObject, MASK, shapeFromFn } from './WorldObject.js';
import { formatTemp } from '../utils/MathUtils.js';

export const TOOL_INFO = {
  thermometer: { name: 'Thermometer', desc: 'Tungsten probe. Dip the tip into anything to read its temperature.' },
  casting_table: { name: 'Casting Table', desc: 'Water-cooled steel table. Moulds resting on it solidify much faster.' },
  workbench: { name: 'Workbench', desc: 'Place finished items on top and craft them into new goods and machines.' },
};

export class Thermometer extends WorldObject {
  constructor(game) {
    const shape = shapeFromFn(game.registry, 8, 22, (x, y) => {
      if (y <= 4) return { k: MASK.WALL, mat: y === 0 || y === 4 || x === 0 || x === 7 ? 'steel' : 'glass' };
      if (x >= 3 && x <= 4) return { k: MASK.WALL, mat: 'tungsten' };
      return null;
    });
    super(game, { type: 'thermometer', name: 'Thermometer', ...shape, pivot: [4, 2], impactSound: 'clink' });
    this.category = 'Tool';
    this.reading = this.temp[0];
    this.tip = [];
    for (let y = 19; y <= 21; y++) for (let x = 3; x <= 4; x++) this.tip.push(y * this.w + x);
  }

  update(ctx) {
    let s = 0;
    for (const li of this.tip) s += this.temp[li];
    const v = s / this.tip.length;
    this.reading += (v - this.reading) * 0.25;
    if ((this.age++ & 15) === 0) this.checkWalls(ctx);
  }

  describe() {
    const unit = this.game.settings?.get('tempUnit');
    return {
      title: 'Thermometer',
      subtitle: 'Tool · probe tip reading',
      rows: [['Reading', formatTemp(this.reading, unit)], ['Head temp', formatTemp(this.avgTemp('wall'), unit)]],
      controls: [],
    };
  }

  hint() {
    return 'Dip the probe tip into a material to read its temperature';
  }
}

export class CastingTable extends WorldObject {
  constructor(game) {
    const W = 48, H = 8;
    const shape = shapeFromFn(game.registry, W, H, (x, y) => {
      if (y <= 1) return { k: MASK.WALL, mat: 'steel' };
      if ((x >= 2 && x <= 4) || (x >= W - 5 && x <= W - 3)) return { k: MASK.WALL, mat: 'steel' };
      if (y === 5 && x > 4 && x < W - 5) return { k: MASK.WALL, mat: 'copper' };
      return null;
    });
    super(game, { type: 'casting_table', name: 'Casting Table', ...shape, heavy: true, impactSound: 'thud' });
    this.category = 'Tool';
    this.isMachine = true;
    this.cooling = true;
  }

  update(ctx) {
    if (this.cooling) {
      const amb = ctx.world.ambient;
      const { mask, temp } = this;
      for (let li = 0; li < mask.length; li++) {
        if (mask[li] === MASK.WALL) temp[li] += (amb - temp[li]) * 0.05;
      }
    }
    if ((this.age++ & 15) === 0) this.checkWalls(ctx);
  }

  describe() {
    const unit = this.game.settings?.get('tempUnit');
    return {
      title: 'Casting Table',
      subtitle: 'Water-cooled steel',
      rows: [['Surface temp', formatTemp(this.avgTemp('wall'), unit)]],
      controls: [
        { type: 'toggle', id: 'cooling', label: 'Water cooling', value: this.cooling, onChange: (v) => { this.cooling = v; } },
      ],
    };
  }

  saveState() { return { cooling: this.cooling }; }
  loadState(s) { if (s) this.cooling = s.cooling ?? true; }

  hint() {
    return 'Rest moulds on top to cool castings quickly';
  }
}

export class Workbench extends WorldObject {
  constructor(game) {
    const W = 44, H = 12;
    const shape = shapeFromFn(game.registry, W, H, (x, y) => {
      if (y <= 2) return { k: MASK.WALL, mat: 'planks' };
      if ((x >= 2 && x <= 4) || (x >= W - 5 && x <= W - 3)) return { k: MASK.WALL, mat: 'wood' };
      if (y === 8 && x > 4 && x < W - 5) return { k: MASK.WALL, mat: 'planks' };
      return null;
    });
    super(game, { type: 'workbench', name: 'Workbench', ...shape, heavy: true, impactSound: 'thud' });
    this.category = 'Crafting station';
    this.isMachine = true;
  }

  update(ctx) {
    if ((this.age++ & 15) === 0) this.checkWalls(ctx);
  }

  describe() {
    const crafting = this.game.crafting;
    const items = crafting.itemsOnBench(this);
    const options = crafting.availableRecipes(this);
    const controls = options.map((o) => ({
      type: 'button', id: `craft-${o.recipe.id}`, label: `Craft: ${o.name}`, primary: true,
      onClick: () => crafting.craft(this, o),
    }));
    if (!options.length) controls.push({ type: 'note', label: items.length ? 'No recipe matches these items. See the Recipe Book → Workbench.' : 'Place cast items on the bench to see recipes.' });
    return {
      title: 'Workbench',
      subtitle: 'Crafting station',
      rows: [['Items on bench', items.length ? items.map((i) => i.name).join(', ') : 'none']],
      controls,
    };
  }

  hint() {
    return 'Rest items on the bench, then open it with Inspect (I) to craft';
  }
}
