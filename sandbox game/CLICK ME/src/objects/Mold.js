// Casting moulds. The cavity shape (PART cells) defines the finished casting; SPRUE cells are the
// pour channel and are trimmed off as scrap. Solid contents stay put so the casting keeps its shape.
import { Container } from './Container.js';
import { MASK, parseShape, shapeFromFn } from './WorldObject.js';
import { STATE } from '../materials/MaterialProperties.js';
import { formatTemp } from '../utils/MathUtils.js';

export const MOLD_INFO = {
  mold_ingot: { name: 'Ingot Mould', shape: 'ingot', desc: 'Rectangular ingot cavity (16×4). Any metal.' },
  mold_gold_bar: { name: 'Gold Bar Mould', shape: 'bar', desc: 'Classic tapered bullion bar. Pour molten gold for a Gold Bar.' },
  mold_copper_bar: { name: 'Copper Bar Mould', shape: 'longbar', desc: 'Long bar-stock mould. Copper bar stock is used for wiring and machines.' },
  mold_ring: { name: 'Ring Mould', shape: 'ring', desc: 'Ring cavity fed by a sprue. Pour slowly into the channel.' },
  mold_gear: { name: 'Gear Mould', shape: 'gear', desc: 'Eight-tooth gear with axle hole, fed by a sprue.' },
  mold_blade: { name: 'Sword Blade Mould', shape: 'blade', desc: 'Vertical blade mould with the tang at the top. Fill it to the brim.' },
};

function buildShape(reg, kind) {
  const W = { k: MASK.WALL, mat: 'refractory' };
  const P = { k: MASK.PART };
  const S = { k: MASK.CAVITY };
  switch (kind) {
    case 'ingot':
      return parseShape(reg, [
        '##pppppppppppppppp##',
        '##pppppppppppppppp##',
        '##pppppppppppppppp##',
        '##pppppppppppppppp##',
        '####################',
        '.##################.',
      ], { '#': W, p: P });
    case 'bar':
      return parseShape(reg, [
        '##pppppppppppppp##',
        '###pppppppppppp###',
        '####pppppppppp####',
        '#####pppppppp#####',
        '##################',
        '.################.',
      ], { '#': W, p: P });
    case 'longbar':
      return parseShape(reg, [
        '##pppppppppppppppppppppppppp##',
        '##pppppppppppppppppppppppppp##',
        '##############################',
        '.############################.',
      ], { '#': W, p: P });
    case 'ring': {
      const cx = 8.5, cy = 10.5;
      return shapeFromFn(reg, 17, 18, (x, y) => {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        if (d >= 3.0 && d <= 6.4) return P;
        if (x >= 7 && x <= 9 && y + 0.5 < cy - 5.5) return S;
        return W;
      });
    }
    case 'gear': {
      const cx = 10.5, cy = 12.5;
      return shapeFromFn(reg, 21, 23, (x, y) => {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        const phi = Math.atan2(dy, dx);
        const tooth = Math.cos(8 * phi) > 0.2;
        const outer = tooth ? 8.4 : 6.2;
        if (d >= 2.3 && d <= outer) return P;
        if (x >= 9 && x <= 11 && y + 0.5 < cy - 7.5) return S;
        return W;
      });
    }
    case 'blade':
      return shapeFromFn(reg, 11, 34, (x, y) => {
        if (y <= 5 && x >= 4 && x <= 6) return P;           // tang
        if (y >= 6 && y <= 28 && x >= 3 && x <= 7) return P; // blade
        if ((y === 29 || y === 30) && x >= 4 && x <= 6) return P;
        if (y === 31 && x === 5) return P;                   // tip
        return W;
      });
    default:
      throw new Error(`Unknown mould shape ${kind}`);
  }
}

export class Mold extends Container {
  constructor(game, type = 'mold_ingot') {
    const info = MOLD_INFO[type] || MOLD_INFO.mold_ingot;
    const shape = buildShape(game.registry, info.shape);
    super(game, { type, name: info.name, category: 'Mould', ...shape, looseSolids: false, impactSound: 'thud' });
    this.castShape = info.shape;
    this.acceptsItems = false;
  }

  accepts(m) {
    if (m === 0) return false;
    const s = this.reg.state[m];
    return s === STATE.LIQUID || s === STATE.POWDER;
  }

  /** Casting status of the PART cavity. */
  status() {
    const reg = this.reg;
    let total = 0, filled = 0, liquid = 0, solid = 0;
    const mats = new Map();
    let maxT = -Infinity;
    for (let li = 0; li < this.mask.length; li++) {
      if (this.mask[li] !== MASK.PART) continue;
      total++;
      const m = this.mat[li];
      if (!m) continue;
      filled++;
      if (this.temp[li] > maxT) maxT = this.temp[li];
      const s = reg.state[m];
      if (s === STATE.LIQUID) liquid++;
      else if (s === STATE.SOLID) solid++;
      mats.set(m, (mats.get(m) || 0) + 1);
    }
    let main = 0, mainCount = 0;
    for (const [m, c] of mats) if (c > mainCount) { main = m; mainCount = c; }
    return { total, filled, liquid, solid, main, mixed: mats.size > 1, maxT };
  }

  statusText() {
    const s = this.status();
    if (s.filled === 0) return 'Empty';
    if (s.liquid > 0) return `Molten · ${Math.round((s.filled / s.total) * 100)}% full`;
    if (s.solid === s.filled) return s.filled / s.total >= 0.92 ? 'Solid — ready to extract (X)' : `Solid · ${Math.round((s.filled / s.total) * 100)}% filled`;
    return 'Filled with loose material';
  }

  describe() {
    const d = super.describe();
    const s = this.status();
    const unit = this.game.settings?.get('tempUnit');
    d.subtitle = `Mould · ${this.castShape}`;
    d.rows = [
      ['Status', this.statusText()],
      ['Cavity', `${s.filled} / ${s.total} cells`],
      ['Hottest cell', s.filled ? formatTemp(s.maxT, unit) : '—'],
      ['Mould temp', formatTemp(this.avgTemp('wall'), unit)],
    ];
    if (s.main) d.rows.splice(1, 0, ['Material', this.reg.name(s.main) + (s.mixed ? ' (mixed)' : '')]);
    d.bars = [
      { label: 'Filled', value: s.total ? s.filled / s.total : 0, color: '#6fa8dc' },
      { label: 'Solidified', value: s.filled ? s.solid / s.filled : 0, color: '#9ad17a' },
    ];
    d.controls = [
      { type: 'button', id: 'extract', label: 'Extract casting (X)', primary: true, disabled: s.filled === 0 || s.liquid > 0, onClick: () => this.game.crafting.extractCasting(this) },
      { type: 'button', id: 'empty', label: 'Clear mould', onClick: () => this.dumpContents() },
    ];
    return d;
  }

  hint() {
    return 'Pour molten metal into the cavity · let it cool · press X to extract the casting';
  }
}
