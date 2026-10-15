// Wires every system together and runs the fixed-timestep loop.
import { MaterialRegistry } from '../materials/MaterialRegistry.js';
import { buildReactions } from '../materials/Reactions.js';
import { World } from './World.js';
import { Simulation } from './Simulation.js';
import { Renderer } from './Renderer.js';
import { Camera } from './Camera.js';
import { InputManager } from './InputManager.js';
import { ToolController } from './ToolController.js';
import { ObjectManager } from '../objects/ObjectManager.js';
import { CraftingSystem } from '../crafting/CraftingSystem.js';
import { Particles } from '../systems/Particles.js';
import { AudioManager } from '../systems/AudioManager.js';
import { SaveManager } from '../systems/SaveManager.js';
import { WorldPresets, FALLBACK_PRESET, PRESETS } from '../systems/WorldPresets.js';
import { History } from '../systems/History.js';
import { Discovery } from '../systems/Discovery.js';
import { Soundscape } from '../systems/Soundscape.js';
import { Settings } from '../ui/Settings.js';
import { Interface } from '../ui/Interface.js';
import { PerfMonitor } from '../utils/Performance.js';
import { SPEEDS, TICK_RATE } from './Constants.js';

export class Game {
  constructor() {
    this.world = null;
    this.running = true;
    this.speed = 1;
    this.acc = 0;
    this.frame = 0;
    this.lastTime = 0;
    this.autosaveTimer = 0;
    this.worldName = 'Untitled';
  }

  async init() {
    this.registry = new MaterialRegistry();
    this.reactionList = buildReactions(this.registry);
    this.settings = new Settings();
    this.perf = new PerfMonitor();
    this.discovery = new Discovery(this);
    this.audio = new AudioManager(this.settings);
    this.particles = new Particles();
    this.camera = new Camera();
    this.audio.camera = this.camera;
    this.soundscape = new Soundscape(this);
    this.objects = new ObjectManager(this);
    this.sim = new Simulation(this);
    this.sim.fx = this.particles;
    this.crafting = new CraftingSystem(this);
    try { localStorage.removeItem('pixelforge.career.v1'); } catch (e) { /* career mode was removed */ }
    this.history = new History(this);
    this.saves = new SaveManager(this);
    this.presets = new WorldPresets(this);
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new Renderer(this, this.canvas);
    this.input = new InputManager(this.canvas);
    this.tools = new ToolController(this);
    this.ui = new Interface(this);
    this.ui.build();
    this.applySettings();
    this.settings.onChange(() => this.applySettings());

    this.input.on('keydown', (e) => this.handleKey(e));
    window.addEventListener('resize', () => this.renderer.resize());
    new ResizeObserver(() => this.renderer.resize()).observe(this.canvas);
    this.renderer.resize();

    // index.html#world=kitchen opens a specific example world.
    const hashWorld = /world=([\w-]+)/.exec(location.hash || '')?.[1];
    const startWorld = PRESETS.some((p) => p.id === hashWorld) ? hashWorld : 'foundry';
    await this.loadPreset(startWorld, { silent: true, noHistory: true });
    const hashTab = /tab=([\w-]+)/.exec(location.hash || '')?.[1];
    if (hashTab) this.ui.palette.setTab(hashTab);
    this.hashPanel = /panel=(\w+)/.exec(location.hash || '')?.[1];
    this.history.clear();
    requestAnimationFrame((t) => this.loop(t));
    this.ui.onReady();
  }

  applySettings() {
    this.particles.enabled = this.settings.get('particles');
    this.particles.density = this.settings.get('reducedMotion') ? 0.4 : 1;
    this.audio.applyVolume();
  }

  // ------------------------------------------------------------------ world lifecycle

  newWorld(w, h, ambient = 22) {
    this.objects.reset();
    this.world = new World(w, h, this.registry, ambient);
    this.sim.setWorld(this.world);
    this.renderer.setWorld(this.world);
    this.camera.setWorldSize(w, h);
    this.particles.clear();
    this.particles.setWorld(this.world, this.registry.state);
    this.tools.held = null;
    this.tools.selected = null;
    this.tools.stroke = null;
  }

  async loadPreset(id, opts = {}) {
    let data;
    try {
      data = await this.presets.fetchPreset(id);
    } catch (e) {
      console.warn(e);
      this.toast(`Could not load preset (${e.message}). Using built-in workshop — run via a local server for all presets.`, 'error');
      data = FALLBACK_PRESET;
    }
    if (!opts.noHistory && this.world) this.history.push('Load preset');
    try {
      this.presets.build(data);
      this.worldName = data.name || PRESETS.find((p) => p.id === id)?.name || 'World';
      this.ui.setWorldName(this.worldName);
      if (!opts.silent) this.toast(`Loaded ${this.worldName}`, 'success');
    } catch (e) {
      console.error(e);
      this.toast(`Preset failed to build: ${e.message}`, 'error');
      this.presets.build(FALLBACK_PRESET);
    }
    this.ui.inspector?.refresh(true);
  }

  /** Called by SaveManager with decoded arrays. Returns the number of objects that failed to load. */
  loadDecodedWorld(d) {
    this.newWorld(d.width, d.height, d.ambient);
    const w = this.world;
    w.cells.set(d.cells);
    w.temp.set(d.temp);
    w.life.set(d.life);
    w.burn.set(d.burn);
    w.pipe.set(d.pipe);
    w.wakeAll();
    const failed = this.objects.load(d.objects);
    if (d.camera && Number.isFinite(d.camera.x)) {
      this.camera.tx = this.camera.x = d.camera.x;
      this.camera.ty = this.camera.y = d.camera.y;
      if (Number.isFinite(d.camera.zoom)) this.camera.tzoom = this.camera.zoom = Math.max(this.camera.minZoom, Math.min(this.camera.maxZoom, d.camera.zoom));
    } else this.camera.fitWorld(d.width, d.height);
    if (d.settings && SPEEDS.includes(d.settings.speed)) this.setSpeed(d.settings.speed);
    this.worldName = d.name || 'Loaded world';
    this.ui.setWorldName(this.worldName);
    this.ui.inspector?.refresh(true);
    return failed;
  }

  applySnapshot(s) {
    if (!this.world || this.world.w !== s.w || this.world.h !== s.h) {
      this.newWorld(s.w, s.h, s.ambient);
    } else {
      this.objects.reset();
      this.tools.held = null;
      this.tools.stroke = null;
    }
    const w = this.world;
    w.ambient = s.ambient;
    w.cells.set(s.cells);
    w.temp.set(s.temp);
    w.life.set(s.life);
    w.burn.set(s.burn);
    w.pipe.set(s.pipe);
    w.objMask.fill(0);
    w.wakeAll();
    this.objects.load(s.objects);
    this.tools.selected = null;
    this.ui.inspector?.refresh(true);
  }

  clearWorld() {
    this.history.push('Clear world');
    this.objects.reset();
    this.world.clearAll();
    this.world.objMask.fill(0);
    this.particles.clear();
    this.tools.selected = null;
    this.toast('World cleared');
  }

  // ------------------------------------------------------------------ controls

  togglePause() {
    this.running = !this.running;
    this.audio?.play(this.running ? 'play' : 'pause');
    this.ui.toolbar?.sync();
  }

  setRunning(v) {
    this.running = v;
    this.ui.toolbar?.sync();
  }

  stepOnce() {
    this.running = false;
    this.sim.step();
    this.audio?.play('tool');
    this.ui.toolbar?.sync();
  }

  setSpeed(s) {
    if (s !== this.speed) this.audio?.play('tool');
    this.speed = s;
    this.ui.toolbar?.sync();
  }

  toggleHeatView() {
    this.renderer.heatView = !this.renderer.heatView;
    this.audio?.play(this.renderer.heatView ? 'redo' : 'undo');
    this.ui.toolbar?.sync();
  }

  togglePowerView() {
    this.renderer.powerView = !this.renderer.powerView;
    this.audio?.play(this.renderer.powerView ? 'powerOn' : 'powerOff', 0.5);
    if (this.renderer.powerView) this.toast('⚡ Power view: yellow = live, red = not connected to power, green/red dots = switches & sensors');
    this.ui.toolbar?.sync();
  }

  toast(msg, type = 'info') {
    this.ui?.toast(msg, type);
  }

  handleKey(e) {
    const k = e.key.toLowerCase();
    if (this.ui.menu?.isOpen) {
      if (k === 'escape' || k === 'enter') this.ui.menu.action('play');
      return;
    }
    if (this.ui.modalOpen() && e.key !== 'Escape') return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'z') { e.preventDefault(); if (e.shiftKey) this.history.redo(); else this.history.undo(); return; }
    if (ctrl && k === 'y') { e.preventDefault(); this.history.redo(); return; }
    if (ctrl && k === 's') { e.preventDefault(); this.ui.openSaveMenu('save'); return; }
    if (ctrl && k === 'o') { e.preventDefault(); this.ui.openSaveMenu('load'); return; }
    if (ctrl && k === 'c') { e.preventDefault(); this.tools.copy(); return; }
    if (ctrl && k === 'v') { e.preventDefault(); this.tools.paste(); return; }
    if (ctrl) return;
    if (k === 'escape' && this.ui.modalOpen()) { this.ui.closeModal(); return; }
    const t = this.tools;
    if (k === 'escape' && !t.held && !t.heldDoll && !t.selected && !t.lineStart && !t.ropeStart && t.tool !== 'spawn') { this.ui.menu?.open(); return; }
    if (this.tools.handleKey(e)) { e.preventDefault(); return; }
    switch (k) {
      case ' ': case 'p': e.preventDefault(); this.togglePause(); break;
      case 'n': case '.': this.stepOnce(); break;
      case 'h': this.toggleHeatView(); break;
      case 'v': this.togglePowerView(); break;
      case '+': case '=': this.cycleSpeed(1); break;
      case '-': case '_': this.cycleSpeed(-1); break;
      case 'tab': e.preventDefault(); this.ui.toggleSidebar(); break;
      case 'b': this.ui.openEncyclopedia(); break;
      case '?': case 'f1': e.preventDefault(); this.ui.openSettings('controls'); break;
      case 'home': this.camera.fitWorld(this.world.w, this.world.h); break;
      default: break;
    }
  }

  cycleSpeed(dir) {
    const idx = SPEEDS.indexOf(this.speed);
    this.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, idx + dir))]);
  }

  // ------------------------------------------------------------------ loop

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, this.lastTime ? (now - this.lastTime) / 1000 : 1 / 60);
    this.lastTime = now;
    this.frame++;
    this.perf.frame(now);
    try {
      if (this.running && this.world) {
        this.acc += dt * TICK_RATE * this.speed;
        const maxTicks = Math.max(1, Math.ceil(this.speed * 1.5) + 1);
        let n = Math.min(Math.floor(this.acc), maxTicks);
        this.perf.begin('sim');
        const t0 = performance.now();
        while (n-- > 0) {
          this.sim.step();
          this.acc -= 1;
          if (performance.now() - t0 > 28) { this.acc = 0; break; } // protect the frame rate
        }
        this.perf.end('sim');
        if (this.acc > 4) this.acc = 0;
      }
      this.tools.update(dt);
      this.camera.update(dt);
      this.particles.update(dt);
      this.perf.begin('render');
      this.renderer.render(dt);
      this.perf.end('render');
      this.ui.update(dt);
      this.soundscape.update(dt);
      if (this.settings.get('autosave')) {
        this.autosaveTimer += dt;
        if (this.autosaveTimer > 90) {
          this.autosaveTimer = 0;
          this.saves.autosave();
        }
      }
    } catch (e) {
      console.error(e);
      if (!this._lastErr || now - this._lastErr > 4000) {
        this._lastErr = now;
        this.toast(`Something went wrong: ${e.message}. The game will keep running.`, 'error');
      }
    }
  }
}
