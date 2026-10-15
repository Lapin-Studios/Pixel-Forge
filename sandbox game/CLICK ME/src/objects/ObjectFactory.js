// Registry of every spawnable object type (containers, moulds, tools, machines) and deserialisation.
import { Crucible, CONTAINER_INFO } from './Crucible.js';
import { Mold, MOLD_INFO } from './Mold.js';
import { Thermometer, CastingTable, Workbench, TOOL_INFO } from './Tools.js';
import { Item } from './Item.js';
import { MACHINE_OBJECTS } from '../machines/MachineRegistry.js';
import { CookingPot, FryingPan, HotPlate, ChamberAppliance, KITCHEN_INFO } from '../machines/Kitchen.js';
import { base64ToBytes } from '../utils/MathUtils.js';
import { drawRagdollIcon } from './Ragdoll.js';

export const OBJECT_TYPES = {
  ragdoll: {
    name: 'Ragdoll Human', group: 'People', ragdoll: true, ghost: { w: 12, h: 48 }, drawIcon: drawRagdollIcon,
    desc: 'A reactive human, People Playground style. He never moves on his own: grab any body part with the Hand tool to drag, dangle and throw him. Feels impacts, fire, lava, cold, electric shocks, acid and drowning.',
  },
  crucible: { ...CONTAINER_INFO.crucible, group: 'Containers', create: (g) => new Crucible(g, 'crucible') },
  crucible_large: { ...CONTAINER_INFO.crucible_large, group: 'Containers', create: (g) => new Crucible(g, 'crucible_large') },
  ladle: { ...CONTAINER_INFO.ladle, group: 'Containers', create: (g) => new Crucible(g, 'ladle') },
  bucket: { ...CONTAINER_INFO.bucket, group: 'Containers', create: (g) => new Crucible(g, 'bucket') },
  mold_ingot: { ...MOLD_INFO.mold_ingot, group: 'Moulds', create: (g) => new Mold(g, 'mold_ingot') },
  mold_gold_bar: { ...MOLD_INFO.mold_gold_bar, group: 'Moulds', create: (g) => new Mold(g, 'mold_gold_bar') },
  mold_copper_bar: { ...MOLD_INFO.mold_copper_bar, group: 'Moulds', create: (g) => new Mold(g, 'mold_copper_bar') },
  mold_ring: { ...MOLD_INFO.mold_ring, group: 'Moulds', create: (g) => new Mold(g, 'mold_ring') },
  mold_gear: { ...MOLD_INFO.mold_gear, group: 'Moulds', create: (g) => new Mold(g, 'mold_gear') },
  mold_blade: { ...MOLD_INFO.mold_blade, group: 'Moulds', create: (g) => new Mold(g, 'mold_blade') },
  ...MACHINE_OBJECTS,
  casting_table: { ...TOOL_INFO.casting_table, group: 'Workshop', create: (g) => new CastingTable(g) },
  workbench: { ...TOOL_INFO.workbench, group: 'Workshop', create: (g) => new Workbench(g) },
  thermometer: { ...TOOL_INFO.thermometer, group: 'Workshop', create: (g) => new Thermometer(g) },
  cooking_pot: { ...KITCHEN_INFO.cooking_pot, group: 'Kitchen', create: (g) => new CookingPot(g) },
  frying_pan: { ...KITCHEN_INFO.frying_pan, group: 'Kitchen', create: (g) => new FryingPan(g) },
  hot_plate: { ...KITCHEN_INFO.hot_plate, group: 'Kitchen', create: (g) => new HotPlate(g) },
  oven: { ...KITCHEN_INFO.oven, group: 'Kitchen', create: (g) => new ChamberAppliance(g, 'oven') },
  fridge: { ...KITCHEN_INFO.fridge, group: 'Kitchen', create: (g) => new ChamberAppliance(g, 'fridge') },
};

export function createObject(game, type) {
  const t = OBJECT_TYPES[type];
  if (!t || !t.create) throw new Error(`Unknown object type "${type}"`);
  return t.create(game);
}

/** Rebuild an object from serialized data; returns null if invalid. */
export function deserializeObject(game, data) {
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return null;
  let obj;
  if (data.type === 'item') {
    const w = data.w | 0, h = data.h | 0;
    if (w <= 0 || h <= 0 || w * h > 40000) return null;
    const mask = base64ToBytes(data.mask);
    if (mask.length !== w * h) return null;
    obj = new Item(game, {
      w, h, mask, mat: new Uint16Array(w * h), name: data.name || 'Item',
      pivot: data.state && Number.isFinite(data.state.px) ? [data.state.px, data.state.py] : undefined,
    });
    obj.loadState(data.state);
  } else {
    if (!OBJECT_TYPES[data.type]?.create) return null;
    obj = createObject(game, data.type);
    obj.loadState?.(data.state);
  }
  if (data.mask && data.mat && data.temp && !obj.restoreGrids(data)) return null;
  obj.x = Number.isFinite(data.x) ? data.x : 0;
  obj.y = Number.isFinite(data.y) ? data.y : 0;
  obj.angle = Number.isFinite(data.angle) ? data.angle : 0;
  obj.vx = Number.isFinite(data.vx) ? data.vx : 0;
  obj.vy = Number.isFinite(data.vy) ? data.vy : 0;
  obj.anchored = !!data.anchored;
  if (data.name && data.type === 'item') obj.name = String(data.name).slice(0, 60);
  return obj;
}

export function objectPaletteGroups() {
  const groups = new Map();
  for (const [key, t] of Object.entries(OBJECT_TYPES)) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push({ key, ...t });
  }
  return groups;
}
