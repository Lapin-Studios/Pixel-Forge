// Example worlds are declarative JSON (worlds/*.json): drawing ops + objects. This module builds them.
import { fbm, hash2, walkLine, seedRng } from '../utils/MathUtils.js';

export const PRESETS = [
  { id: 'blank', file: 'worlds/blank.json', name: 'Blank Map', icon: '⬛', desc: 'A completely empty world — no floor, no objects. The bottom edge of the map acts as the ground.' },
  { id: 'foundry', file: 'worlds/foundry.json', name: 'The Foundry', icon: '🏭', desc: 'A working foundry: fuel and electric furnaces with gold and copper already melting, moulds on a casting table, ore bins and a workbench.' },
  { id: 'kitchen', file: 'worlds/kitchen.json', name: 'Kitchen', icon: '🍳', desc: 'Fridge making ice cream, oven baking bread, eggs frying, rice simmering, a pantry of ingredients, solar-powered lights and a pressure-plate doorbell.' },
  { id: 'empty-workshop', file: 'worlds/empty-workshop.json', name: 'Empty Workshop', icon: '🛠', desc: 'A clean workshop floor with the basic tools. Build your own setup.' },
  { id: 'volcano', file: 'worlds/volcano.json', name: 'Volcano', icon: '🌋', desc: 'A lava-filled mountain between a forest and a lake. Dig a channel to release the lava — trees burn, snow melts, obsidian forms.' },
  { id: 'water-experiment', file: 'worlds/water-experiment.json', name: 'Water Lab', icon: '💧', desc: 'Pumps, pipes, a powered boiler and a condenser running a full water cycle.' },
  { id: 'small-factory', file: 'worlds/small-factory.json', name: 'Small Factory', icon: '⚙', desc: 'Conveyors feed ore into a hopper, thermostat-controlled kiln, fans and lamps on a switched circuit.' },
];

/** Built-in fallback when JSON presets cannot be fetched (e.g. opened via file://). */
export const FALLBACK_PRESET = {
  name: 'Fallback Workshop',
  width: 400, height: 225, ambient: 22,
  ops: [
    { op: 'rect', mat: 'bedrock', x: 0, y: 215, w: 400, h: 10 },
    { op: 'rect', mat: 'concrete', x: 0, y: 205, w: 400, h: 10 },
    { op: 'rect', mat: 'gold_ore', x: 330, y: 190, w: 20, h: 15 },
    { op: 'rect', mat: 'coal', x: 360, y: 190, w: 20, h: 15 },
  ],
  objects: [
    { type: 'furnace', x: 80, bottom: 204, state: { fuel: 20000, target: 1300 } },
    { type: 'crucible', x: 85, bottom: 181, fill: [{ mat: 'gold', count: 60 }] },
    { type: 'casting_table', x: 200, bottom: 204 },
    { type: 'mold_gold_bar', x: 195, bottom: 196 },
    { type: 'workbench', x: 280, bottom: 204 },
  ],
};

export class WorldPresets {
  constructor(game) {
    this.game = game;
    this.cache = new Map();
  }

  async fetchPreset(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const p = PRESETS.find((x) => x.id === id);
    if (!p) throw new Error(`Unknown preset ${id}`);
    // The bundled build (dist/pixel-forge.js) embeds every world so it runs from file://.
    const embedded = typeof window !== 'undefined' ? window.__PIXELFORGE_WORLDS : null;
    if (embedded && embedded[p.file]) {
      const data = JSON.parse(JSON.stringify(embedded[p.file]));
      this.cache.set(id, data);
      return data;
    }
    const res = await fetch(p.file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load ${p.file} (${res.status})`);
    const data = await res.json();
    this.cache.set(id, data);
    return data;
  }

  /** Build a world from a preset description. */
  build(preset) {
    const game = this.game;
    const reg = game.registry;
    const W = Math.max(64, Math.min(1600, preset.width | 0 || 480));
    const H = Math.max(64, Math.min(900, preset.height | 0 || 270));
    game.newWorld(W, H, preset.ambient ?? 22);
    const world = game.world;
    seedRng(preset.seed || 12345);

    const id = (k) => {
      if (k === 'empty' || k === 'air') return 0;
      if (!reg.has(k)) { console.warn(`Preset material ${k} unknown`); return -1; }
      return reg.id(k);
    };
    const put = (x, y, m, op) => {
      if (m < 0 || x < 0 || y < 0 || x >= W || y >= H) return;
      const i = y * W + x;
      if (op.onlyEmpty && world.cells[i] !== 0) return;
      if (op.within && world.cells[i] !== id(op.within)) return;
      if (op.density !== undefined && hash2(x, y, op.seed || 7) > op.density) return;
      world.setCell(i, m, op.temp);
      if (op.life !== undefined) world.life[i] = op.life;
    };

    for (const op of preset.ops || []) {
      try {
        const m = op.mat !== undefined ? id(op.mat) : -1;
        switch (op.op) {
          case 'rect':
            for (let y = op.y; y < op.y + op.h; y++) for (let x = op.x; x < op.x + op.w; x++) put(x, y, m, op);
            break;
          case 'frame':
            for (let y = op.y; y < op.y + op.h; y++) for (let x = op.x; x < op.x + op.w; x++) {
              const t = op.t || 1;
              if (x < op.x + t || x >= op.x + op.w - t || y >= op.y + op.h - t || (op.top && y < op.y + t)) put(x, y, m, op);
            }
            break;
          case 'circle':
            for (let y = op.y - op.r; y <= op.y + op.r; y++) for (let x = op.x - op.r; x <= op.x + op.r; x++) {
              if ((x - op.x) ** 2 + (y - op.y) ** 2 <= op.r * op.r) put(x, y, m, op);
            }
            break;
          case 'line': {
            const r = Math.max(0, ((op.width || 1) - 1) / 2);
            walkLine(op.x1, op.y1, op.x2, op.y2, (x, y) => {
              if (r === 0) put(x, y, m, op);
              else for (let dy = -Math.floor(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.floor(r); dx <= Math.ceil(r); dx++) put(x + dx, y + dy, m, op);
            });
            break;
          }
          case 'terrain': {
            // Heightmap ground: base row, noise amplitude, optional mountain peaks and top layers.
            const x0 = op.x0 ?? 0, x1 = op.x1 ?? W;
            for (let x = x0; x < x1; x++) {
              let top = op.base - fbm(x * (op.freq || 0.02), 0.5, op.seed || 1, 4) * (op.amp || 0);
              for (const p of op.peaks || []) {
                const d = Math.abs(x - p.x) / p.w;
                if (d < 1) top -= p.h * (1 - d * d);
              }
              top = Math.round(top);
              for (let y = Math.max(0, top); y < H; y++) {
                if (world.cells[y * W + x] !== 0 && !op.replace) continue;
                let mm = m;
                for (const layer of op.layers || []) if (y - top < layer.depth) { mm = id(layer.mat); break; }
                put(x, y, mm, op);
              }
            }
            break;
          }
          case 'noise': {
            // Replace `within` material with `mat` where noise exceeds threshold (ore veins).
            const x0 = op.x ?? 0, y0 = op.y ?? 0, x1 = x0 + (op.w ?? W), y1 = y0 + (op.h ?? H);
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
              if (x < 0 || y < 0 || x >= W || y >= H) continue;
              const i = y * W + x;
              if (op.within && world.cells[i] !== id(op.within)) continue;
              if (fbm(x * (op.scale || 0.08), y * (op.scale || 0.08), op.seed || 3, 3) > (op.threshold ?? 0.65)) world.setCell(i, m, op.temp);
            }
            break;
          }
          case 'scatter': {
            for (let y = op.y; y < op.y + op.h; y++) for (let x = op.x; x < op.x + op.w; x++) {
              if (hash2(x, y, op.seed || 11) < (op.chance ?? 0.1)) put(x, y, m, { ...op, density: undefined });
            }
            break;
          }
          case 'set':
            put(op.x, op.y, m, op);
            break;
          case 'temp':
            for (let y = op.y; y < op.y + op.h; y++) for (let x = op.x; x < op.x + op.w; x++) {
              if (x >= 0 && y >= 0 && x < W && y < H) world.temp[y * W + x] = op.value;
            }
            break;
          default:
            console.warn(`Unknown preset op ${op.op}`);
        }
      } catch (e) {
        console.warn('Preset op failed', op, e);
      }
    }

    for (const spec of preset.objects || []) {
      try {
        const o = game.objects.spawn(spec.type, spec.x, spec.y ?? spec.bottom - 5, { bottom: spec.bottom, searchUp: 40 });
        if (!o) { console.warn('No room for preset object', spec); continue; }
        if (spec.angle) { o.angle = (spec.angle * Math.PI) / 180; o.dirtyStamp = true; }
        if (spec.state) o.loadState?.(spec.state);
        if (spec.anchored) o.anchored = true;
        for (const f of spec.fill || []) o.fillWith?.(f.mat, f.count, f.temp);
        if (spec.temp !== undefined) o.temp.fill(spec.temp);
        game.objects.restamp(o);
      } catch (e) {
        console.warn('Preset object failed', spec, e);
      }
    }

    world.wakeAll();
    seedRng((Date.now() & 0x7fffffff) | 1);
    const cam = preset.camera;
    if (cam) game.camera.setView(cam.x, cam.y, cam.zoom);
    else game.camera.fitWorld(W, H);
  }
}
