// Tool buttons, brush controls and simulation controls.
import { TOOLS } from '../core/ToolController.js';
import { SPEEDS } from '../core/Constants.js';
import { escapeHtml } from '../utils/MathUtils.js';

const DIR_LABELS_4 = ['→', '↓', '←', '↑'];
const DIR_LABELS_2 = ['→', '←'];

export class Toolbar {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
  }

  build() {
    const game = this.game;
    const toolRoot = document.getElementById('tool-buttons');
    toolRoot.innerHTML = TOOLS.map((t) => `
      <button class="tool-btn" data-tool="${t.id}" title="${escapeHtml(t.name)} (${t.key}) — ${escapeHtml(t.desc)}">
        <span class="tool-ico">${t.icon}</span><span class="tool-name">${t.name}</span><kbd>${t.key}</kbd>
      </button>`).join('');
    toolRoot.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
      game.tools.setTool(b.dataset.tool);
      game.audio?.play('click');
    }));

    const size = document.getElementById('brush-size');
    size.addEventListener('input', () => game.tools.setBrushSize(Number(size.value)));
    document.getElementById('brush-shape').addEventListener('click', () => {
      game.tools.brushShape = game.tools.brushShape === 'circle' ? 'square' : 'circle';
      game.tools.changed();
    });
    document.getElementById('brush-replace').addEventListener('click', () => {
      game.tools.replace = !game.tools.replace;
      game.tools.changed();
    });
    document.getElementById('brush-dir').addEventListener('click', () => {
      const n = game.registry.directional[game.tools.material] || 4;
      game.tools.direction = (game.tools.direction + 1) % n;
      game.tools.changed();
    });

    const speed = document.getElementById('speed-select');
    speed.innerHTML = SPEEDS.map((s) => `<button data-speed="${s}">${s}×</button>`).join('');
    speed.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => game.setSpeed(Number(b.dataset.speed))));

    game.tools.onChange(() => this.sync());
    this.sync();
  }

  sync() {
    const game = this.game, tools = game.tools, reg = game.registry;
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tools.tool));
    const size = document.getElementById('brush-size');
    if (size && Number(size.value) !== tools.brushSize) size.value = tools.brushSize;
    const sizeLabel = document.getElementById('brush-size-label');
    if (sizeLabel) sizeLabel.textContent = tools.brushSize * 2 + 1;
    const shape = document.getElementById('brush-shape');
    if (shape) { shape.textContent = tools.brushShape === 'circle' ? '●' : '■'; shape.title = `Brush shape: ${tools.brushShape}`; }
    const rep = document.getElementById('brush-replace');
    if (rep) { rep.classList.toggle('active', tools.replace); rep.title = tools.replace ? 'Replace mode: paint over existing cells' : 'Fill mode: only paint into empty space'; }
    const dirBtn = document.getElementById('brush-dir');
    const dirs = reg.directional[tools.material];
    if (dirBtn) {
      dirBtn.hidden = !(dirs && tools.tool === 'brush');
      dirBtn.textContent = `Dir ${dirs === 2 ? DIR_LABELS_2[tools.direction % 2] : DIR_LABELS_4[tools.direction % 4]}`;
    }
    const cur = document.getElementById('current-material');
    if (cur) {
      if (tools.tool === 'spawn') cur.textContent = `Placing: ${tools.spawnType}`;
      else if (tools.material === reg.SPOUT) cur.textContent = `Spout → ${reg.name(tools.spoutMaterial)}`;
      else cur.textContent = reg.name(tools.material);
    }
    const play = document.getElementById('btn-play');
    if (play) {
      play.innerHTML = game.running ? '❚❚' : '▶';
      play.title = game.running ? 'Pause (Space)' : 'Play (Space)';
      play.classList.toggle('paused', !game.running);
    }
    document.body.classList.toggle('sim-paused', !game.running);
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === game.speed));
    const heat = document.querySelector('[data-action=heatview]');
    if (heat) heat.classList.toggle('active', game.renderer.heatView);
    const pv = document.querySelector('[data-action=powerview]');
    if (pv) pv.classList.toggle('active', game.renderer.powerView);
    const undo = document.querySelector('[data-action=undo]');
    const redo = document.querySelector('[data-action=redo]');
    if (undo) undo.disabled = !game.history.canUndo;
    if (redo) redo.disabled = !game.history.canRedo;
  }
}
