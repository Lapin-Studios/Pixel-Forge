// Save / load / import / export / presets dialog.
import { PRESETS } from '../systems/WorldPresets.js';
import { escapeHtml } from '../utils/MathUtils.js';

const TABS = [['presets', 'World Presets'], ['save', 'Save'], ['load', 'Load'], ['files', 'Import / Export']];

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
}

function fmtSize(n) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export class SaveMenu {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.tab = 'presets';
  }

  open(tab) {
    if (tab) this.tab = tab;
    const body = document.createElement('div');
    body.className = 'savemenu';
    body.innerHTML = `<nav class="tabs">${TABS.map(([k, l]) => `<button class="tab" data-tab="${k}">${l}</button>`).join('')}</nav><div class="tab-body"></div>`;
    this.body = body;
    body.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.render(); }));
    this.ui.openModal({ title: 'Worlds', body, wide: true });
    this.render();
  }

  render() {
    const body = this.body;
    body.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab));
    const tb = body.querySelector('.tab-body');
    tb.innerHTML = '';
    this[`render_${this.tab}`](tb);
  }

  render_presets(tb) {
    const grid = document.createElement('div');
    grid.className = 'preset-grid';
    for (const p of PRESETS) {
      const card = document.createElement('button');
      card.className = 'preset-card';
      card.innerHTML = `<div class="preset-icon">${p.icon}</div><div class="preset-name">${escapeHtml(p.name)}</div><div class="preset-desc">${escapeHtml(p.desc)}</div>`;
      card.onclick = () => {
        this.ui.confirm({
          title: `Load “${p.name}”?`,
          message: 'Your current world will be replaced (you can undo with Ctrl+Z, or save it first).',
          confirmLabel: 'Load world',
          onConfirm: () => this.game.loadPreset(p.id),
        });
      };
      grid.appendChild(card);
    }
    tb.appendChild(grid);
  }

  render_save(tb) {
    tb.innerHTML = `
      <div class="save-row">
        <input type="text" class="save-name" maxlength="48" placeholder="World name" value="${escapeHtml(this.game.worldName || 'My Workshop')}">
        <button class="btn btn-primary save-go">Save new</button>
      </div>
      <p class="muted">Saved in this browser's local storage: every cell, temperature, object (position, rotation, contents) and machine state.</p>
      <div class="save-list"></div>`;
    const input = tb.querySelector('.save-name');
    tb.querySelector('.save-go').onclick = () => this.doSave(input.value);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.doSave(input.value); });
    this.renderList(tb.querySelector('.save-list'), 'overwrite');
    setTimeout(() => input.select(), 50);
  }

  doSave(name, id = null) {
    try {
      this.game.saves.save(name, id);
      this.game.audio?.play('save');
      this.game.worldName = name;
      this.ui.setWorldName(name);
      this.ui.toast(`Saved “${name}”`, 'success');
      this.render();
    } catch (e) {
      this.ui.toast(e.message, 'error');
    }
  }

  render_load(tb) {
    tb.innerHTML = '<div class="save-list"></div>';
    this.renderList(tb.querySelector('.save-list'), 'load');
  }

  renderList(root, mode) {
    const saves = this.game.saves.listSaves();
    if (!saves.length) {
      root.innerHTML = '<p class="muted empty">No saved worlds yet.</p>';
      return;
    }
    for (const s of saves) {
      const row = document.createElement('div');
      row.className = 'save-item';
      row.innerHTML = `
        <div class="save-meta"><b>${escapeHtml(s.name)}</b><small>${fmtDate(s.savedAt)} · ${s.width}×${s.height} · ${fmtSize(s.size || 0)}</small></div>
        <div class="save-actions">
          ${mode === 'overwrite' ? '<button class="btn btn-sm" data-a="over">Overwrite</button>' : '<button class="btn btn-sm btn-primary" data-a="load">Load</button>'}
          <button class="btn btn-sm" data-a="export">Export</button>
          <button class="btn btn-sm btn-danger" data-a="del">Delete</button>
        </div>`;
      row.querySelector('[data-a=del]').onclick = () => {
        this.ui.confirm({
          title: 'Delete save?', message: `Delete “${escapeHtml(s.name)}” permanently?`, confirmLabel: 'Delete', danger: true,
          onConfirm: () => { this.game.saves.delete(s.id); this.ui.toast('Save deleted'); this.open(mode === 'load' ? 'load' : 'save'); },
        });
      };
      row.querySelector('[data-a=export]').onclick = () => {
        try {
          const raw = localStorage.getItem(`pixelforge.save.${s.id}`);
          if (!raw) throw new Error('Save data missing');
          const blob = new Blob([raw], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${s.name.replace(/[^a-z0-9-_]+/gi, '_')}.pixelforge.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (e) { this.ui.toast(e.message, 'error'); }
      };
      const over = row.querySelector('[data-a=over]');
      if (over) over.onclick = () => this.doSave(s.name, s.id);
      const load = row.querySelector('[data-a=load]');
      if (load) load.onclick = () => {
        try {
          this.game.history.push('Load save');
          const notes = this.game.saves.load(s.id);
          this.game.audio?.play('load');
          this.ui.closeModal();
          this.ui.toast(`Loaded “${s.name}”${notes.length ? ` (${notes.join(', ')})` : ''}`, notes.length ? 'warn' : 'success');
        } catch (e) {
          this.ui.toast(`Could not load: ${e.message}`, 'error');
        }
      };
      root.appendChild(row);
    }
  }

  render_files(tb) {
    tb.innerHTML = `
      <div class="file-actions">
        <div class="file-card">
          <h3>Export current world</h3>
          <p class="muted">Download a .json file you can share or back up.</p>
          <button class="btn btn-primary" data-a="export">Export JSON</button>
        </div>
        <div class="file-card">
          <h3>Import world</h3>
          <p class="muted">Load a .pixelforge.json file. Invalid files are rejected safely.</p>
          <label class="btn file-btn">Choose file…<input type="file" accept=".json,application/json" hidden></label>
        </div>
      </div>`;
    tb.querySelector('[data-a=export]').onclick = () => {
      try { this.game.saves.exportFile(this.game.worldName || 'world'); this.game.audio?.play('save'); this.ui.toast('World exported', 'success'); } catch (e) { this.ui.toast(e.message, 'error'); }
    };
    tb.querySelector('input[type=file]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        this.game.history.push('Import world');
        const notes = await this.game.saves.importFile(file);
        this.game.audio?.play('load');
        this.ui.closeModal();
        this.ui.toast(`Imported ${file.name}${notes.length ? ` (${notes.join(', ')})` : ''}`, 'success');
      } catch (err) {
        this.game.history.undoStack.pop();
        this.ui.toast(`Import failed: ${err.message}`, 'error');
      }
      e.target.value = '';
    });
  }
}
