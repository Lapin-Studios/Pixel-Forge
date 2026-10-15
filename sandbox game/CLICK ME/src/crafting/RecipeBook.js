// Casting names, workbench recipes and the pixel sprites of crafted goods.

export const CAST_SHAPES = {
  ingot: { name: '{M} Ingot', mold: 'mold_ingot', desc: 'Rectangular ingot — the standard stock for crafting.' },
  bar: { name: '{M} Bar', mold: 'mold_gold_bar', desc: 'Tapered bullion bar.' },
  longbar: { name: '{M} Bar Stock', mold: 'mold_copper_bar', desc: 'Long bar stock used for machines and tools.' },
  ring: { name: '{M} Ring', mold: 'mold_ring', desc: 'A cast ring. Set a gem in it at the workbench.' },
  gear: { name: '{M} Gear', mold: 'mold_gear', desc: 'Eight-tooth gear for machinery.' },
  blade: { name: '{M} Sword Blade', mold: 'mold_blade', desc: 'Rough-cast blade. Add a wooden grip at the workbench.' },
};

/**
 * Workbench recipes. Each input matches one item by kind and optionally material keys or a tag.
 * result.type 'item' builds a sprite; 'object' spawns a working object (container / machine).
 */
export const WORKBENCH_RECIPES = [
  { id: 'sword', name: 'Sword', inputs: [{ kind: 'blade' }, { kind: 'chunk', tag: 'wood' }], result: { type: 'item', sprite: 'sword', name: '{0} Sword', kind: 'sword' }, desc: 'Cast sword blade + a carved chunk of wood for the grip.' },
  { id: 'hammer', name: 'Smithing Hammer', inputs: [{ kind: 'ingot', tag: 'ferrous' }, { kind: 'chunk', tag: 'wood' }], result: { type: 'item', sprite: 'hammer', name: '{0} Hammer', kind: 'tool' }, desc: 'Iron or steel ingot + a wooden handle.' },
  { id: 'gear_train', name: 'Gear Train', inputs: [{ kind: 'gear' }, { kind: 'gear' }], result: { type: 'item', sprite: 'gear_train', name: '{0} Gear Train', kind: 'mechanism' }, desc: 'Two cast gears meshed together.' },
  { id: 'jewel_ring', name: 'Jewelled Ring', inputs: [{ kind: 'ring', tag: 'precious' }, { kind: 'gem' }], result: { type: 'item', sprite: 'jewel_ring', name: '{1}-set {0} Ring', kind: 'jewellery' }, desc: 'A precious-metal ring + a carved gem (ruby, emerald, sapphire or diamond).' },
  { id: 'crown', name: 'Crown', inputs: [{ kind: 'bar', tag: 'precious' }, { kind: 'ring', tag: 'precious' }, { kind: 'gem' }], result: { type: 'item', sprite: 'crown', name: '{0} Crown', kind: 'jewellery' }, desc: 'A precious bar, a precious ring and a gem.' },
  { id: 'bell', name: 'Bell', inputs: [{ kind: 'ingot', mat: ['bronze'] }, { kind: 'ingot', mat: ['bronze'] }], result: { type: 'item', sprite: 'bell', name: 'Bronze Bell', kind: 'bell' }, desc: 'Two bronze ingots.' },
  { id: 'ladle', name: 'Pouring Ladle', inputs: [{ kind: 'ingot', tag: 'ferrous' }, { kind: 'longbar' }], result: { type: 'object', object: 'ladle' }, desc: 'Iron/steel ingot + any bar stock → a working ladle.' },
  { id: 'crucible', name: 'Crucible', inputs: [{ kind: 'chunk', mat: ['graphite'] }, { kind: 'chunk', mat: ['graphite'] }], result: { type: 'object', object: 'crucible' }, desc: 'Two carved graphite chunks → a new crucible.' },
  { id: 'fuel_heater', name: 'Fuel Heater', inputs: [{ kind: 'ingot', tag: 'ferrous' }, { kind: 'ingot', tag: 'ferrous' }, { kind: 'longbar', mat: ['copper', 'brass', 'bronze'] }], result: { type: 'object', object: 'fuel_heater' }, desc: 'Two iron/steel ingots + copper-alloy bar stock.' },
  { id: 'cooling_station', name: 'Cooling Station', inputs: [{ kind: 'ingot', mat: ['aluminum'] }, { kind: 'ingot', mat: ['aluminum'] }, { kind: 'gear' }], result: { type: 'object', object: 'cooling_station' }, desc: 'Two aluminium ingots + a gear (for the compressor).' },
  { id: 'thermometer', name: 'Thermometer', inputs: [{ kind: 'longbar', tag: 'ferrous' }, { kind: 'chunk', mat: ['glass', 'quartz'] }], result: { type: 'object', object: 'thermometer' }, desc: 'Iron/steel bar stock + a chunk of glass.' },
];

function circlePixels(cx, cy, r0, r1, char, out) {
  const R = Math.ceil(r1) + 1;
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
    const d = Math.hypot(x, y);
    if (d >= r0 && d <= r1) out.set(`${cx + x},${cy + y}`, char);
  }
}

function gearPixels(cx, cy, out, char) {
  for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) {
    const d = Math.hypot(x + 0.01, y);
    const tooth = Math.cos(8 * Math.atan2(y, x)) > 0.2;
    if (d >= 1.6 && d <= (tooth ? 6.4 : 4.8)) out.set(`${cx + x},${cy + y}`, char);
  }
}

function mapToRows(map) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of map.keys()) {
    const [x, y] = k.split(',').map(Number);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const rows = [];
  for (let y = y0; y <= y1; y++) {
    let s = '';
    for (let x = x0; x <= x1; x++) s += map.get(`${x},${y}`) || '.';
    rows.push(s);
  }
  return rows;
}

/** Sprite rows for crafted items. Legend chars: A = first input material, B = second, C = third. */
export const SPRITES = {
  sword: () => [
    '.....A..........................',
    'AA.BBAAAAAAAAAAAAAAAAAAAAAAAAA..',
    'AABBBAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'AA.BBAAAAAAAAAAAAAAAAAAAAAAAAA..',
    '.....A..........................',
  ],
  hammer: () => [
    'AAAAAAAAA',
    'AAAAAAAAA',
    'AAAAAAAAA',
    '...BBB...',
    '...BBB...',
    '...BBB...',
    '...BBB...',
    '...BBB...',
    '...BBB...',
    '...BBB...',
    '...BBB...',
  ],
  gear_train: () => {
    const m = new Map();
    gearPixels(7, 7, m, 'A');
    gearPixels(19, 9, m, 'B');
    return mapToRows(m);
  },
  jewel_ring: () => {
    const m = new Map();
    circlePixels(6, 8, 3.2, 5.0, 'A', m);
    for (let y = 1; y <= 3; y++) for (let x = 5; x <= 7; x++) m.set(`${x},${y}`, 'B');
    m.set('6,0', 'B');
    return mapToRows(m);
  },
  crown: () => [
    'A.....A.....A',
    'AA...AAA...AA',
    'AAA.AACAA.AAA',
    'AAAAAAAAAAAAA',
    'ABAAAAAAAAABA',
    'AAAAAAAAAAAAA',
  ],
  bell: () => [
    '....AA....',
    '...AAAA...',
    '..AAAAAA..',
    '..AAAAAA..',
    '..AAAAAA..',
    '.AAAAAAAA.',
    '.AAAAAAAA.',
    'AAAAAAAAAA',
    'AAAAAAAAAA',
    '....BB....',
  ],
};
