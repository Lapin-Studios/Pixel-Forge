// Data-driven pairwise reactions between neighbouring cells.
// a / b: material key, list of keys, or '#tag'.  outA / outB: 'keep' (default), 'empty' or a key.
// minT / maxT use the hotter of the two cells.  heat is added to both products.
import { rng } from '../utils/MathUtils.js';

export const REACTION_DEFS = [
  // Water & heat
  { id: 'quench_lava', group: 'Geology', name: 'Quenched lava', a: 'lava', b: '#water', chance: 0.25, outA: 'obsidian', outB: 'steam', fx: 'steam', desc: 'Water flash-cools lava into glassy obsidian.' },
  { id: 'dissolve_salt', group: 'Solutions', name: 'Dissolving salt', a: 'salt', b: 'water', chance: 0.03, outA: 'salt_water', outB: 'salt_water', desc: 'Salt dissolves into water, making brine.' },
  { id: 'salt_melts_ice', group: 'Solutions', name: 'De-icing', a: 'salt', b: ['ice', 'snow'], chance: 0.02, outA: 'keep', outB: 'salt_water', desc: 'Salt melts ice and snow into brine.' },
  { id: 'make_mud', group: 'Geology', name: 'Mud', a: 'dirt', b: 'water', chance: 0.02, outA: 'mud', outB: 'empty', desc: 'Dirt soaks up water and turns into mud.' },
  { id: 'make_concrete', group: 'Construction', name: 'Mixing concrete', a: 'cement', b: 'water', chance: 0.08, outA: 'wet_concrete', outB: 'empty', desc: 'Cement + water = wet concrete, which sets over time.' },
  { id: 'slake_lime', group: 'Construction', name: 'Slaking lime', a: 'quicklime', b: '#water', chance: 0.05, outA: 'slaked_lime', outB: 'steam', heat: 180, fx: 'steam', desc: 'Quicklime reacts violently with water, releasing a lot of heat.' },
  { id: 'extinguish', group: 'Fire', name: 'Extinguishing', a: '#water', b: 'fire', chance: 0.7, outA: 'steam', outB: 'empty', fx: 'steam', desc: 'Water douses flames, flashing into steam.' },
  { id: 'co2_smother', group: 'Fire', name: 'CO₂ smothering', a: ['carbon_dioxide', 'nitrogen', 'helium'], b: 'fire', chance: 0.5, outA: 'keep', outB: 'empty', desc: 'Inert gases starve fire of oxygen.' },
  { id: 'oxygen_feed', group: 'Fire', name: 'Oxygen-fed flame', a: 'oxygen', b: 'fire', chance: 0.4, outA: 'fire', outB: 'keep', heat: 250, desc: 'Oxygen turns into more fire and burns hotter.' },

  // Corrosion
  { id: 'rust', group: 'Corrosion', name: 'Rusting', a: 'iron', b: 'water', chance: 0.0006, outA: 'rust', desc: 'Iron slowly corrodes in water.' },
  { id: 'rust_salt', group: 'Corrosion', name: 'Salt corrosion', a: ['iron', 'steel'], b: 'salt_water', chance: 0.003, outA: 'rust', desc: 'Brine eats iron (and slowly even steel).' },
  { id: 'patina', group: 'Corrosion', name: 'Verdigris patina', a: ['copper', 'bronze', 'brass'], b: '#water', chance: 0.0003, outA: 'verdigris', desc: 'Copper alloys grow a green patina in water.' },
  { id: 'acid_metal', group: 'Corrosion', name: 'Acid dissolves metal', a: 'acid', b: '#acid_soluble', chance: 0.06, outA: 'hydrogen', outB: 'empty', fx: 'fizz', desc: 'Acid eats most metals, releasing hydrogen. Gold and tungsten resist.' },
  { id: 'acid_rock', group: 'Corrosion', name: 'Acid etches rock', a: 'acid', b: ['limestone', 'stone', 'gravel', 'concrete', 'granite', 'basalt', 'rust', 'verdigris', 'slag'], chance: 0.03, outA: 'carbon_dioxide', outB: 'empty', fx: 'fizz', desc: 'Acid dissolves rock and concrete, fizzing CO₂.' },
  { id: 'acid_organic', group: 'Corrosion', name: 'Acid burns organics', a: 'acid', b: '#organic', chance: 0.05, outA: 'keep', outB: 'smoke', desc: 'Acid chars organic matter.' },
  { id: 'neutralise', group: 'Solutions', name: 'Neutralisation', a: 'acid', b: ['slaked_lime', 'quicklime'], chance: 0.2, outA: 'water', outB: 'salt', heat: 40, desc: 'Lime neutralises acid into water and salt.' },
  { id: 'acid_rain', group: 'Solutions', name: 'Acid rain', a: ['sulfur_dioxide', 'chlorine'], b: '#water', chance: 0.05, outA: 'empty', outB: 'acid', desc: 'Sulfur dioxide or chlorine dissolve in water to form acid.' },
  { id: 'chlorine_plants', group: 'Corrosion', name: 'Chlorine poisoning', a: 'chlorine', b: '#plant', chance: 0.06, outA: 'keep', outB: 'ash', desc: 'Chlorine kills plants.' },

  // Smelting (carbothermic reduction)
  { id: 'smelt_iron', group: 'Smelting', name: 'Iron smelting', a: 'iron_ore', b: '#carbon', minT: 1000, chance: 0.05, outA: 'iron', outB: 'carbon_dioxide', desc: 'Iron ore + carbon above 1000°C reduces to iron (melts at 1538°C).' },
  { id: 'smelt_copper', group: 'Smelting', name: 'Copper smelting', a: 'copper_ore', b: '#carbon', minT: 900, chance: 0.06, outA: 'copper', outB: 'carbon_dioxide', desc: 'Copper ore + carbon above 900°C gives pure copper.' },
  { id: 'smelt_tin', group: 'Smelting', name: 'Tin smelting', a: 'tin_ore', b: '#carbon', minT: 800, chance: 0.06, outA: 'molten_tin', outB: 'carbon_dioxide', desc: 'Cassiterite + carbon above 800°C gives molten tin.' },
  { id: 'smelt_zinc', group: 'Smelting', name: 'Zinc distillation', a: 'zinc_ore', b: '#carbon', minT: 950, chance: 0.05, outA: 'zinc_vapor', outB: 'carbon_dioxide', desc: 'Zinc ore + carbon releases zinc vapour; condense it below 900°C.' },
  { id: 'smelt_lead', group: 'Smelting', name: 'Lead smelting', a: 'lead_ore', b: '#carbon', minT: 700, chance: 0.06, outA: 'molten_lead', outB: 'carbon_dioxide', desc: 'Galena + carbon above 700°C gives molten lead.' },
  { id: 'reduce_rust', group: 'Smelting', name: 'Rust reduction', a: 'rust', b: '#carbon', minT: 950, chance: 0.05, outA: 'iron', outB: 'carbon_dioxide', desc: 'Rust can be smelted back into iron with carbon.' },
  { id: 'reduce_patina', group: 'Smelting', name: 'Patina reduction', a: 'verdigris', b: '#carbon', minT: 850, chance: 0.05, outA: 'copper', outB: 'carbon_dioxide', desc: 'Verdigris reduces back to copper with carbon.' },

  // Alloying (both molten)
  { id: 'alloy_bronze', group: 'Alloys', name: 'Bronze', a: 'molten_copper', b: 'molten_tin', chance: 0.12, outA: 'molten_bronze', outB: 'molten_bronze', desc: 'Molten copper + molten tin → bronze (roughly 3 parts copper : 1 tin).' },
  { id: 'alloy_brass', group: 'Alloys', name: 'Brass', a: 'molten_copper', b: ['molten_zinc', 'zinc_vapor'], chance: 0.12, outA: 'molten_brass', outB: 'molten_brass', desc: 'Molten copper + zinc → brass.' },
  { id: 'alloy_steel', group: 'Alloys', name: 'Steel', a: 'molten_iron', b: '#carbon', chance: 0.06, outA: 'molten_steel', outB: 'empty', desc: 'Carbon dissolves into molten iron, making steel.' },
  { id: 'alloy_pewter', group: 'Alloys', name: 'Pewter', a: 'molten_tin', b: 'molten_lead', chance: 0.12, outA: 'molten_pewter', outB: 'molten_pewter', desc: 'Molten tin + molten lead → pewter.' },
  { id: 'alloy_electrum', group: 'Alloys', name: 'Electrum', a: 'molten_gold', b: 'molten_silver', chance: 0.12, outA: 'molten_electrum', outB: 'molten_electrum', desc: 'Molten gold + molten silver → electrum.' },
  { id: 'alloy_dilute_bronze', group: 'Alloys', name: 'Bronze dilution', a: 'molten_bronze', b: 'molten_copper', chance: 0.02, outA: 'keep', outB: 'molten_bronze', desc: 'Freshly formed bronze slowly absorbs the remaining molten copper.' },
  { id: 'alloy_dilute_brass', group: 'Alloys', name: 'Brass dilution', a: 'molten_brass', b: 'molten_copper', chance: 0.02, outA: 'keep', outB: 'molten_brass', desc: 'Brass slowly absorbs the remaining molten copper.' },
  { id: 'alloy_rose_gold', group: 'Alloys', name: 'Rose gold', a: 'molten_gold', b: 'molten_copper', chance: 0.12, outA: 'molten_rose_gold', outB: 'molten_rose_gold', desc: 'Molten gold + molten copper → rose gold.' },

  // Cooking (heat-only recipes like egg -> fried egg or dough -> bread are phase changes)
  { id: 'cook_dough', group: 'Cooking', name: 'Dough', a: 'flour', b: 'water', chance: 0.08, outA: 'dough', outB: 'empty', desc: 'Flour + water kneads into dough. Bake it at 180°C for bread.' },
  { id: 'cook_batter', group: 'Cooking', name: 'Batter', a: 'flour', b: 'milk', chance: 0.08, outA: 'batter', outB: 'empty', desc: 'Flour + milk makes pancake batter (cooks at 150°C).' },
  { id: 'cook_cake_batter', group: 'Cooking', name: 'Cake batter', a: 'batter', b: ['sugar', 'egg'], chance: 0.08, outA: 'cake_batter', outB: 'empty', desc: 'Sweeten batter with sugar or enrich it with egg for cake batter (bakes at 160°C).' },
  { id: 'cook_cheese', group: 'Cooking', name: 'Cheese making', a: 'milk', b: ['vinegar', 'acid'], chance: 0.06, outA: 'cheese', outB: 'water', desc: 'Vinegar curdles milk into cheese and whey.' },
  { id: 'cook_fizz', group: 'Cooking', name: 'Baking-soda volcano', a: 'baking_soda', b: 'vinegar', chance: 0.25, outA: 'carbon_dioxide', outB: 'water', fx: 'fizz', desc: 'Baking soda + vinegar fizzes out a burst of CO₂ foam.' },
  { id: 'cook_syrup', group: 'Cooking', name: 'Syrup', a: 'sugar', b: 'water', chance: 0.04, outA: 'syrup', outB: 'syrup', desc: 'Sugar dissolves in water into syrup.' },
  { id: 'cook_ice_cream', group: 'Cooking', name: 'Ice cream', a: 'milk', b: 'sugar', maxT: -2, chance: 0.1, outA: 'ice_cream', outB: 'empty', desc: 'Milk + sugar chilled below -2°C (fridge, ice or liquid nitrogen) freezes into ice cream.' },
  { id: 'cook_choc_milk', group: 'Cooking', name: 'Chocolate milk', a: 'melted_chocolate', b: 'milk', chance: 0.08, outA: 'chocolate_milk', outB: 'chocolate_milk', desc: 'Stir melted chocolate into milk.' },
  { id: 'cook_fries', group: 'Cooking', name: 'Fries', a: 'potato', b: ['oil', 'melted_butter'], minT: 150, chance: 0.06, outA: 'fries', outB: 'keep', desc: 'Potato fried in hot oil (150°C+).' },
  { id: 'cook_rice', group: 'Cooking', name: 'Steamed rice', a: 'rice', b: 'water', minT: 90, chance: 0.05, outA: 'cooked_rice', outB: 'empty', desc: 'Rice simmered in water at 90°C+ soaks it up and cooks.' },
  { id: 'cook_tea', group: 'Cooking', name: 'Tea', a: 'tea_leaves', b: 'water', minT: 80, chance: 0.05, outA: 'empty', outB: 'tea', desc: 'Steep tea leaves in hot water (80°C+).' },
  { id: 'cook_jam', group: 'Cooking', name: 'Jam', a: 'apple', b: 'sugar', minT: 90, chance: 0.06, outA: 'jam', outB: 'jam', desc: 'Apple cooked with sugar (90°C+) makes jam.' },
  { id: 'cook_cocoa', group: 'Cooking', name: 'Hot chocolate', a: 'chocolate', b: 'milk', minT: 60, chance: 0.06, outA: 'chocolate_milk', outB: 'chocolate_milk', desc: 'Chocolate dissolves into warm milk (60°C+).' },
];

function resolveSet(reg, spec) {
  const ids = new Set();
  const list = Array.isArray(spec) ? spec : [spec];
  for (const s of list) {
    if (typeof s !== 'string') continue;
    if (s.startsWith('#')) for (const id of reg.idsWithTag(s.slice(1))) ids.add(id);
    else if (reg.has(s)) ids.add(reg.id(s));
    else console.warn(`Reaction references unknown material ${s}`);
  }
  return ids;
}

function resolveOut(reg, v) {
  if (v === undefined || v === 'keep') return -1;
  if (v === 'empty') return 0;
  return reg.id(v);
}

/** Compile reactions into per-material lookup lists stored on the registry. */
export function buildReactions(reg) {
  const n = reg.count;
  const compiled = [];
  for (const def of REACTION_DEFS) {
    const aSet = resolveSet(reg, def.a);
    const bSet = resolveSet(reg, def.b);
    const bMask = new Uint8Array(n);
    for (const id of bSet) bMask[id] = 1;
    const aMask = new Uint8Array(n);
    for (const id of aSet) aMask[id] = 1;
    const base = {
      def,
      chance: def.chance ?? 0.1,
      minT: def.minT ?? -Infinity,
      maxT: def.maxT ?? Infinity,
      heat: def.heat ?? 0,
      fx: def.fx || null,
    };
    // Forward: this cell is A, neighbour is B.
    const fwd = { ...base, other: bMask, outSelf: resolveOut(reg, def.outA), outOther: resolveOut(reg, def.outB) };
    // Reverse: this cell is B, neighbour is A (lets either side trigger it).
    const rev = { ...base, other: aMask, outSelf: resolveOut(reg, def.outB), outOther: resolveOut(reg, def.outA) };
    for (const id of aSet) {
      (reg.reactions[id] ||= []).push(fwd);
      reg.hasReaction[id] = 1;
    }
    for (const id of bSet) {
      (reg.reactions[id] ||= []).push(rev);
      reg.hasReaction[id] = 1;
    }
    compiled.push({ def, aSet, bSet });
  }
  return compiled;
}

/** Find a reaction between material m (self) and neighbour mb at temperature t. */
export function findReaction(reg, m, mb, t) {
  const list = reg.reactions[m];
  if (!list || mb === 0) return null;
  for (let k = 0; k < list.length; k++) {
    const r = list[k];
    if (r.other[mb] === 1 && t >= r.minT && t <= r.maxT) return r;
  }
  return null;
}

export function rollReaction(r) {
  // Each side can trigger the reaction, so halve the per-side probability.
  return rng() < r.chance * 0.5;
}
