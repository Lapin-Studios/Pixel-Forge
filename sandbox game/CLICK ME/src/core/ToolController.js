// Player tools: painting, erasing, heat gun, grabbing / tilting objects, carving, inspecting, spawning.
import { rng, walkLine, clamp } from '../utils/MathUtils.js';
import { STATE, POWER } from '../materials/MaterialProperties.js';
import { MASK, isCavityKind } from '../objects/WorldObject.js';
import { Item } from '../objects/Item.js';
import { collides } from '../physics/ObjectPhysics.js';
import { createObject, OBJECT_TYPES, deserializeObject } from '../objects/ObjectFactory.js';
import { Ragdoll } from '../objects/Ragdoll.js';
import { findReaction } from '../materials/Reactions.js';

export const TOOLS = [
  { id: 'brush', name: 'Brush', key: '1', icon: '🖌', desc: 'Paint the selected material. Right-click erases.' },
  { id: 'erase', name: 'Eraser', key: '2', icon: '⌫', desc: 'Remove cells.' },
  { id: 'heat', name: 'Heat Gun', key: '3', icon: '🔥', desc: 'Heat cells and objects under the brush.' },
  { id: 'cool', name: 'Freeze Spray', key: '4', icon: '❄', desc: 'Cool cells and objects under the brush.' },
  { id: 'hand', name: 'Hand', key: '5', icon: '✋', desc: 'Pick up, carry, tilt and pour objects.' },
  { id: 'inspect', name: 'Inspect', key: '6', icon: '🔍', desc: 'Inspect cells and objects; toggle switches; operate machines.' },
  { id: 'carve', name: 'Carve', key: '7', icon: '⛏', desc: 'Cut a connected solid (wood, gems, metal…) loose as a movable item.' },
  { id: 'mix', name: 'Mix', key: '8', icon: '🌀', desc: 'Stir everything under the brush — powders, liquids, gases and the contents of pots and crucibles. Things that combine dissolve into each other straight away (salt into water, flour into milk, tin into copper…).' },
  { id: 'line', name: 'Line', key: '9', icon: '📏', desc: 'Drag to draw a perfectly straight line of the selected material (right-drag erases a line).' },
  { id: 'rope', name: 'Rope', key: '0', icon: '🪢', desc: 'Drag from one thing to another to tie them together — objects, ragdoll parts, pins, walls or thin air. Things hanging from a rope swing. Right-click a rope or pin to remove it.' },
  { id: 'pin', name: 'Pin', key: 'K', icon: '📍', desc: 'Click an object or ragdoll part to pin it in place (objects can still swivel), or click empty space to place a pin to tie ropes to. Right-click removes.' },
];

const ROT_SPEED = Math.PI * 0.6; // rad/s while Q/E held

export class ToolController {
  constructor(game) {
    this.game = game;
    this.tool = 'brush';
    this.material = game.registry.id('sand');
    this.spawnType = null;
    this.spawnGhost = null;
    this.brushSize = 3;
    this.brushShape = 'circle';
    this.replace = false;
    this.direction = 0;
    this.held = null;
    this.heldDoll = null;
    this.lineStart = null;  // Line tool drag start
    this.ropeStart = null;  // Rope tool drag start
    this.clipboard = null;  // Ctrl+C / Ctrl+V
    this.spoutMaterial = game.registry.id('water');
    this.grabLocal = [0, 0];
    this.selected = null;
    this.stroke = null; // { button, lastX, lastY, mode }
    this.panning = null;
    this.hover = { wx: 0, wy: 0, x: 0, y: 0, inside: false, obj: null };
    this.heldTrail = [];
    this.listeners = [];
    const input = game.input;
    input.on('down', (e) => this.onDown(e));
    input.on('move', (e) => this.onMove(e));
    input.on('up', (e) => this.onUp(e));
    input.on('wheel', (e) => this.onWheel(e));
    input.on('leave', () => { this.hover.inside = false; });
    input.on('blur', () => { this.endStroke(); this.panning = null; this.lineStart = null; this.ropeStart = null; if (this.held) this.release(); if (this.heldDoll) this.releaseDoll(); });
  }

  onChange(fn) { this.listeners.push(fn); }
  changed() { for (const fn of this.listeners) fn(); }

  get reg() { return this.game.registry; }
  get world() { return this.game.world; }

  setTool(id) {
    if (this.held && id !== 'hand') this.release();
    if (this.heldDoll && id !== 'hand') this.releaseDoll();
    if (id !== this.tool) this.game.audio?.play('tool');
    this.tool = id;
    if (id !== 'spawn') { this.spawnType = null; this.spawnGhost = null; }
    this.changed();
  }

  selectMaterial(id) {
    // Electronics get a thin brush automatically (and the old size comes back afterwards).
    const elec = this.reg.defs[id]?.tab === 'electronics';
    if (elec && this.savedBrush == null) { this.savedBrush = this.brushSize; this.brushSize = Math.min(this.brushSize, 1); }
    else if (!elec && this.savedBrush != null) { this.brushSize = this.savedBrush; this.savedBrush = null; }
    // A spout pours whatever you had selected before picking it.
    if (id === this.reg.SPOUT && this.material !== this.reg.SPOUT && this.material) {
      this.spoutMaterial = this.material;
      this.game.toast?.(`Spout will pour ${this.reg.name(this.material)} — pick another material first to change it`);
    }
    this.material = id;
    this.game.ui?.palette?.revealMaterial(id);
    if (this.tool !== 'brush') this.setTool('brush');
    const dirs = this.reg.directional[id];
    if (dirs && this.direction >= dirs) this.direction = 0;
    this.changed();
  }

  selectSpawn(type) {
    this.setTool('spawn');
    this.spawnType = type;
    const ghost = OBJECT_TYPES[type]?.ghost;
    if (ghost) { this.spawnGhost = { ...ghost }; this.changed(); return; }
    try {
      const o = createObject(this.game, type);
      const fp = o.getFootprint();
      this.spawnGhost = { w: fp.maxX - fp.minX + 1, h: fp.maxY - fp.minY + 1 };
    } catch (e) { this.spawnGhost = null; }
    this.changed();
  }

  setBrushSize(n) {
    this.brushSize = clamp(Math.round(n), 0, 40);
    this.changed();
  }

  showsBrush() {
    return ['brush', 'erase', 'heat', 'cool', 'mix', 'line'].includes(this.tool) || (this.stroke && this.stroke.mode === 'erase');
  }

  updateHover() {
    const cam = this.game.camera, input = this.game.input;
    const [wx, wy] = cam.screenToWorld(input.sx, input.sy);
    const h = this.hover;
    h.wx = wx; h.wy = wy;
    h.x = Math.floor(wx); h.y = Math.floor(wy);
    h.inside = input.inside && this.world && this.world.inBounds(h.x, h.y);
    h.doll = h.inside && !this.held && !this.heldDoll ? this.game.objects.dollAt(wx, wy, this.tool === 'hand' ? 2.5 : 1) : null;
    h.obj = h.inside && !this.held && !h.doll ? this.game.objects.objectAt(wx, wy, this.tool === 'hand' ? 2 : 0) : null;
  }

  // ------------------------------------------------------------------ pointer

  onDown(e) {
    this.game.audio?.ensure();
    this.updateHover();
    const { wx, wy } = this.hover;
    if (e.button === 1 || (e.button === 0 && e.alt)) {
      this.panning = { sx: e.sx, sy: e.sy };
      return;
    }
    if (e.button === 2) {
      if (this.held) { this.release(); return; }
      if (this.heldDoll) { this.releaseDoll(); return; }
      if (this.tool === 'rope' || this.tool === 'pin') {
        this.game.history.push('Remove rope / pin');
        if (this.game.objects.ropes.removeAt(wx, wy)) { this.game.audio?.play('delete'); this.game.toast('Removed'); }
        else this.game.history.undoStack.pop();
        return;
      }
      if (this.tool === 'line') { this.lineStart = { x: this.hover.x, y: this.hover.y, erase: true, button: 2 }; return; }
      this.beginStroke('erase', 2);
      return;
    }
    if (e.button !== 0) return;

    const objHere = this.hover.obj;
    const om = this.hover.inside ? this.world.objMask[this.hover.y * this.world.w + this.hover.x] : 0;

    const dollHere = this.hover.doll;
    if (dollHere && (this.tool === 'hand' || this.tool === 'spawn')) { this.grabDoll(dollHere.doll, dollHere.k); return; }
    if (dollHere && this.tool === 'inspect') {
      this.selected = { type: 'object', obj: dollHere.doll };
      this.game.ui?.inspector?.refresh(true);
      this.game.audio?.play('click');
      return;
    }

    switch (this.tool) {
      case 'line':
        this.lineStart = { x: this.hover.x, y: this.hover.y, erase: false, button: 0 };
        return;
      case 'rope':
        this.ropeStart = { wx, wy, att: this.game.objects.ropes.attachmentAt(wx, wy) };
        return;
      case 'pin':
        this.game.history.push('Pin');
        this.game.toast(this.game.objects.ropes.placePin(wx, wy));
        this.game.audio?.play('clink', 0.8);
        return;
      case 'hand':
        if (objHere) this.grab(objHere, wx, wy);
        else if (this.hover.inside) this.toggleSwitchAt(this.hover.x, this.hover.y);
        break;
      case 'inspect':
        this.inspectAt(wx, wy, objHere);
        break;
      case 'carve':
        this.carveAt(this.hover.x, this.hover.y);
        break;
      case 'spawn':
        if (objHere) { this.grab(objHere, wx, wy); break; }
        this.spawnAt(wx, wy);
        break;
      case 'heat':
      case 'cool':
      case 'mix':
        this.beginStroke(this.tool, 0);
        break;
      default: // brush / erase
        if (objHere && om > 0) { this.grab(objHere, wx, wy); break; }
        // Clicking a switch with the brush flips it (unless you're painting switches).
        if (this.tool === 'brush' && this.material !== this.reg.SWITCH && this.hover.inside
          && this.world.cells[this.hover.y * this.world.w + this.hover.x] === this.reg.SWITCH
          && this.toggleSwitchAt(this.hover.x, this.hover.y)) break;
        this.beginStroke(this.tool === 'erase' ? 'erase' : 'paint', 0);
    }
  }

  onMove(e) {
    if (this.panning) {
      this.game.camera.panBy(e.sx - this.panning.sx, e.sy - this.panning.sy);
      this.panning.sx = e.sx;
      this.panning.sy = e.sy;
    }
    this.updateHover();
    this.game.ui?.inspector?.onHover();
  }

  onUp(e) {
    if (this.panning) { this.panning = null; return; }
    if (this.held && e.button === 0) this.release();
    if (this.heldDoll && e.button === 0) this.releaseDoll();
    if (this.lineStart && e.button === this.lineStart.button) this.finishLine();
    if (this.ropeStart && e.button === 0) this.finishRope();
    if (this.stroke) this.endStroke();
  }

  /** Line tool: paint (or erase) a straight line from where the drag started to here. */
  finishLine() {
    const s = this.lineStart;
    this.lineStart = null;
    if (!s || !this.hover.inside) return;
    const erase = s.erase;
    this.game.history.push(erase ? 'Erase line' : `Line of ${this.reg.name(this.material)}`);
    this.stroke = { mode: erase ? 'erase' : 'paint', button: s.button };
    let changed = 0;
    walkLine(s.x, s.y, this.hover.x, this.hover.y, (x, y) => { changed += this.paintAt(x, y, erase); });
    if (changed) this.strokeSound(erase, this.hover.wx, this.hover.wy);
    else this.game.history.undoStack.pop();
    this.endStroke();
  }

  /** Rope tool: tie whatever is at the drag start to whatever is here (pins are made as needed). */
  finishRope() {
    const s = this.ropeStart;
    this.ropeStart = null;
    if (!s) return;
    const { wx, wy } = this.hover;
    if (Math.hypot(wx - s.wx, wy - s.wy) < 1.5) { this.game.toast('Drag from one thing to another to tie a rope', 'info'); return; }
    const ropes = this.game.objects.ropes;
    this.game.history.push('Rope');
    const a = s.att && ropes.aliveAtt(s.att) ? s.att : { kind: 'pin', pin: ropes.addPin(s.wx, s.wy) };
    let b = ropes.attachmentAt(wx, wy);
    if (b && ropes.sameThing(a, b)) b = null;
    if (!b) b = { kind: 'pin', pin: ropes.addPin(wx, wy) };
    ropes.addRope(a, b);
    this.game.audio?.play('creak', 1);
    this.game.toast(`Tied a ${Math.round(Math.hypot(wx - s.wx, wy - s.wy))}-cell rope`);
  }

  endStroke() {
    this.stroke = null;
  }


  onWheel(e) {
    if (this.held) {
      this.rotateHeld(Math.sign(e.delta) * (Math.PI / 24));
      return;
    }
    if (e.shift || e.alt) {
      this.setBrushSize(this.brushSize + (e.delta > 0 ? -1 : 1));
      return;
    }
    this.game.camera.zoomAt(e.sx, e.sy, Math.pow(1.0015, -e.delta));
  }

  beginStroke(mode, button) {
    if (mode === 'paint' || mode === 'erase') this.game.history.push(mode === 'paint' ? `Paint ${this.reg.name(this.material)}` : 'Erase');
    else if (mode === 'mix') this.game.history.push('Mix');
    // Shift+drag paints a straight line (snapped to 45°) from where the stroke started.
    const line = (mode === 'paint' || mode === 'erase') && this.game.input.isDown('shift');
    this.stroke = { mode, button, lastX: this.hover.wx, lastY: this.hover.wy, x0: this.hover.wx, y0: this.hover.wy, line, axis: null };
    this.applyStroke(true);
  }

  applyStroke(first = false, dt = 1 / 60) {
    const s = this.stroke;
    if (!s) return;
    const { wx, wy } = this.hover;
    if (s.mode === 'heat' || s.mode === 'cool') {
      this.applyTemperature(wx, wy, s.mode === 'heat' ? 1 : -1, dt);
      this.game.audio?.playAt(s.mode === 'heat' ? 'torch' : 'spray', wx, wy);
      return;
    }
    if (s.mode === 'mix') {
      this.mixAt(wx, wy);
      this.game.audio?.playAt('swish', wx, wy);
      return;
    }
    const erase = s.mode === 'erase';
    let changed = 0;
    let px = wx, py = wy;
    if (s.line) [px, py] = this.snapLine(s, wx, wy);
    // Work in whole cells (the same cell the cursor square shows), so a click paints exactly there.
    const cx = Math.floor(px), cy = Math.floor(py);
    // The 1-px brush is a pencil: one pixel per cell visited, no stream while the mouse is held still.
    const pencil = this.brushSize === 0;
    if (!first && pencil && cx === s.cellX && cy === s.cellY) return;
    if (first) changed += this.paintAt(cx, cy, erase);
    else {
      walkLine(s.cellX, s.cellY, cx, cy, (x, y) => {
        if (pencil && x === s.cellX && y === s.cellY) return;
        changed += this.paintAt(x, y, erase);
      });
    }
    if (changed > 0) this.strokeSound(erase, wx, wy);
    s.cellX = cx;
    s.cellY = cy;
    s.lastX = px;
    s.lastY = py;
  }

  /** Constrain a straight-line stroke to horizontal, vertical or 45° (direction locks after a few cells). */
  snapLine(s, wx, wy) {
    const dx = wx - s.x0, dy = wy - s.y0;
    if (!s.axis) {
      if (Math.abs(dx) + Math.abs(dy) < 3) return [s.x0, s.y0];
      const ax = Math.abs(dx), ay = Math.abs(dy);
      s.axis = ax > ay * 2 ? 'h' : ay > ax * 2 ? 'v' : 'd';
      s.sx = Math.sign(dx) || 1; s.sy = Math.sign(dy) || 1;
    }
    if (s.axis === 'h') return [wx, s.y0];
    if (s.axis === 'v') return [s.x0, wy];
    const d = Math.max(0, (dx * s.sx + dy * s.sy) / 2);
    return [s.x0 + s.sx * d, s.y0 + s.sy * d];
  }

  paintAt(cx, cy, erase) {
    const world = this.world, reg = this.reg;
    const r = this.brushSize;
    const m = erase ? 0 : this.material;
    const st = reg.state[m];
    const scatter = !erase && r > 1 && this.game.settings.get('brushScatter') && (st === STATE.POWDER || st === STATE.LIQUID || st === STATE.GAS || st === STATE.FIRE);
    const density = scatter ? 0.35 : 1;
    const dirs = reg.directional[m];
    const life = dirs ? (dirs === 2 ? (this.direction === 1 ? -1 : 1) : this.direction) : null;
    // Electronic parts drop straight into existing wiring (a switch painted onto a wire replaces it).
    const elecOver = !erase && reg.powerKind[m] !== 0 && reg.defs[m]?.tab === 'electronics';
    let changed = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (this.brushShape === 'circle' && dx * dx + dy * dy > r * r + r * 0.6) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
        const i = y * world.w + x;
        const om = world.objMask[i];
        if (om < 0) {
          // Paint straight into (or erase from) a container's cavity.
          const o = this.game.objects.byId.get(-om);
          if (!o) continue;
          const li = world.objLocal[i];
          if (erase) { if (isCavityKind(o.mask[li]) && o.mat[li]) { o.mat[li] = 0; o.life[li] = 0; changed++; } continue; }
          if (density < 1 && rng() > density) continue;
          if (o.acceptContent(li, m)) {
            o.mat[li] = m;
            const dt = reg.defTemp[m];
            o.temp[li] = Number.isNaN(dt) ? world.ambient : dt;
            o.life[li] = 0;
            changed++;
          }
          continue;
        }
        if (om !== 0) continue;
        const cur = world.cells[i];
        if (erase) {
          if (cur !== 0 && !(reg.indestructible[cur] && !this.game.settings.get('eraseBedrock'))) { world.clearCell(i); changed++; }
          continue;
        }
        if (cur === m) continue;
        if (cur !== 0 && !this.replace && !(elecOver && reg.powerKind[cur] !== 0 && reg.defs[cur]?.tab === 'electronics')) continue;
        if (cur !== 0 && reg.indestructible[cur]) continue;
        if (density < 1 && rng() > density) continue;
        world.setCell(i, m);
        changed++;
        if (m === reg.SPOUT) world.life[i] = this.spoutMaterial || reg.id('water');
        if (life !== null) world.life[i] = life;
        if (m === reg.SWITCH) world.life[i] = 1;
        if (m === reg.THERMOSTAT) world.life[i] = this.game.settings.get('thermostatDefault');
        if (m === reg.HEAT_SENSOR) world.life[i] = 100;
        if (m === reg.HEAT_LIMITER) world.life[i] = this.game.settings.get('heatLimit');
      }
    }
    return changed;
  }

  /** Brush sound that fits the material being painted (or erased). */
  strokeSound(erase, wx, wy) {
    const audio = this.game.audio;
    if (!audio) return;
    if (erase) { audio.playAt('erase', wx, wy); return; }
    const st = this.reg.state[this.material];
    const name = st === STATE.POWDER ? 'paintPowder' : st === STATE.LIQUID ? 'paintLiquid' : st === STATE.GAS ? 'paintGas' : st === STATE.FIRE ? 'paintFire' : 'paintSolid';
    audio.playAt(name, wx, wy);
  }

  applyTemperature(wx, wy, sign, dt) {
    const world = this.world, objects = this.game.objects;
    const r = this.brushSize;
    const cx = Math.floor(wx), cy = Math.floor(wy);
    const rate = 1600 * dt;
    const limit = sign > 0 ? 4000 : -250;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + r * 0.6) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
        const i = y * world.w + x;
        const om = world.objMask[i];
        if (om !== 0) {
          const o = objects.byId.get(Math.abs(om));
          if (o) {
            const li = world.objLocal[i];
            o.temp[li] = sign > 0 ? Math.min(limit, o.temp[li] + rate) : Math.max(limit, o.temp[li] - rate);
          }
          continue;
        }
        world.temp[i] = sign > 0 ? Math.min(limit, world.temp[i] + rate) : Math.max(limit, world.temp[i] - rate);
        world.wake(i);
      }
    }
    for (const d of this.game.objects.dolls) d.heatAt(wx, wy, r, sign * rate);
    if (rng() < 0.3) {
      if (sign > 0) this.game.particles.embers(wx, wy, 1);
      else this.game.particles.frost(wx, wy);
    }
  }

  /**
   * Stir: swap neighbouring loose cells (powders, liquids, gases) with each other under the brush,
   * plus the contents of any container under it. Only material swaps with material — nothing is
   * thrown into the air — and each cell moves at most a couple of cells, so it blends in place.
   */
  mixAt(wx, wy) {
    const world = this.world, reg = this.reg;
    const W = world.w, H = world.h;
    const r = Math.max(1, this.brushSize);
    const cx = Math.floor(wx), cy = Math.floor(wy);
    const loose = (m) => m !== 0 && reg.state[m] !== STATE.SOLID && reg.state[m] !== STATE.FIRE && !reg.indestructible[m];
    const inBrush = (x, y) => {
      const dx = x - cx, dy = y - cy;
      return this.brushShape === 'circle' ? dx * dx + dy * dy <= r * r + r * 0.6 : Math.abs(dx) <= r && Math.abs(dy) <= r;
    };
    const cells = [];
    const inObjects = new Map();
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H || !inBrush(x, y)) continue;
        const i = y * W + x;
        const om = world.objMask[i];
        if (om < 0) {
          const o = this.game.objects.byId.get(-om);
          if (!o || !o.swapLocal) continue;
          const li = world.objLocal[i];
          const m = o.mat[li];
          if (!isCavityKind(o.mask[li]) || !m) continue;
          if (reg.state[m] === STATE.SOLID && !o.looseSolids) continue; // keep castings intact
          if (!inObjects.has(o)) inObjects.set(o, []);
          inObjects.get(o).push(li);
          continue;
        }
        if (om === 0 && loose(world.cells[i])) cells.push(i);
      }
    }
    // World: swap each picked cell with a loose neighbour up to 2 cells away.
    const n = cells.length;
    for (let k = 0, swaps = Math.ceil(n * 0.5); k < swaps && n; k++) {
      const a = cells[(rng() * n) | 0];
      const ax = a % W, ay = (a / W) | 0;
      const bx = ax + ((rng() * 5) | 0) - 2, by = ay + ((rng() * 5) | 0) - 2;
      if (bx < 0 || by < 0 || bx >= W || by >= H || !inBrush(bx, by)) continue;
      const b = by * W + bx;
      if (b === a || world.objMask[b] !== 0 || !loose(world.cells[b]) || world.cells[b] === world.cells[a]) continue;
      world.swap(a, b);
    }
    // Dissolve: anything that can combine with what it's stirred into does so right away
    // (salt into water, flour into milk, sugar into water, molten tin into copper…).
    const sim = this.game.sim;
    for (let k = 0, tries = Math.ceil(n * 0.6); k < tries && n; k++) {
      const a = cells[(rng() * n) | 0];
      const ma = world.cells[a];
      if (!ma || !reg.hasReaction[ma]) continue;
      const ax = a % W, ay = (a / W) | 0;
      const d = (rng() * 4) | 0;
      const bx = ax + (d === 0 ? 1 : d === 1 ? -1 : 0), by = ay + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (bx < 0 || by < 0 || bx >= W || by >= H) continue;
      const b = by * W + bx;
      const mb = world.cells[b];
      if (!mb || world.objMask[b] !== 0) continue;
      const r = findReaction(reg, ma, mb, Math.max(world.temp[a], world.temp[b]));
      if (r) { sim.applyReaction(r, a, b); world.wake(a); world.wake(b); }
    }
    // Container contents: same local stirring inside the cavity.
    for (const [o, list] of inObjects) {
      const c = list.length;
      for (let k = 0, swaps = Math.ceil(c * 0.5); k < swaps && c > 1; k++) {
        const a = list[(rng() * c) | 0];
        const bx = (a % o.w) + ((rng() * 5) | 0) - 2, by = ((a / o.w) | 0) + ((rng() * 5) | 0) - 2;
        if (bx < 0 || by < 0 || bx >= o.w || by >= o.h) continue;
        const b = by * o.w + bx;
        if (b === a || !isCavityKind(o.mask[b]) || !o.mat[b] || o.mat[b] === o.mat[a]) continue;
        if (reg.state[o.mat[b]] === STATE.SOLID && !o.looseSolids) continue;
        o.swapLocal(a, b);
      }
      // ...and dissolve / combine inside the pot or crucible too.
      for (let k = 0, tries = Math.ceil(c * 0.6); k < tries && c; k++) {
        const a = list[(rng() * c) | 0];
        const ma = o.mat[a];
        if (!ma || !reg.hasReaction[ma]) continue;
        const d = (rng() * 4) | 0;
        const bx = (a % o.w) + (d === 0 ? 1 : d === 1 ? -1 : 0), by = ((a / o.w) | 0) + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (bx < 0 || by < 0 || bx >= o.w || by >= o.h) continue;
        const b = by * o.w + bx;
        const mb = o.mat[b];
        if (!mb || !isCavityKind(o.mask[b])) continue;
        const r = findReaction(reg, ma, mb, Math.max(o.temp[a], o.temp[b]));
        if (!r) continue;
        if (r.outSelf >= 0) { o.mat[a] = r.outSelf; if (r.outSelf) o.temp[a] = reg.stabilize(r.outSelf, o.temp[a] + r.heat); this.game.discovery?.material(r.outSelf); }
        if (r.outOther >= 0) { o.mat[b] = r.outOther; if (r.outOther) o.temp[b] = reg.stabilize(r.outOther, o.temp[b] + r.heat); this.game.discovery?.material(r.outOther); }
        this.game.discovery?.reaction(r.def.id);
      }
    }
  }

  // ------------------------------------------------------------------ objects

  grab(o, wx, wy) {
    this.game.history.push(`Move ${o.name}`);
    this.held = o;
    o.held = true;
    o.vx = 0;
    o.vy = 0;
    o.angVel = 0;
    this.grabLocal = o.worldToLocal(wx, wy);
    this.heldTrail = [];
    this.selected = { type: 'object', obj: o };
    this.game.audio?.play('pickup');
    this.game.ui?.inspector?.refresh(true);
    this.changed();
  }

  /** Pick a ragdoll up by body part k; it dangles from the cursor until released. */
  grabDoll(d, k) {
    if (this.held) this.release();
    this.game.history.push('Move ragdoll');
    d.grab = k;
    this.heldDoll = d;
    this.selected = { type: 'object', obj: d };
    this.game.audio?.play('pickup');
    this.game.ui?.inspector?.refresh(true);
    this.changed();
  }

  releaseDoll() {
    const d = this.heldDoll;
    if (!d) return;
    this.heldDoll = null;
    d.grab = -1;
    d.knockdown = Math.max(d.knockdown, 10); // lands first, then finds his feet
    d.standT = Math.min(d.standT, 0.2);
    this.game.audio?.play('drop', 0.5);
    this.changed();
  }

  deleteDoll(d) {
    this.game.history.push('Delete ragdoll');
    if (this.heldDoll === d) this.releaseDoll();
    const [cx, cy] = d.center();
    this.game.objects.removeDoll(d);
    this.game.audio?.playAt('delete', cx, cy);
    this.game.particles?.dust(cx, cy, 6, 4);
    this.changed();
  }

  release() {
    const o = this.held;
    if (!o) return;
    this.held = null;
    o.held = false;
    // Throw velocity from recent motion.
    const tr = this.heldTrail;
    if (tr.length >= 2) {
      const a = tr[0], b = tr[tr.length - 1];
      const dtF = Math.max(1, b.f - a.f);
      o.vx = clamp((b.x - a.x) / dtF, -2.5, 2.5);
      o.vy = clamp((b.y - a.y) / dtF, -2.5, 2.5);
    }
    this.heldTrail = [];
    if (o.isItem) {
      const r = this.game.objects.tryDepositAt(o, o.ox, o.oy);
      if (r === 'deposited') { this.changed(); return; }
    }
    this.game.audio?.play('drop', 0.6);
    this.changed();
  }

  onObjectRemoved(o) {
    if (this.held === o) { this.held = null; }
    if (this.heldDoll === o) { this.heldDoll = null; }
    if (this.selected && this.selected.obj === o) this.selected = null;
    if (this.hover.obj === o) this.hover.obj = null;
  }

  heldTarget() {
    const o = this.held;
    const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
    const gx = this.grabLocal[0] - o.px, gy = this.grabLocal[1] - o.py;
    return [this.hover.wx - (ca * gx - sa * gy), this.hover.wy - (sa * gx + ca * gy)];
  }

  moveHeld() {
    const o = this.held;
    if (!o || o.dead) { this.held = null; return; }
    const ctx = this.game.objects.syncCtx();
    const [tx, ty] = this.heldTarget();
    let dx = tx - o.x, dy = ty - o.y;
    const steps = Math.min(24, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    if (steps > 0) {
      const sx = dx / steps, sy = dy / steps;
      const allowCav = o.isItem;
      for (let s = 0; s < steps; s++) {
        const nx = o.x + sx, ny = o.y + sy;
        if (!collides(o, Math.round(nx), Math.round(ny), ctx, allowCav)) { o.x = nx; o.y = ny; continue; }
        if (!collides(o, Math.round(nx), o.oy, ctx, allowCav)) { o.x = nx; continue; }
        if (!collides(o, o.ox, Math.round(ny), ctx, allowCav)) { o.y = ny; continue; }
        break;
      }
    }
    if (o.ox !== o._lastOx || o.oy !== o._lastOy) {
      o._lastOx = o.ox; o._lastOy = o.oy;
      this.game.objects.restamp(o);
    }
    this.heldTrail.push({ x: o.x, y: o.y, f: this.game.frame });
    if (this.heldTrail.length > 6) this.heldTrail.shift();
  }

  rotateHeld(delta) {
    const o = this.held || (this.hover.obj && this.tool === 'hand' ? this.hover.obj : null);
    if (!o) return;
    if (this.rotateObject(o, o.angle + delta)) {
      const b = o.bounds();
      this.game.audio?.playAt('creak', (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0.8);
    }
  }

  rotateObject(o, angle) {
    const ctx = this.game.objects.syncCtx();
    const prev = o.angle;
    // Rotate about the grab point when held so the pour feels anchored to the hand.
    const before = this.held === o ? o.localToWorld(this.grabLocal[0], this.grabLocal[1]) : null;
    o.angle = angle;
    if (before) {
      const after = o.localToWorld(this.grabLocal[0], this.grabLocal[1]);
      o.x += before[0] - after[0];
      o.y += before[1] - after[1];
    }
    for (const lift of [0, -1, -2, -3]) {
      if (!collides(o, o.ox, o.oy + lift, ctx, o.isItem)) {
        o.y += lift;
        this.game.objects.restamp(o);
        return true;
      }
    }
    o.angle = prev;
    if (before) {
      const back = o.localToWorld(this.grabLocal[0], this.grabLocal[1]);
      o.x += before[0] - back[0];
      o.y += before[1] - back[1];
    }
    return false;
  }

  spawnAt(wx, wy) {
    if (!this.spawnType) return;
    if (OBJECT_TYPES[this.spawnType]?.ragdoll) {
      this.game.history.push('Place ragdoll');
      const d = this.game.objects.spawnDoll(wx, wy);
      if (!d) { this.game.history.undoStack.pop(); this.game.toast('No room for a ragdoll here.', 'warn'); this.game.audio?.play('error'); return; }
      this.game.audio?.play('drop');
      this.selected = { type: 'object', obj: d };
      this.game.ui?.inspector?.refresh(true);
      return;
    }
    this.game.history.push('Place object');
    const o = this.game.objects.spawn(this.spawnType, wx, wy);
    if (!o) {
      this.game.history.undoStack.pop();
      this.game.toast('No room to place that here.', 'warn');
      this.game.audio?.play('error');
      return;
    }
    this.game.audio?.play('drop');
    this.selected = { type: 'object', obj: o };
    this.game.ui?.inspector?.refresh(true);
  }

  deleteObject(o) {
    if (!o) return;
    this.game.history.push(`Delete ${o.name}`);
    const b = o.bounds();
    this.game.objects.remove(o);
    this.game.audio?.playAt('delete', (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    this.game.particles?.dust((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 6, (b.x1 - b.x0) / 3);
    this.changed();
  }

  // ------------------------------------------------------------------ copy / paste

  /** Ctrl+C: copy the hovered / held / selected object or ragdoll. */
  copy() {
    const sel = this.selected?.type === 'object' ? this.selected.obj : null;
    const target = this.heldDoll || this.hover.doll?.doll || this.held || this.hover.obj || (sel && !sel.dead ? sel : null);
    if (!target) { this.game.toast('Hover over an object or ragdoll to copy it', 'info'); return; }
    this.clipboard = { doll: !!target.isRagdoll, data: JSON.parse(JSON.stringify(target.serialize())), name: target.name };
    this.game.audio?.play('blip');
    this.game.toast(`Copied ${target.name} — Ctrl+V pastes it at the cursor`);
  }

  /** Ctrl+V: paste a copy of the clipboard at the cursor. */
  paste() {
    const clip = this.clipboard;
    if (!clip) { this.game.toast('Nothing copied yet — hover an object and press Ctrl+C', 'info'); return; }
    if (!this.hover.inside) return;
    const { wx, wy } = this.hover;
    this.game.history.push(`Paste ${clip.name}`);
    if (clip.doll) {
      const d = Ragdoll.deserialize(this.game, clip.data);
      if (!d) { this.game.history.undoStack.pop(); return; }
      const [cx, cy] = d.center();
      for (let k = 0; k < d.x.length; k++) {
        d.x[k] += wx - cx; d.y[k] += wy - cy;
        d.px[k] = d.fx[k] = d.x[k]; d.py[k] = d.fy[k] = d.y[k];
      }
      this.game.objects.dolls.push(d);
      this.selected = { type: 'object', obj: d };
    } else {
      const o = deserializeObject(this.game, clip.data);
      const placed = o && this.game.objects.spawn(o, wx, wy);
      if (!placed) {
        this.game.history.undoStack.pop();
        this.game.toast('No room to paste here', 'warn');
        this.game.audio?.play('error');
        return;
      }
      placed.vx = 0; placed.vy = 0;
      this.selected = { type: 'object', obj: placed };
    }
    this.game.audio?.play('drop');
    this.game.ui?.inspector?.refresh(true);
    this.changed();
  }

  // ------------------------------------------------------------------ inspect / carve / switches

  inspectAt(wx, wy, obj) {
    if (obj) {
      this.selected = { type: 'object', obj };
    } else if (this.hover.inside) {
      const x = Math.floor(wx), y = Math.floor(wy);
      const i = y * this.world.w + x;
      const m = this.world.cells[i];
      if (m === this.reg.SWITCH) this.toggleSwitchAt(x, y);
      this.selected = { type: 'cell', x, y };
    } else this.selected = null;
    this.game.ui?.inspector?.refresh(true);
    this.game.audio?.play('click');
  }

  toggleSwitchAt(x, y) {
    const world = this.world;
    if (!world.inBounds(x, y)) return false;
    const i = y * world.w + x;
    if (world.cells[i] !== this.reg.SWITCH) return false;
    // Toggle the whole connected switch block.
    const target = world.life[i] === 1 ? 0 : 1;
    const stack = [i];
    const seen = new Set([i]);
    while (stack.length && seen.size < 400) {
      const j = stack.pop();
      world.life[j] = target;
      world.wake(j);
      const jx = j % world.w, jy = (j / world.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = jx + dx, ny = jy + dy;
        if (!world.inBounds(nx, ny)) continue;
        const k = ny * world.w + nx;
        if (!seen.has(k) && world.cells[k] === this.reg.SWITCH) { seen.add(k); stack.push(k); }
      }
    }
    this.game.audio?.playAt('relay', x, y, 1.4);
    this.game.toast(target ? 'Switch ON' : 'Switch OFF');
    return true;
  }

  carveAt(x, y) {
    const world = this.world, reg = this.reg;
    if (!world.inBounds(x, y)) return;
    const start = y * world.w + x;
    const m0 = world.cells[start];
    if (m0 === 0 || reg.state[m0] !== STATE.SOLID || reg.indestructible[m0] || world.objMask[start]) {
      this.game.toast('Carve works on solid cells (wood, stone, metal, gems…).', 'warn');
      return;
    }
    const isCarvable = (m) => m !== 0 && reg.state[m] === STATE.SOLID && !reg.indestructible[m] && reg.behavior[m] === 0 && reg.powerKind[m] !== POWER.SOURCE;
    const sameOnly = !this.game.input.isDown('shift');
    const seen = new Set([start]);
    const stack = [start];
    const cells = [];
    while (stack.length) {
      const i = stack.pop();
      const ix = i % world.w, iy = (i / world.w) | 0;
      cells.push({ x: ix, y: iy, m: world.cells[i], t: world.temp[i] });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = ix + dx, ny = iy + dy;
        if (!world.inBounds(nx, ny)) continue;
        const j = ny * world.w + nx;
        if (seen.has(j) || world.objMask[j]) continue;
        const mj = world.cells[j];
        if (sameOnly ? mj !== m0 : !isCarvable(mj)) continue;
        seen.add(j);
        stack.push(j);
      }
    }
    this.game.history.push('Carve');
    for (const c of cells) world.clearCell(c.y * world.w + c.x);
    const def = reg.get(m0);
    const gem = reg.hasTag(m0, 'gem');
    const item = Item.fromCells(this.game, cells, {
      name: gem ? `${def.name} Gem` : `${def.name} Chunk`,
      kind: gem ? 'gem' : 'chunk',
      material: def.key,
      description: gem ? 'A cut gemstone — set it in a ring at the workbench.' : 'A carved piece of material.',
    });
    this.game.objects.add(item);
    this.game.audio?.playAt('chisel', x, y);
    this.game.particles.dust(x, y, 6, 3);
    this.selected = { type: 'object', obj: item };
    this.game.toast(`Carved ${item.name} (${cells.length} cells). Drag it with the Hand tool.`);
    this.game.ui?.inspector?.refresh(true);
  }

  // ------------------------------------------------------------------ per-frame

  update(dt) {
    this.updateHover();
    const input = this.game.input;
    // Continuous strokes (painting while holding still keeps pouring material).
    if (this.stroke) {
      if (!(input.buttons & (this.stroke.button === 2 ? 2 : 1))) this.endStroke();
      else this.applyStroke(false, dt);
    }
    if (this.heldDoll && !(input.buttons & 1) && !input.inside) this.releaseDoll();
    if (this.heldDoll && !this.game.running) this.heldDoll.dragPaused(this.hover.wx, this.hover.wy);
    if (this.held) {
      // Mouse released outside the canvas.
      if (!(input.buttons & 1) && !input.inside) this.release();
      if (this.held) {
        const q = input.isDown('q'), e = input.isDown('e');
        if (q !== e) this.rotateHeld((e ? 1 : -1) * ROT_SPEED * dt);
        this.moveHeld();
      }
    }
    // Keyboard panning
    const pan = 900 * dt;
    let px = 0, py = 0;
    if (input.isDown('a') || input.isDown('arrowleft')) px -= pan;
    if (input.isDown('d') || input.isDown('arrowright')) px += pan;
    if (input.isDown('w') || input.isDown('arrowup')) py -= pan;
    if (input.isDown('s') || input.isDown('arrowdown')) py += pan;
    if ((px || py) && !(input.isDown('control') || input.isDown('meta'))) this.game.camera.panBy(-px, -py, false);
  }

  /** Keyboard shortcuts that act on the cursor / held object. Returns true if handled. */
  handleKey(e) {
    const k = e.key.toLowerCase();
    const target = this.held || this.hover.obj;
    for (const t of TOOLS) if (t.key.toLowerCase() === k && !e.ctrlKey && !e.metaKey) { this.setTool(t.id); return true; }
    switch (k) {
      case 'r':
        if (target) { this.rotateObject(target, 0); return true; }
        return false;
      case 'delete':
      case 'backspace': {
        const doll = this.heldDoll || this.hover.doll?.doll;
        if (doll) { this.deleteDoll(doll); return true; }
        if (target) { this.deleteObject(target); return true; }
        return false;
      }
      case 'x':
        if (target && target.castShape) { this.game.crafting.extractCasting(target); return true; }
        return false;
      case 'f':
        if (target && target.isItem) { this.game.history.push('Place item'); this.game.objects.fuseItem(target); return true; }
        return false;
      case 't':
        return this.toggleSwitchAt(this.hover.x, this.hover.y);
      case '[':
        this.setBrushSize(this.brushSize - 1); return true;
      case ']':
        this.setBrushSize(this.brushSize + 1); return true;
      case 'escape':
        if (this.lineStart || this.ropeStart) { this.lineStart = null; this.ropeStart = null; return true; }
        if (this.held) { this.release(); return true; }
        if (this.heldDoll) { this.releaseDoll(); return true; }
        if (this.tool === 'spawn') { this.setTool('hand'); return true; }
        this.selected = null;
        this.game.ui?.inspector?.refresh(true);
        return false;
      default:
        return false;
    }
  }
}
