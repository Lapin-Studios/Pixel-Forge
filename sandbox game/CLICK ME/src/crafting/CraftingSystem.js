// Turns solidified castings into items, and items on a workbench into new goods / machines.
import { STATE } from '../materials/MaterialProperties.js';
import { MASK } from '../objects/WorldObject.js';
import { Item } from '../objects/Item.js';
import { createObject } from '../objects/ObjectFactory.js';
import { CAST_SHAPES, WORKBENCH_RECIPES, SPRITES } from './RecipeBook.js';

export class CraftingSystem {
  constructor(game) {
    this.game = game;
  }

  get reg() { return this.game.registry; }

  /** Pull the solid casting out of a mould as a real Item made of the cast cells. */
  extractCasting(mold) {
    const game = this.game, reg = this.reg;
    const s = mold.status();
    if (s.filled === 0) { game.toast('The mould is empty.', 'warn'); return null; }
    if (s.liquid > 0) { game.toast('Still molten — wait for it to cool and solidify.', 'warn'); game.audio?.play('error'); return null; }

    game.history?.push('Extract casting');
    const part = [], sprue = [], loose = [];
    const { w, mask, mat, temp } = mold;
    for (let li = 0; li < mask.length; li++) {
      const m = mat[li];
      if (!m) continue;
      const k = mask[li];
      const cell = { x: li % w, y: (li / w) | 0, m, t: temp[li] };
      const solid = reg.state[m] === STATE.SOLID;
      if (k === MASK.PART && solid) part.push(cell);
      else if (k === MASK.CAVITY && solid) sprue.push(cell);
      else if (k === MASK.PART || k === MASK.CAVITY) loose.push(cell);
      if (k === MASK.PART || k === MASK.CAVITY) { mat[li] = 0; mold.life[li] = 0; }
    }
    if (!part.length) {
      game.toast('Nothing solid to extract.', 'warn');
      return null;
    }

    const counts = new Map();
    for (const c of part) counts.set(c.m, (counts.get(c.m) || 0) + 1);
    let main = 0, mainCount = 0;
    for (const [m, c] of counts) if (c > mainCount) { main = m; mainCount = c; }
    const mixed = counts.size > 1;
    const quality = part.length / s.total;
    const shape = CAST_SHAPES[mold.castShape];
    const metalName = reg.name(main);
    const perfect = quality >= 0.9 && !mixed;
    let name, kind;
    if (perfect) { name = shape.name.replace('{M}', metalName); kind = mold.castShape; }
    else if (quality >= 0.9) { name = shape.name.replace('{M}', 'Mixed-metal'); kind = mold.castShape; }
    else { name = `Partial ${metalName} casting`; kind = 'scrap'; }

    const top = mold.bounds().y0;
    const cx = (mold.bounds().x0 + mold.bounds().x1) / 2;
    const item = Item.fromCells(game, part, { name, kind, material: reg.get(main).key, quality, description: perfect ? shape.desc : 'Imperfect casting — remelt it for another try.' });
    const placed = game.objects.spawn(item, cx, top - 2, { bottom: top - 1 });
    if (!placed) {
      game.toast('No room above the mould to place the casting.', 'warn');
      return null;
    }
    if (sprue.length) {
      const scrap = Item.fromCells(game, sprue, { name: `${metalName} sprue scrap`, kind: 'scrap', material: reg.get(sprue[0].m).key, quality: 0.2, description: 'Trimmed pour channel. Remelt it.' });
      game.objects.spawn(scrap, cx + 14, top - 2, { bottom: top - 1 });
    }
    if (loose.length) {
      // Spill loose powder / slag out over the rim.
      for (const c of loose) {
        const [fx, fy] = mold.localToWorld(c.x + 0.5, -1.5);
        const wx = Math.floor(fx), wy = Math.floor(fy);
        const world = game.world;
        if (world.inBounds(wx, wy)) {
          const j = world.findFreeNear(wx, wy, 6);
          if (j >= 0) world.setCell(j, c.m, c.t);
        }
      }
    }
    game.discovery?.craft(`cast_${mold.castShape}_${reg.get(main).key}`);
    game.discovery?.craft(`cast_${mold.castShape}`);
    game.audio?.play('cast');
    game.particles?.steam(cx, top - 3, 6);
    game.toast(perfect ? `Cast a ${name}!` : `Extracted: ${name} (${Math.round(quality * 100)}% filled)`, perfect ? 'success' : 'info');
    return item;
  }

  itemsOnBench(bench) {
    const b = bench.bounds();
    const top = b.y0;
    return this.game.objects.list.filter((o) => {
      if (!o.isItem || o.held || o.dead) return false;
      const ib = o.bounds();
      const mx = (ib.x0 + ib.x1) / 2;
      return mx >= b.x0 && mx <= b.x1 && ib.y1 <= top + 1 && ib.y1 >= top - 40;
    });
  }

  matches(input, item) {
    const reg = this.reg;
    if (input.kind && item.kind !== input.kind) return false;
    if (input.mat && !input.mat.includes(item.material)) return false;
    if (input.tag) {
      const id = reg.has(item.material) ? reg.id(item.material) : 0;
      if (!reg.hasTag(id, input.tag)) return false;
    }
    return true;
  }

  matchRecipe(recipe, items) {
    const used = new Set();
    const chosen = [];
    for (const input of recipe.inputs) {
      const it = items.find((i) => !used.has(i) && this.matches(input, i));
      if (!it) return null;
      used.add(it);
      chosen.push(it);
    }
    return chosen;
  }

  recipeName(recipe, chosen) {
    if (recipe.result.type === 'object') return recipe.name;
    const names = chosen.map((i) => this.reg.get(i.material)?.name || 'Metal');
    return recipe.result.name.replace('{0}', names[0] || '').replace('{1}', names[1] || '').trim();
  }

  availableRecipes(bench) {
    const items = this.itemsOnBench(bench);
    const out = [];
    for (const recipe of WORKBENCH_RECIPES) {
      const chosen = this.matchRecipe(recipe, items);
      if (chosen) out.push({ recipe, items: chosen, name: this.recipeName(recipe, chosen) });
    }
    return out;
  }

  craft(bench, option) {
    const game = this.game, reg = this.reg;
    const { recipe, items } = option;
    if (items.some((i) => i.dead)) { game.toast('Those items are gone.', 'warn'); return; }
    game.history?.push(`Craft ${recipe.name}`);
    const b = bench.bounds();
    const cx = (b.x0 + b.x1) / 2;
    const avgT = items.reduce((s, i) => s + i.avgTemp('wall'), 0) / items.length;
    // A product is only as good as its parts (a flawed blade makes a flawed sword).
    const quality = items.reduce((s, i) => s + (i.quality ?? 1), 0) / items.length;
    for (const it of items) game.objects.remove(it);
    let product = null;
    if (recipe.result.type === 'object') {
      product = game.objects.spawn(createObject(game, recipe.result.object), cx, b.y0 - 12, { bottom: b.y0 - 1 });
    } else {
      const legend = {};
      const chars = ['A', 'B', 'C', 'D'];
      items.forEach((it, k) => { legend[chars[k]] = reg.id(it.material) || reg.id('iron'); });
      const rows = SPRITES[recipe.result.sprite]();
      const item = Item.fromSprite(game, rows, legend, {
        name: option.name, kind: recipe.result.kind, material: items[0].material, quality,
        description: recipe.desc,
      }, avgT);
      product = game.objects.spawn(item, cx, b.y0 - 10, { bottom: b.y0 - 1 });
    }
    if (!product) { game.toast('No room on the bench for the result.', 'warn'); return; }
    game.discovery?.craft(`craft_${recipe.id}`);
    game.audio?.play('craft');
    game.particles?.sparkle((b.x0 + b.x1) / 2, b.y0 - 6);
    game.toast(`Crafted: ${option.name}`, 'success');
    game.ui?.inspector?.refresh(true);
  }
}
