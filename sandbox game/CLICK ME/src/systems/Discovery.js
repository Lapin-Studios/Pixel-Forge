// Tracks what the player has produced (materials, reactions, castings, crafts) for the recipe book.
const KEY = 'pixelforge.discoveries.v1';

export class Discovery {
  constructor(game) {
    this.game = game;
    const n = game.registry.count;
    this.matFlags = new Uint8Array(n);
    this.materials = new Set();
    this.reactions = new Set();
    this.crafts = new Set();
    this.listeners = [];
    this._saveTimer = null;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      for (const k of d.materials || []) {
        if (this.game.registry.has(k)) {
          this.materials.add(k);
          this.matFlags[this.game.registry.id(k)] = 1;
        }
      }
      for (const r of d.reactions || []) this.reactions.add(r);
      for (const c of d.crafts || []) this.crafts.add(c);
    } catch (e) {
      console.warn('Could not read discoveries', e);
    }
  }

  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ materials: [...this.materials], reactions: [...this.reactions], crafts: [...this.crafts] }));
      } catch (e) { /* storage full or blocked: discoveries are non-critical */ }
    }, 1500);
  }

  onDiscover(fn) { this.listeners.push(fn); }

  emit(type, id) {
    for (const fn of this.listeners) fn(type, id);
    this.save();
  }

  material(m) {
    if (!m || this.matFlags[m]) return;
    this.matFlags[m] = 1;
    const key = this.game.registry.get(m)?.key;
    if (!key) return;
    this.materials.add(key);
    this.emit('material', key);
  }

  reaction(id) {
    if (this.reactions.has(id)) return;
    this.reactions.add(id);
    this.emit('reaction', id);
  }

  craft(id) {
    if (this.crafts.has(id)) return;
    this.crafts.add(id);
    this.emit('craft', id);
  }

  reset() {
    this.matFlags.fill(0);
    this.materials.clear();
    this.reactions.clear();
    this.crafts.clear();
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  get total() {
    return this.materials.size + this.reactions.size + this.crafts.size;
  }
}
