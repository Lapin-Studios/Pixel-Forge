// Persistent settings store + the Settings / Controls modal.
const KEY = 'pixelforge.settings.v1';

export const SETTING_DEFAULTS = {
  volume: 0.6,
  ambience: 0.6,
  uiSounds: true,
  muted: false,
  glow: true,
  particles: true,
  heatHaze: true,
  reducedMotion: false,
  showLabels: true,
  tempUnit: 'C',
  autosave: true,
  brushScatter: true,
  eraseBedrock: false,
  thermostatDefault: 600,
  heatLimit: 500,
  tutorialDone: false,
};

export class Settings {
  constructor() {
    this.values = { ...SETTING_DEFAULTS };
    this.listeners = [];
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        for (const k of Object.keys(SETTING_DEFAULTS)) if (k in d && typeof d[k] === typeof SETTING_DEFAULTS[k]) this.values[k] = d[k];
      }
    } catch (e) { /* use defaults */ }
  }

  get(k) { return this.values[k]; }

  set(k, v) {
    this.values[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch (e) { /* ignore */ }
    for (const fn of this.listeners) fn(k, v);
  }

  onChange(fn) { this.listeners.push(fn); }

  reset() {
    const keepTutorial = this.values.tutorialDone;
    this.values = { ...SETTING_DEFAULTS, tutorialDone: keepTutorial };
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch (e) { /* ignore */ }
    for (const fn of this.listeners) fn('*');
  }
}

export const CONTROLS = [
  ['Left mouse', 'Use tool (paint / grab / inspect)'],
  ['Right mouse', 'Erase · drop held object'],
  ['Middle drag · Alt+drag', 'Pan camera'],
  ['W A S D · Arrow keys', 'Pan camera'],
  ['Mouse wheel', 'Zoom (tilts a held object)'],
  ['Shift+wheel · [ ]', 'Brush size'],
  ['1 – 8', 'Brush, Eraser, Heat, Cool, Hand, Inspect, Carve, Mix'],
  ['Q / E (hold)', 'Tilt held object — pour!'],
  ['R', 'Level the held / hovered object'],
  ['X', 'Extract casting from the hovered mould'],
  ['F', 'Place hovered item into the world as cells'],
  ['T · click', 'Toggle the switch under the cursor (any tool)'],
  ['Shift + drag', 'Paint a straight line (great for wires)'],
  ['Delete', 'Delete held / hovered object or ragdoll'],
  ['Space · P', 'Pause / resume'],
  ['N · .', 'Step one tick'],
  ['+ / -', 'Simulation speed'],
  ['H', 'Thermal view'],
  ['9 · 0 · K', 'Line, Rope, Pin tools'],
  ['Ctrl+C / Ctrl+V', 'Copy / paste the hovered object or ragdoll'],
  ['V', 'Power view (live / dead wiring)'],
  ['B', 'Recipe book'],
  ['Tab', 'Toggle material sidebar'],
  ['Home', 'Fit world to screen'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+S / Ctrl+O', 'Save / load'],
  ['Esc', 'Close dialog · drop · stop placing'],
];

export function openSettingsModal(game, ui, tab = 'general') {
  const s = game.settings;
  const body = document.createElement('div');
  body.className = 'settings';
  const tabs = [['general', 'General'], ['graphics', 'Graphics'], ['audio', 'Audio'], ['controls', 'Controls'], ['data', 'Data']];
  body.innerHTML = `
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
    <div class="tab-body"></div>`;
  const tb = body.querySelector('.tab-body');

  const toggle = (key, label, hint = '') => `
    <label class="setting"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span>
      <input type="checkbox" data-key="${key}" ${s.get(key) ? 'checked' : ''}><i class="switch"></i></label>`;

  const render = (t) => {
    body.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    if (t === 'general') {
      tb.innerHTML = `
        <label class="setting"><span><b>Temperature unit</b></span>
          <select data-key="tempUnit"><option value="C">Celsius</option><option value="F">Fahrenheit</option><option value="K">Kelvin</option></select></label>
        ${toggle('autosave', 'Autosave', 'Saves to the “Autosave” slot every 90 seconds')}
        ${toggle('showLabels', 'Object labels', 'Temperatures above furnaces, moulds and thermometers')}
        ${toggle('brushScatter', 'Scatter brush', 'Powders and liquids spray loosely with large brushes')}
        ${toggle('eraseBedrock', 'Eraser removes bedrock')}
        <label class="setting"><span><b>Heat Limiter default</b><small>Limit (°C) given to newly painted Heat Limiter parts</small></span>
          <input type="number" min="0" max="10000" step="50" data-key="heatLimit" value="${s.get('heatLimit')}"></label>
        <label class="setting"><span><b>Thermostat default setpoint</b><small>Applied to newly painted thermostats</small></span>
          <input type="number" min="-100" max="3000" step="10" data-key="thermostatDefault" value="${s.get('thermostatDefault')}"></label>`;
      tb.querySelector('[data-key=tempUnit]').value = s.get('tempUnit');
    } else if (t === 'graphics') {
      tb.innerHTML = `
        ${toggle('glow', 'Bloom glow', 'Glowing molten metal, fire and lamps')}
        ${toggle('particles', 'Particles', 'Sparks, splashes, steam and smoke puffs')}
        ${toggle('heatHaze', 'Heat haze', 'Tint hot air around furnaces')}
        ${toggle('reducedMotion', 'Reduced effects', 'Fewer particles')}`;
    } else if (t === 'audio') {
      tb.innerHTML = `
        ${toggle('muted', 'Mute all sound')}
        <label class="setting"><span><b>Master volume</b></span>
          <input type="range" min="0" max="1" step="0.05" data-key="volume" value="${s.get('volume')}"></label>
        <label class="setting"><span><b>Ambience</b><small>Fire crackle, furnace roar, machine hum, water and boiling — follows what's on screen</small></span>
          <input type="range" min="0" max="1" step="0.05" data-key="ambience" value="${s.get('ambience')}"></label>
        ${toggle('uiSounds', 'Interface sounds', 'Clicks, dialogs, notifications')}
        <p class="muted">All sounds are synthesised in real time — no audio files are loaded. World sounds are panned left/right by where they happen on screen.</p>`;
    } else if (t === 'controls') {
      tb.innerHTML = `<table class="controls-table">${CONTROLS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table>`;
    } else if (t === 'data') {
      tb.innerHTML = `
        <div class="setting"><span><b>Reset discoveries</b><small>Hide recipes in the Recipe Book again</small></span><button class="btn" data-do="disc">Reset</button></div>
        <div class="setting"><span><b>Replay tutorial</b></span><button class="btn" data-do="tut">Start</button></div>
        <div class="setting"><span><b>Restore default settings</b></span><button class="btn" data-do="defaults">Restore</button></div>
        <div class="setting"><span><b>Delete all local saves</b><small>Cannot be undone</small></span><button class="btn btn-danger" data-do="wipe">Delete</button></div>`;
      tb.querySelector('[data-do=disc]').onclick = () => { game.discovery.reset(); ui.toast('Discoveries reset'); };
      tb.querySelector('[data-do=tut]').onclick = () => { ui.closeModal(); ui.tutorial.start(); };
      tb.querySelector('[data-do=defaults]').onclick = () => { s.reset(); render('data'); ui.toast('Settings restored'); };
      tb.querySelector('[data-do=wipe]').onclick = () => {
        ui.confirm({
          title: 'Delete all saves?', message: 'Every locally stored world will be removed permanently.', confirmLabel: 'Delete all', danger: true,
          onConfirm: () => { for (const sv of game.saves.listSaves()) game.saves.delete(sv.id); ui.toast('All saves deleted'); },
        });
      };
    }
    tb.querySelectorAll('[data-key]').forEach((el) => {
      el.addEventListener('change', () => {
        const key = el.dataset.key;
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'range' || el.type === 'number') v = Number(el.value);
        else v = el.value;
        if (el.type === 'number' && !Number.isFinite(v)) return;
        s.set(key, v);
      });
      if (el.type === 'range') el.addEventListener('input', () => s.set(el.dataset.key, Number(el.value)));
    });
  };
  body.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => render(b.dataset.tab)));
  render(tab);
  ui.openModal({ title: 'Settings', body });
}
