// UI shell: top bar actions, modals, toasts, hint bar, status bar and sub-panels.
import { escapeHtml, formatTemp, shortNumber } from '../utils/MathUtils.js';
import { MainMenu, dismissSplash } from './MainMenu.js';
import { STATE_NAMES } from '../materials/MaterialProperties.js';
import { REACTION_DEFS } from '../materials/Reactions.js';
import { MaterialPanel } from './MaterialPanel.js';
import { Inspector } from './Inspector.js';
import { Toolbar } from './Toolbar.js';
import { Encyclopedia } from './Encyclopedia.js';
import { SaveMenu } from './SaveMenu.js';
import { Tutorial } from './Tutorial.js';
import { openSettingsModal } from './Settings.js';

export class Interface {
  constructor(game) {
    this.game = game;
    this.statusTimer = 0;
    this.modalState = null;
  }

  $(sel) { return document.querySelector(sel); }

  build() {
    const game = this.game;
    this.palette = new MaterialPanel(game, this.$('#palette'), this.$('#mat-search'));
    this.inspector = new Inspector(game, this.$('#inspector-body'));
    this.toolbar = new Toolbar(game, this);
    this.encyclopedia = new Encyclopedia(game, this);
    this.saveMenu = new SaveMenu(game, this);
    this.tutorial = new Tutorial(game, this);

    document.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        game.audio?.play('click');
        this.action(btn.dataset.action, btn);
      });
    });

    this.$('#modal-root .modal-backdrop').addEventListener('click', () => this.closeModal());
    this.$('#modal-close').addEventListener('click', () => this.closeModal());

    game.discovery.onDiscover((type, id) => this.onDiscovery(type, id));
    game.history.onChange = () => this.toolbar.sync();
    this.palette.build();
    this.toolbar.build();
  }

  onReady() {
    this.toolbar.sync();
    dismissSplash();
    this.menu = new MainMenu(this.game, this);
    const panel = this.game.hashPanel;
    if (panel) {
      // index.html#panel=book (or worlds / settings) opens a dialog on load.
      const open = { book: () => this.openEncyclopedia(), worlds: () => this.openSaveMenu('presets'), settings: () => this.openSettings() }[panel];
      if (open) { setTimeout(open, 300); return; }
    }
    // Title screen (after the Lapin Studios splash). #skipmenu in the URL goes straight to the game.
    if (!/skipmenu/.test(location.hash || '')) this.menu.open();
  }

  action(name) {
    const game = this.game;
    switch (name) {
      case 'play': game.togglePause(); break;
      case 'step': game.stepOnce(); break;
      case 'undo': game.history.undo(); break;
      case 'redo': game.history.redo(); break;
      case 'heatview': game.toggleHeatView(); break;
      case 'menu': this.menu?.open(); break;
      case 'powerview': game.togglePowerView(); break;
      case 'presets': this.openSaveMenu('presets'); break;
      case 'save': this.openSaveMenu('save'); break;
      case 'load': this.openSaveMenu('load'); break;
      case 'book': this.openEncyclopedia(); break;
      case 'tutorial': this.tutorial.start(); break;
      case 'settings': this.openSettings(); break;
      case 'clear': this.confirmClear(); break;
      case 'fit': game.camera.fitWorld(game.world.w, game.world.h); break;
      case 'toggle-sidebar': this.toggleSidebar(); break;
      case 'toggle-inspector': this.toggleInspector(); break;
      default: console.warn('Unknown action', name);
    }
  }

  setWorldName(name) {
    const el = this.$('#world-name');
    if (el) el.textContent = name;
  }

  toggleSidebar() {
    document.body.classList.toggle('sidebar-collapsed');
    setTimeout(() => this.game.renderer.resize(), 220);
  }

  toggleInspector() {
    document.body.classList.toggle('inspector-collapsed');
    setTimeout(() => this.game.renderer.resize(), 220);
  }

  // ------------------------------------------------------------------ modals

  openModal({ title, body, wide = false, onClose = null, className = '' }) {
    const root = this.$('#modal-root');
    this.$('#modal-title').textContent = title;
    const content = this.$('#modal-body');
    content.innerHTML = '';
    if (typeof body === 'string') content.innerHTML = body;
    else content.appendChild(body);
    const modal = root.querySelector('.modal');
    modal.className = `modal ${wide ? 'modal-wide' : ''} ${className}`;
    if (root.hidden) this.game.audio?.play('open');
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('open'));
    this.modalState = { onClose };
    return content;
  }

  closeModal() {
    const root = this.$('#modal-root');
    if (root.hidden) return;
    this.game.audio?.play('close');
    root.classList.remove('open');
    const st = this.modalState;
    this.modalState = null;
    setTimeout(() => { if (!this.modalState) root.hidden = true; }, 160);
    st?.onClose?.();
  }

  modalOpen() {
    return !!this.modalState;
  }

  confirm({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
    const body = document.createElement('div');
    body.className = 'confirm';
    body.innerHTML = `<p>${message}</p><div class="row-end"><button class="btn" data-k="cancel">Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-k="ok">${escapeHtml(confirmLabel)}</button></div>`;
    body.querySelector('[data-k=cancel]').onclick = () => this.closeModal();
    body.querySelector('[data-k=ok]').onclick = () => { this.closeModal(); onConfirm(); };
    this.openModal({ title, body });
  }

  confirmClear() {
    this.confirm({
      title: 'Clear the world?',
      message: 'This removes every cell and object. You can undo it with Ctrl+Z.',
      confirmLabel: 'Clear world',
      danger: true,
      onConfirm: () => this.game.clearWorld(),
    });
  }

  openEncyclopedia(tab) { this.encyclopedia.open(tab); }
  openSaveMenu(tab) { this.saveMenu.open(tab); }
  openSettings(tab) { openSettingsModal(this.game, this, tab); }

  // ------------------------------------------------------------------ toasts / hints

  toast(msg, type = 'info') {
    const box = this.$('#toasts');
    if (!box) return;
    // Success/discovery toasts usually come with their own sound (cast, craft, coin…).
    if (type === 'error') this.game.audio?.play('error');
    else if (type === 'warn' || type === 'info') this.game.audio?.play('blip', type === 'warn' ? 0.9 : 0.5);
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 5) box.firstChild.remove();
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, type === 'error' ? 6000 : 3200);
  }

  onDiscovery(type, id) {
    const reg = this.game.registry;
    if (type === 'reaction') {
      const def = REACTION_DEFS.find((r) => r.id === id);
      if (def) { this.toast(`✦ Discovered: ${def.name}`, 'discovery'); this.game.audio?.play('discover'); }
    } else if (type === 'material') {
      const d = reg.get(id);
      if (d && (d.cat === 'alloy' || d.key.startsWith('molten_'))) this.toast(`✦ New material: ${d.name}`, 'discovery');
      else if (d && d.cat === 'food' && d.tags?.includes('cooked')) this.toast(`🍳 Cooked: ${d.name}`, 'discovery');
    }
    this.encyclopedia.markDirty();
  }

  updateHint() {
    const el = this.$('#hint-bar');
    if (!el) return;
    const tools = this.game.tools;
    let text = '';
    if (tools.heldDoll) text = `<b>Ragdoll</b> · ${tools.heldDoll.status()} · fling him by letting go mid-swing · right-click drops`;
    else if (tools.held) text = `<b>${escapeHtml(tools.held.name)}</b> · ${tools.held.hint()}`;
    else if (tools.hover.doll) text = `<b>Ragdoll Human</b> · ${tools.hover.doll.doll.status()} · ❤ ${Math.round(tools.hover.doll.doll.health)}% · ${tools.tool === 'hand' ? 'drag any body part' : 'switch to ✋ Hand (5) to drag him'} · Del removes`;
    else if (tools.hover.obj) text = `<b>${escapeHtml(tools.hover.obj.name)}</b> · ${tools.hover.obj.hint()}${tools.tool !== 'hand' ? ' · click its body to grab' : ''}`;
    else if (tools.tool === 'spawn') text = tools.spawnType === 'ragdoll' ? 'Click to drop a ragdoll human · then use ✋ Hand (5) to drag him around' : 'Click to place the object · Esc to stop placing';
    else if (tools.tool === 'line') text = tools.lineStart ? 'Release to draw the line · Esc cancels' : 'Drag to draw a straight line · right-drag erases a line · [ ] thickness';
    else if (tools.tool === 'rope') text = tools.ropeStart ? 'Release on an object, ragdoll, pin, wall or empty space to tie the rope' : 'Drag between two things to tie a rope · right-click a rope or pin to remove it';
    else if (tools.tool === 'pin') text = 'Click an object or ragdoll part to pin it in place, or empty space for a rope anchor · right-click removes';
    else if (tools.tool === 'carve') text = 'Click a solid to cut it loose as an item (hold Shift to include touching solids of any type)';
    else if (tools.tool === 'inspect') text = 'Click a cell or object to inspect it · click switches to toggle them';
    else if (tools.tool === 'heat' || tools.tool === 'cool') text = 'Hold left mouse to change temperature · [ ] brush size';
    else if (tools.tool === 'mix') text = 'Hold left mouse to stir — mixes powders, liquids and the contents of pots &amp; crucibles · [ ] brush size';
    else if (tools.tool === 'hand') text = 'Click and drag objects · Q/E or wheel tilts · release to drop';
    else text = 'Left: paint · Right: erase · Wheel: zoom · Shift+wheel or [ ]: brush size · Space: pause · H: heat view';
    if (el.dataset.text !== text) {
      el.dataset.text = text;
      el.innerHTML = text;
    }
  }

  updateStatus() {
    const game = this.game;
    const world = game.world;
    if (!world) return;
    const h = game.tools.hover;
    const unit = game.settings.get('tempUnit');
    let cursor = '—';
    if (h.inside) {
      const i = h.y * world.w + h.x;
      const om = world.objMask[i];
      if (om) {
        const o = game.objects.byId.get(Math.abs(om));
        const li = world.objLocal[i];
        cursor = o ? `${escapeHtml(o.name)} · ${o.mat[li] ? game.registry.name(o.mat[li]) : 'air'} · ${formatTemp(o.temp[li], unit)}` : '—';
      } else {
        const m = world.cells[i];
        cursor = `${game.registry.name(m)}${m ? ` (${STATE_NAMES[game.registry.state[m]]})` : ''} · ${formatTemp(world.temp[i], unit)}`;
      }
      cursor = `(${h.x}, ${h.y}) ${cursor}`;
    }
    const perf = game.perf;
    this.$('#status-cursor').innerHTML = cursor;
    this.$('#status-perf').textContent = `${Math.round(perf.fps)} fps · sim ${perf.get('sim').toFixed(1)} ms · ${world.activeChunkCount()} active chunks · ${game.objects.list.length} objects`;
  }

  update(dt) {
    this.statusTimer += dt;
    if (this.statusTimer > 0.2) {
      this.statusTimer = 0;
      this.updateStatus();
      this.updateHint();
      this.inspector.refresh(false);
      this.tutorial.check();
      this.cellTimer = (this.cellTimer || 0) + 1;
      if (this.cellTimer >= 5 || this.cellCount === undefined) {
        this.cellTimer = 0;
        this.cellCount = shortNumber(this.game.world.countNonEmpty());
      }
      this.$('#status-cells').textContent = `${this.cellCount} cells`;
    }
  }
}
