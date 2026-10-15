// Local persistence: named saves in localStorage, JSON export / import with validation.
// Material ids are stored alongside their keys so saves survive library changes.
import { rleEncode, rleDecode, bytesToBase64, base64ToBytes } from '../utils/MathUtils.js';

const INDEX_KEY = 'pixelforge.saves.index';
const SAVE_PREFIX = 'pixelforge.save.';
const AUTOSAVE_ID = 'autosave';
export const SAVE_FORMAT = 'pixelforge-world';
export const SAVE_VERSION = 1;
const MAX_CELLS = 4_000_000;

export class SaveManager {
  constructor(game) {
    this.game = game;
  }

  // ------------------------------------------------------------ serialisation

  serialize(name = 'Untitled') {
    const game = this.game, world = game.world, reg = game.registry;
    const temps = new Int16Array(world.size);
    for (let i = 0; i < world.size; i++) temps[i] = Math.max(-273, Math.min(9000, Math.round(world.temp[i])));
    return {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      name,
      savedAt: new Date().toISOString(),
      width: world.w,
      height: world.h,
      ambient: world.ambient,
      materials: reg.defs.map((d) => d.key),
      cells: rleEncode(world.cells),
      temp: rleEncode(temps),
      life: rleEncode(world.life),
      burn: rleEncode(world.burn),
      pipe: rleEncode(world.pipe),
      objects: game.objects.serialize(),
      settings: { speed: game.speed, paused: !game.running },
      camera: { x: game.camera.x, y: game.camera.y, zoom: game.camera.zoom },
      tick: game.sim.tick,
    };
  }

  /** Validate structure; throws a descriptive Error on failure. */
  validate(data) {
    if (!data || typeof data !== 'object') throw new Error('File is not a world save (not a JSON object).');
    if (data.format !== SAVE_FORMAT) throw new Error('File is not a Pixel Forge world (missing format tag).');
    if (typeof data.version !== 'number' || data.version > SAVE_VERSION) throw new Error(`Unsupported save version ${data.version}.`);
    const w = data.width, h = data.height;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 32 || h < 32 || w * h > MAX_CELLS) throw new Error('Invalid world dimensions.');
    for (const k of ['cells', 'temp']) if (typeof data[k] !== 'string') throw new Error(`Missing "${k}" data.`);
    if (!Array.isArray(data.materials)) throw new Error('Missing material table.');
    if (data.objects && !Array.isArray(data.objects)) throw new Error('Corrupt object list.');
    return true;
  }

  /** Build an id remap from the save's material table to the current registry. */
  buildIdMap(data) {
    const reg = this.game.registry;
    const map = new Uint16Array(Math.max(1, data.materials.length));
    let unknown = 0;
    data.materials.forEach((key, id) => {
      if (reg.has(key)) map[id] = reg.id(key);
      else { map[id] = 0; if (key !== 'empty') unknown++; }
    });
    return { map, unknown };
  }

  /** Decode a save into plain arrays (throws on corruption). */
  decode(data) {
    this.validate(data);
    const n = data.width * data.height;
    const { map, unknown } = this.buildIdMap(data);
    const rawCells = rleDecode(data.cells, Uint16Array, n);
    const cells = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const v = rawCells[i];
      cells[i] = v < map.length ? map[v] : 0;
    }
    const temp = Float32Array.from(rleDecode(data.temp, Int16Array, n));
    const life = data.life ? rleDecode(data.life, Int16Array, n) : new Int16Array(n);
    const burn = data.burn ? rleDecode(data.burn, Uint16Array, n) : new Uint16Array(n);
    const rawPipe = data.pipe ? rleDecode(data.pipe, Uint16Array, n) : new Uint16Array(n);
    const pipe = new Uint16Array(n);
    for (let i = 0; i < n; i++) if (rawPipe[i]) pipe[i] = rawPipe[i] < map.length ? map[rawPipe[i]] : 0;
    // Remap object material arrays.
    const objects = (data.objects || []).map((o) => {
      if (!o || typeof o.mat !== 'string') return o;
      try {
        const bytes = base64ToBytes(o.mat);
        const arr = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.length & ~1)));
        for (let i = 0; i < arr.length; i++) arr[i] = arr[i] < map.length ? map[arr[i]] : 0;
        return { ...o, mat: bytesToBase64(new Uint8Array(arr.buffer)) };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
    return {
      width: data.width, height: data.height, ambient: Number.isFinite(data.ambient) ? data.ambient : 22,
      cells, temp, life, burn, pipe, objects, unknown,
      camera: data.camera, settings: data.settings, name: data.name,
    };
  }

  apply(data) {
    const decoded = this.decode(data);
    const failedObjects = this.game.loadDecodedWorld(decoded);
    const notes = [];
    if (decoded.unknown) notes.push(`${decoded.unknown} unknown materials skipped`);
    if (failedObjects) notes.push(`${failedObjects} objects could not be restored`);
    return notes;
  }

  // ------------------------------------------------------------ local storage

  listSaves() {
    try {
      const idx = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
      return Array.isArray(idx) ? idx.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '')) : [];
    } catch (e) {
      return [];
    }
  }

  writeIndex(list) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  }

  save(name, id = null) {
    const clean = String(name || 'Untitled').trim().slice(0, 48) || 'Untitled';
    const data = this.serialize(clean);
    const json = JSON.stringify(data);
    const saveId = id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      localStorage.setItem(SAVE_PREFIX + saveId, json);
    } catch (e) {
      throw new Error('Browser storage is full. Delete old saves or export to a file instead.');
    }
    const list = this.listSaves().filter((s) => s.id !== saveId);
    list.push({ id: saveId, name: clean, savedAt: data.savedAt, size: json.length, width: data.width, height: data.height });
    try { this.writeIndex(list); } catch (e) { throw new Error('Could not update the save index (storage full).'); }
    return saveId;
  }

  load(id) {
    const raw = localStorage.getItem(SAVE_PREFIX + id);
    if (!raw) throw new Error('Save not found.');
    let data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error('Save data is corrupted.'); }
    return this.apply(data);
  }

  delete(id) {
    localStorage.removeItem(SAVE_PREFIX + id);
    this.writeIndex(this.listSaves().filter((s) => s.id !== id));
  }

  autosave() {
    try {
      this.save('Autosave', AUTOSAVE_ID);
      return true;
    } catch (e) {
      console.warn('Autosave failed', e);
      return false;
    }
  }

  hasAutosave() {
    return this.listSaves().some((s) => s.id === AUTOSAVE_ID);
  }

  // ------------------------------------------------------------ files

  exportFile(name = 'world') {
    const data = this.serialize(name);
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9-_]+/gi, '_') || 'world'}.pixelforge.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async importFile(file) {
    if (!file) throw new Error('No file selected.');
    if (file.size > 60 * 1024 * 1024) throw new Error('File is too large to be a world save.');
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('File is not valid JSON.'); }
    return this.apply(data);
  }
}
