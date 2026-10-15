// Solid items: castings, carved chunks and crafted goods. Every pixel is a real material cell
// with its own temperature, so items glow, cool, melt and can be remelted in a crucible.
import { WorldObject, MASK } from './WorldObject.js';
import { formatTemp } from '../utils/MathUtils.js';

export class Item extends WorldObject {
  constructor(game, spec) {
    super(game, { ...spec, type: 'item', impactSound: spec.impactSound || 'clink' });
    this.isItem = true;
    this.kind = spec.kind || 'chunk';
    this.material = spec.material || '';
    this.quality = spec.quality ?? 1;
    this.description = spec.description || '';
    this.category = 'Item';
  }

  /** Build an item whose pixels sit exactly on the given world cells. cells: [{x, y, m, t}] */
  static fromCells(game, cells, meta = {}) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of cells) {
      if (c.x < x0) x0 = c.x; if (c.x > x1) x1 = c.x;
      if (c.y < y0) y0 = c.y; if (c.y > y1) y1 = c.y;
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const mask = new Uint8Array(w * h);
    const mat = new Uint16Array(w * h);
    for (const c of cells) {
      const li = (c.y - y0) * w + (c.x - x0);
      mask[li] = MASK.WALL;
      mat[li] = c.m;
    }
    const item = new Item(game, { ...meta, w, h, mask, mat });
    for (const c of cells) item.temp[(c.y - y0) * w + (c.x - x0)] = c.t;
    item.x = x0 + item.px;
    item.y = y0 + item.py;
    if (!meta.material) item.material = game.registry.get(item.dominantMaterial())?.key || '';
    return item;
  }

  /** Build from an ASCII sprite. legend: char -> material id. */
  static fromSprite(game, rows, legend, meta = {}, temp) {
    const h = rows.length, w = Math.max(...rows.map((r) => r.length));
    const mask = new Uint8Array(w * h);
    const mat = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (!ch || ch === '.' || ch === ' ') continue;
      const m = legend[ch];
      if (!m) continue;
      mask[y * w + x] = MASK.WALL;
      mat[y * w + x] = m;
    }
    const item = new Item(game, { ...meta, w, h, mask, mat });
    if (temp !== undefined) item.temp.fill(temp);
    return item;
  }

  pixelCount() {
    return this.wallCount();
  }

  dominantMaterial() {
    const counts = new Map();
    for (let i = 0; i < this.mask.length; i++) {
      if (this.mask[i] !== MASK.WALL) continue;
      counts.set(this.mat[i], (counts.get(this.mat[i]) || 0) + 1);
    }
    let best = 0, bc = 0;
    for (const [m, c] of counts) if (c > bc) { best = m; bc = c; }
    return best;
  }

  update(ctx) {
    if ((this.age++ & 3) === 0) {
      this.checkWalls(ctx);
      if (this.wallCount() === 0) this.dead = true;
    }
  }

  describe() {
    const unit = this.game.settings?.get('tempUnit');
    const t = this.avgTemp('wall');
    const mm = this.dominantMaterial();
    const melt = this.reg.hotT[mm];
    const rows = [
      ['Type', this.kind],
      ['Material', this.reg.name(mm)],
      ['Pixels', String(this.pixelCount())],
      ['Temperature', formatTemp(t, unit)],
    ];
    if (Number.isFinite(melt)) rows.push(['Melts at', formatTemp(melt, unit)]);
    if (this.quality < 1) rows.push(['Quality', `${Math.round(this.quality * 100)}%`]);
    return {
      title: this.name,
      subtitle: this.description || 'Item',
      rows,
      bars: Number.isFinite(melt) ? [{ label: 'Heat vs melting point', value: Math.max(0, Math.min(1, t / melt)), color: '#ff8a2a' }] : [],
      controls: [
        { type: 'button', id: 'fuse', label: 'Place into world (F)', onClick: () => this.game.objects.fuseItem(this) },
      ],
    };
  }

  hint() {
    return 'Drag to carry · drop into a crucible to remelt · rest on a workbench to craft · F to place as cells';
  }

  saveState() {
    return { kind: this.kind, material: this.material, quality: this.quality, description: this.description, px: this.px, py: this.py };
  }

  loadState(s) {
    if (!s) return;
    this.kind = s.kind || this.kind;
    this.material = s.material || this.material;
    this.quality = s.quality ?? this.quality;
    this.description = s.description || '';
  }
}
