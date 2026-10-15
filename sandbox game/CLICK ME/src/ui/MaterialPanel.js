// Tabbed, searchable material + object palette with procedurally drawn icons.
import { CATEGORIES, TABS, STATE, STATE_NAMES, RENDER, BB_R, BB_G, BB_B, BB_I, bbIndex } from '../materials/MaterialProperties.js';
import { objectPaletteGroups, createObject, OBJECT_TYPES } from '../objects/ObjectFactory.js';
import { MASK } from '../objects/WorldObject.js';
import { escapeHtml, formatTemp, hash2 } from '../utils/MathUtils.js';

const TAB_KEY = 'pixelforge.palette.tab';

export function drawMaterialIcon(reg, m, size = 12) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.className = 'mat-icon';
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = new Uint32Array(img.data.buffer);
  const t = Number.isNaN(reg.defTemp[m]) ? 22 : reg.defTemp[m];
  const glow = reg.glow[m] && t > 430;
  const k = bbIndex(t), f = glow ? BB_I[k] : 0;
  const led = reg.render[m] === RENDER.LED;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let col = reg.useTex[m] ? reg.tex[m][((y + 3) << 5) | (x + 5)] : reg.palette[m][(hash2(x, y, m) * 16) | 0];
      if (f > 0) {
        let r = col & 255, gg = (col >>> 8) & 255, b = (col >>> 16) & 255;
        r += (BB_R[k] - r) * f; gg += (BB_G[k] - gg) * f; b += (BB_B[k] - b) * f;
        col = ((255 << 24) | (b << 16) | (gg << 8) | r) >>> 0;
      }
      if (led && (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size / 2.6) ** 2) col = reg.accentColor[m];
      if (reg.state[m] === STATE.FIRE) col = (((200 + ((y * 7) % 55)) << 24) | ((30 + y * 6) << 16) | ((80 + (size - y) * 12) << 8) | 255) >>> 0;
      d[y * size + x] = col;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function drawObjectIcon(game, type, size = 24) {
  const c = document.createElement('canvas');
  c.className = 'mat-icon obj-icon';
  const def = OBJECT_TYPES[type];
  if (def?.drawIcon) {
    def.drawIcon(c);
    c.style.width = `${size}px`;
    c.style.height = `${size}px`;
    return c;
  }
  try {
    const o = createObject(game, type);
    const reg = game.registry;
    const s = Math.max(o.w, o.h);
    c.width = s; c.height = s;
    const g = c.getContext('2d');
    const img = g.createImageData(s, s);
    const d = new Uint32Array(img.data.buffer);
    const ox = Math.floor((s - o.w) / 2), oy = Math.floor((s - o.h) / 2);
    for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
      const li = y * o.w + x;
      const k = o.mask[li];
      let col = 0;
      if (k === MASK.WALL) {
        const m = o.mat[li];
        col = reg.useTex[m] ? reg.tex[m][((y & 31) << 5) | (x & 31)] : reg.palette[m][(x + y) & 15];
        col = (col | 0xff000000) >>> 0;
      } else if (k === MASK.CAVITY || k === MASK.PART || k === MASK.HOPPER) col = 0xff1d1716;
      else if (k === MASK.CHAMBER) col = 0x50204080;
      d[(y + oy) * s + x + ox] = col;
    }
    g.putImageData(img, 0, 0);
  } catch (e) {
    c.width = 1; c.height = 1;
  }
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  return c;
}

export class MaterialPanel {
  constructor(game, root, search) {
    this.game = game;
    this.root = root;
    this.search = search;
    this.tabsRoot = document.getElementById('palette-tabs');
    this.titleEl = document.getElementById('palette-title');
    this.buttons = new Map();
    this.objButtons = new Map();
    this.sections = new Map();
    this.tabButtons = new Map();
    this.query = '';
    let saved = null;
    try { saved = localStorage.getItem(TAB_KEY); } catch (e) { /* ignore */ }
    this.tab = TABS.some((t) => t.key === saved) ? saved : 'solid';
  }

  build() {
    const game = this.game, reg = game.registry;
    const byTab = reg.paletteByTab();
    const catName = (key) => CATEGORIES.find((c) => c.key === key)?.name || key;

    // Tab strip
    this.tabsRoot.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.className = 'pal-tab';
      b.dataset.tab = t.key;
      b.title = `${t.name} — ${t.hint}`;
      b.innerHTML = `<span class="pal-tab-ico">${t.icon}</span><span class="pal-tab-name">${t.name}</span>`;
      b.addEventListener('click', () => { this.setTab(t.key); game.audio?.play('click'); });
      this.tabsRoot.appendChild(b);
      this.tabButtons.set(t.key, b);
    }

    // One section per tab, with sub-groups.
    this.root.innerHTML = '';
    for (const t of TABS) {
      const section = document.createElement('section');
      section.className = 'pal-section';
      section.dataset.tab = t.key;
      const head = document.createElement('div');
      head.className = 'pal-section-head';
      head.textContent = `${t.icon} ${t.name}`;
      section.appendChild(head);
      if (t.key === 'food') {
        const help = document.createElement('div');
        help.className = 'pal-help';
        help.innerHTML = `<b>How to cook:</b> drop ingredients into a <b>Cooking Pot</b> or <b>Frying Pan</b> (Tools → Kitchen) — they stir themselves.
          Set it on the <b>Hot Plate</b> or in the <b>Oven</b>, then pick a quick setting in its inspector.
          <br>• <b>Bread</b>: Flour + Water → Oven 🍞 200°C
          <br>• <b>Pancakes</b>: Flour + Milk → Hot plate 🥞 170°C
          <br>• <b>Cake</b>: Flour + Milk + Sugar → Oven 🎂 180°C
          <br>• <b>Fried egg / steak</b>: Egg or Meat → 🍳 120°C
          <br>• <b>Fries</b>: Potato + Oil → 🍟 190°C
          <br>• <b>Rice</b>: Rice + Water → 🍚 105°C
          <br>• <b>Popcorn</b>: Kernels → 🍿 200°C
          <br>• <b>Ice cream</b>: Milk + Sugar → Fridge 🍦 −18°C
          <br>• <b>Cheese</b>: Milk + Vinegar · <b>Tea</b>: Leaves + hot Water`;
        section.appendChild(help);
      }
      if (t.key === 'electronics') {
        const help = document.createElement('div');
        help.className = 'pal-help';
        help.innerHTML = `<b>Quick circuit:</b> paint a <b>Battery</b>, draw <b>Wire</b> from it to a <b>Lamp</b> (or any output) — touching corners count.
          <br>• Click a <b>Switch</b> with any tool to flip it · <b>Shift+drag</b> for straight wires
          <br>• Parts paint straight over wire · press <b>V</b> to see what's live`;
        const pv = document.createElement('button');
        pv.className = 'text-btn pal-help-btn';
        pv.textContent = '⚡ Power view';
        pv.addEventListener('click', () => game.togglePowerView());
        help.appendChild(pv);
        section.appendChild(help);
      }
      const groups = new Map();
      const groupList = (name) => {
        if (!groups.has(name)) {
          const gh = document.createElement('div');
          gh.className = 'pal-sub';
          gh.textContent = name;
          const list = document.createElement('div');
          list.className = 'pal-list';
          section.appendChild(gh);
          section.appendChild(list);
          groups.set(name, { gh, list });
        }
        return groups.get(name).list;
      };
      if (t.key === 'tools') {
        for (const [group, items] of objectPaletteGroups()) {
          const list = groupList(group);
          for (const it of items) {
            const b = document.createElement('button');
            b.className = 'pal-item pal-obj';
            b.dataset.search = `${it.name} ${group} ${it.desc}`.toLowerCase();
            b.appendChild(drawObjectIcon(game, it.key));
            const label = document.createElement('span');
            label.textContent = it.name;
            b.appendChild(label);
            b.addEventListener('click', () => { game.tools.selectSpawn(it.key); game.audio?.play('click'); });
            this.attachTooltip(b, `<b>${escapeHtml(it.name)}</b><br>${escapeHtml(it.desc)}<br><i>Click, then click in the world to place.</i>`);
            this.objButtons.set(it.key, b);
            list.appendChild(b);
          }
        }
      } else {
        for (const d of byTab.get(t.key) || []) {
          const list = groupList(d.sub || catName(d.cat));
          const b = document.createElement('button');
          b.className = 'pal-item';
          b.dataset.search = `${d.name} ${d.key} ${d.desc} ${(d.tags || []).join(' ')} ${t.name}`.toLowerCase();
          b.appendChild(drawMaterialIcon(reg, d.id));
          const label = document.createElement('span');
          label.textContent = d.name;
          b.appendChild(label);
          b.addEventListener('click', () => { game.tools.selectMaterial(d.id); game.audio?.play('click'); });
          this.attachTooltip(b, this.tooltipFor(d));
          this.buttons.set(d.id, b);
          list.appendChild(b);
        }
      }
      this.root.appendChild(section);
      this.sections.set(t.key, { section, groups });
    }

    this.search.addEventListener('input', () => this.filter(this.search.value));
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = this.root.querySelector('.pal-item:not(.hidden)');
        first?.click();
        this.search.blur();
      } else if (e.key === 'Escape') { this.search.value = ''; this.filter(''); this.search.blur(); }
    });
    game.tools.onChange(() => this.sync());
    this.render();
    this.sync();
    const total = document.getElementById('mat-total');
    if (total) total.textContent = `${reg.defs.filter((d) => !d.hidden).length} materials`;
  }

  setTab(key) {
    this.tab = key;
    try { localStorage.setItem(TAB_KEY, key); } catch (e) { /* ignore */ }
    if (this.query) { this.search.value = ''; this.query = ''; }
    this.render();
    this.root.scrollTop = 0;
  }

  /** Show the active tab, or — while searching — matches from every tab. */
  render() {
    const q = this.query;
    const searching = q.length > 0;
    this.root.classList.toggle('searching', searching);
    for (const [key, b] of this.tabButtons) b.classList.toggle('active', !searching && key === this.tab);
    const tabDef = TABS.find((t) => t.key === this.tab);
    if (this.titleEl) this.titleEl.textContent = searching ? `Search results for “${q}”` : `${tabDef.name} · ${tabDef.hint}`;
    let anyResult = false;
    for (const [key, { section, groups }] of this.sections) {
      if (!searching) {
        section.hidden = key !== this.tab;
        for (const b of section.querySelectorAll('.pal-item')) b.classList.remove('hidden');
        for (const { gh, list } of groups.values()) { gh.hidden = false; list.hidden = false; }
        continue;
      }
      let visible = 0;
      for (const { gh, list } of groups.values()) {
        let gv = 0;
        for (const b of list.children) {
          const show = b.dataset.search.includes(q);
          b.classList.toggle('hidden', !show);
          if (show) gv++;
        }
        gh.hidden = gv === 0;
        list.hidden = gv === 0;
        visible += gv;
      }
      section.hidden = visible === 0;
      if (visible) anyResult = true;
    }
    let empty = this.root.querySelector('.pal-empty');
    if (searching && !anyResult) {
      if (!empty) {
        empty = document.createElement('p');
        empty.className = 'pal-empty muted';
        this.root.appendChild(empty);
      }
      empty.textContent = 'Nothing matches that search.';
      empty.hidden = false;
    } else if (empty) empty.hidden = true;
  }

  tooltipFor(d) {
    const reg = this.game.registry;
    const unit = this.game.settings.get('tempUnit');
    const parts = [`<b>${escapeHtml(d.name)}</b> <span class="tt-state">${STATE_NAMES[d.stateId]}</span>`, escapeHtml(d.desc)];
    const facts = [];
    if (reg.hot[d.id]) facts.push(`▲ ${formatTemp(reg.hotT[d.id], unit)} → ${[...reg.hot[d.id].ids].map((i) => reg.name(i)).join(' / ')}`);
    if (reg.cold[d.id]) facts.push(`▼ ${formatTemp(reg.coldT[d.id], unit)} → ${[...reg.cold[d.id].ids].map((i) => reg.name(i)).join(' / ')}`);
    if (d.flammable) facts.push(`🔥 ignites ~${formatTemp(d.ignite, unit)}`);
    if (d.fuel) facts.push(`⛽ fuel value ${d.fuel}`);
    if (facts.length) parts.push(`<span class="tt-facts">${facts.map(escapeHtml).join('<br>')}</span>`);
    return parts.join('<br>');
  }

  attachTooltip(el, html) {
    el.addEventListener('mouseenter', () => {
      const tt = document.getElementById('tooltip');
      if (!tt) return;
      tt.innerHTML = html;
      tt.hidden = false;
      const r = el.getBoundingClientRect();
      const top = Math.min(window.innerHeight - tt.offsetHeight - 8, r.top);
      tt.style.top = `${Math.max(8, top)}px`;
      tt.style.left = `${r.right + 10}px`;
      if (r.right + 10 + tt.offsetWidth > window.innerWidth) tt.style.left = `${Math.max(8, r.left - tt.offsetWidth - 10)}px`;
    });
    el.addEventListener('mouseleave', () => { const tt = document.getElementById('tooltip'); if (tt) tt.hidden = true; });
  }

  filter(q) {
    this.query = q.trim().toLowerCase();
    this.render();
  }

  /** Switch to the tab that holds a material (e.g. after picking it from the inspector). */
  revealMaterial(id) {
    const d = this.game.registry.get(id);
    if (d && d.tab !== this.tab && !this.query) this.setTab(d.tab);
  }

  sync() {
    const tools = this.game.tools;
    for (const [id, b] of this.buttons) b.classList.toggle('active', tools.tool === 'brush' && tools.material === id);
    for (const [key, b] of this.objButtons) b.classList.toggle('active', tools.tool === 'spawn' && tools.spawnType === key);
  }
}
