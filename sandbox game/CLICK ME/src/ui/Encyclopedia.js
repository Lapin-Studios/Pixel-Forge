// Recipe Book: guide, materials, reactions, smelting, casting, workbench and machines.
// Unknown recipes stay hidden ("???") until the player produces them, unless "Reveal all" is on.
import { CATEGORIES, STATE_NAMES } from '../materials/MaterialProperties.js';
import { REACTION_DEFS } from '../materials/Reactions.js';
import { CAST_SHAPES, WORKBENCH_RECIPES } from '../crafting/RecipeBook.js';
import { OBJECT_TYPES } from '../objects/ObjectFactory.js';
import { CELL_MACHINES } from '../machines/MachineRegistry.js';
import { escapeHtml, formatTemp } from '../utils/MathUtils.js';
import { drawMaterialIcon, drawObjectIcon } from './MaterialPanel.js';

const TABS = [
  ['guide', 'Metalworking Guide'],
  ['reactions', 'Reactions'],
  ['smelting', 'Smelting & Phases'],
  ['casting', 'Casting'],
  ['workbench', 'Workbench'],
  ['machines', 'Machines'],
  ['materials', 'Materials'],
];

export class Encyclopedia {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.tab = 'guide';
    this.reveal = false;
    this.query = '';
    this.dirty = false;
  }

  markDirty() { this.dirty = true; }

  open(tab) {
    if (tab) this.tab = tab;
    const body = document.createElement('div');
    body.className = 'book';
    body.innerHTML = `
      <div class="book-top">
        <nav class="tabs">${TABS.map(([k, l]) => `<button class="tab" data-tab="${k}">${l}</button>`).join('')}</nav>
        <div class="book-tools">
          <span class="book-progress"></span>
          <label class="setting compact"><span>Reveal all</span><input type="checkbox" class="reveal" ${this.reveal ? 'checked' : ''}><i class="switch"></i></label>
        </div>
      </div>
      <div class="book-body"></div>`;
    this.body = body;
    body.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.render(); }));
    body.querySelector('.reveal').addEventListener('change', (e) => { this.reveal = e.target.checked; this.render(); });
    this.ui.openModal({ title: 'Recipe Book', body, wide: true });
    this.render();
  }

  known(kind, id) {
    const d = this.game.discovery;
    if (this.reveal) return true;
    if (kind === 'reaction') return d.reactions.has(id);
    if (kind === 'craft') return d.crafts.has(id);
    if (kind === 'material') return d.materials.has(id);
    return true;
  }

  matName(key) {
    if (key.startsWith('#')) return `any ${key.slice(1).replace('_', ' ')}`;
    return this.game.registry.get(key)?.name || key;
  }

  specNames(spec) {
    return (Array.isArray(spec) ? spec : [spec]).map((s) => this.matName(s)).join(' / ');
  }

  render() {
    const body = this.body;
    if (!body) return;
    body.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab));
    const disc = this.game.discovery;
    const totalCrafts = Object.keys(CAST_SHAPES).length + WORKBENCH_RECIPES.length;
    const knownCrafts = Object.keys(CAST_SHAPES).filter((s) => disc.crafts.has(`cast_${s}`)).length + WORKBENCH_RECIPES.filter((r) => disc.crafts.has(`craft_${r.id}`)).length;
    body.querySelector('.book-progress').textContent = `Discovered: ${disc.reactions.size}/${REACTION_DEFS.length} reactions · ${knownCrafts}/${totalCrafts} crafts`;
    const out = body.querySelector('.book-body');
    out.innerHTML = '';
    out.scrollTop = 0;
    const fn = this[`render_${this.tab}`];
    if (fn) fn.call(this, out);
  }

  render_guide(out) {
    out.innerHTML = `
      <div class="guide">
        <h2>Casting a gold bar</h2>
        <ol class="steps">
          <li><b>Get gold.</b> Paint <i>Gold</i> (or <i>Gold Ore</i>) from <i>Ores &amp; Metals</i> straight into a crucible's cavity — or dip the crucible into a pile.</li>
          <li><b>Heat it.</b> Lower the crucible into a <i>Furnace</i> chamber (drag with the Hand tool). Keep the furnace fuelled: drop coal / charcoal into its hopper, or click “Shovel in coal”. Set the target above the melting point (gold: 1064°C).</li>
          <li><b>Wait for it to melt.</b> Hover the crucible to see its contents' temperature, or dip a <i>Thermometer</i> in. Ore releases molten metal and lighter slag that floats on top.</li>
          <li><b>Pick it up.</b> Grab the crucible by its wall. The contents keep their heat while you carry them.</li>
          <li><b>Pour.</b> Hold it over a mould and tilt with <kbd>Q</kbd>/<kbd>E</kbd> or the wheel. Liquid flows over the rim cell by cell — pour slowly to avoid splashing slag in.</li>
          <li><b>Cool.</b> Moulds on a <i>Casting Table</i> or near a <i>Cooling Station</i> solidify fast. The label turns green when it's ready.</li>
          <li><b>Extract.</b> Hover the mould and press <kbd>X</kbd> (or use the inspector). You get a real item made from the cast cells.</li>
          <li><b>Use it.</b> Put items on a <i>Workbench</i> to craft, drop them back into a crucible to remelt, or press <kbd>F</kbd> to fuse them into the world.</li>
        </ol>
        <h2>Smelting ore</h2>
        <p>Most ores need <b>carbon</b>: mix charcoal, coal or coke with the ore in the crucible, then heat. Iron ore needs carbon above 1000°C and the iron then melts at 1538°C — use an <i>Electric Furnace</i> set to 1600°C+. Gold, silver and copper ore can simply be melted; slag floats on the metal.</p>
        <h2>Alloys</h2>
        <p>Melt two metals in the same crucible: copper + tin → <b>bronze</b>, copper + zinc → <b>brass</b>, molten iron + carbon → <b>steel</b>, tin + lead → <b>pewter</b>, gold + silver → <b>electrum</b>, gold + copper → <b>rose gold</b>.</p>
        <h2>Cooking</h2>
        <p>The <b>Food</b> tab has ingredients; the <b>Tools → Kitchen</b> group has a pot, frying pan, hot plate, oven and fridge.
        Mix by touching: flour + water → <b>dough</b>, flour + milk → <b>batter</b>, batter + sugar or egg → <b>cake batter</b>,
        milk + vinegar → <b>cheese</b>, sugar + water → <b>syrup</b>, baking soda + vinegar → fizzing CO₂.
        Then heat: egg (70°C) → fried egg, batter (150°C) → pancake, dough (180°C) → bread → toast, cake batter (160°C) → cake,
        sugar (186°C) → caramel → candy, popcorn kernels (180°C) pop. Chill milk + sugar below -2°C in the fridge for <b>ice cream</b>. Overcook anything and it turns to charcoal!</p>
        <h2>Electronics</h2>
        <p>Every device works when it <b>touches</b> a powered conductor (up, down, left or right — not diagonally).
        Build a circuit: <i>Battery</i> or <i>Solar Panel</i> → <i>Copper Wire</i> → device (lamp, LED, buzzer, fan, pump, conveyor, heating element…). Live wire glows yellow.</p>
        <p>Control it with a <i>Switch</i> (click with Hand/Inspect or press T), a <i>Thermostat</i> (on while colder than its setpoint),
        a <i>Heat Sensor</i> (on while hotter), a <i>Liquid Sensor</i> (on while wet) or a <i>Pressure Plate</i> (on while something rests on it).
        Inspect any electrical cell to see whether it's live. The Electric Furnace takes power through the copper terminal on its lower-left side.</p>
      </div>`;
  }

  render_reactions(out) {
    const groups = new Map();
    for (const r of REACTION_DEFS) {
      if (!groups.has(r.group)) groups.set(r.group, []);
      groups.get(r.group).push(r);
    }
    for (const [g, list] of groups) {
      const sec = document.createElement('section');
      sec.innerHTML = `<h3>${escapeHtml(g)}</h3>`;
      const grid = document.createElement('div');
      grid.className = 'recipe-grid';
      for (const r of list) {
        const k = this.known('reaction', r.id);
        const outA = r.outA && r.outA !== 'keep' ? (r.outA === 'empty' ? '∅' : this.matName(r.outA)) : null;
        const outB = r.outB && r.outB !== 'keep' ? (r.outB === 'empty' ? '∅' : this.matName(r.outB)) : null;
        const products = [outA, outB].filter(Boolean).join(' + ') || 'changes';
        grid.insertAdjacentHTML('beforeend', `
          <div class="recipe ${k ? 'known' : 'unknown'}">
            <div class="recipe-name">${k ? escapeHtml(r.name) : '???'}</div>
            <div class="recipe-eq">${escapeHtml(this.specNames(r.a))} + ${escapeHtml(this.specNames(r.b))} → <b>${k ? escapeHtml(products) : '???'}</b></div>
            ${r.minT ? `<div class="recipe-cond">above ${formatTemp(r.minT, this.game.settings.get('tempUnit'))}</div>` : ''}
            <div class="recipe-desc">${k ? escapeHtml(r.desc) : 'Not discovered yet — try combining these.'}</div>
          </div>`);
      }
      sec.appendChild(grid);
      out.appendChild(sec);
    }
  }

  render_smelting(out) {
    const reg = this.game.registry;
    const unit = this.game.settings.get('tempUnit');
    const rows = [];
    for (const d of reg.defs) {
      if (d.hidden || d.id === 0) continue;
      for (const [dir, tr] of [['▲', reg.hot[d.id]], ['▼', reg.cold[d.id]]]) {
        if (!tr) continue;
        const prods = [...tr.ids].map((i) => reg.get(i));
        const known = this.reveal || prods.some((p) => p && this.game.discovery.materials.has(p.key)) || ['earth', 'liquid', 'gas'].includes(d.cat);
        rows.push({ d, dir, tr, prods, known });
      }
    }
    const cats = ['metal', 'alloy', 'earth', 'liquid', 'gas', 'food', 'organic', 'construction', 'fire', 'industrial'];
    for (const cat of cats) {
      const list = rows.filter((r) => r.d.cat === cat);
      if (!list.length) continue;
      const sec = document.createElement('section');
      sec.innerHTML = `<h3>${escapeHtml(CATEGORIES.find((c) => c.key === cat)?.name || cat)}</h3>`;
      const table = document.createElement('table');
      table.className = 'phase-table';
      table.innerHTML = list.map((r) => `<tr class="${r.known ? '' : 'unknown'}">
          <td>${escapeHtml(r.d.name)}</td>
          <td class="dir">${r.dir} ${formatTemp(r.tr.t, unit)}</td>
          <td>${r.known ? escapeHtml(r.prods.map((p) => p?.name || 'nothing').join(' / ')) : '???'}${r.tr.emit ? ` <small>(+ ${escapeHtml(reg.name(r.tr.emit))})</small>` : ''}</td></tr>`).join('');
      sec.appendChild(table);
      out.appendChild(sec);
    }
  }

  render_casting(out) {
    const grid = document.createElement('div');
    grid.className = 'recipe-grid';
    for (const [shape, info] of Object.entries(CAST_SHAPES)) {
      const k = this.known('craft', `cast_${shape}`);
      const card = document.createElement('div');
      card.className = `recipe ${k ? 'known' : 'unknown'}`;
      const icon = drawObjectIcon(this.game, info.mold, 40);
      card.appendChild(icon);
      card.insertAdjacentHTML('beforeend', `
        <div class="recipe-name">${escapeHtml(info.name.replace('{M}', 'Metal'))}</div>
        <div class="recipe-eq">Molten metal → ${escapeHtml(OBJECT_TYPES[info.mold].name)} → cool → extract</div>
        <div class="recipe-desc">${escapeHtml(info.desc)}${k ? ' ✦ Cast at least once.' : ''}</div>`);
      grid.appendChild(card);
    }
    out.appendChild(grid);
    out.insertAdjacentHTML('beforeend', '<p class="muted">A casting is perfect when ≥ 90% of the cavity is filled with a single metal. Sprue (pour-channel) metal is trimmed off as scrap you can remelt.</p>');
  }

  render_workbench(out) {
    const grid = document.createElement('div');
    grid.className = 'recipe-grid';
    for (const r of WORKBENCH_RECIPES) {
      const k = this.known('craft', `craft_${r.id}`);
      const inputs = r.inputs.map((i) => {
        let s = i.kind;
        if (i.mat) s = `${i.mat.map((m) => this.matName(m)).join('/')} ${i.kind}`;
        else if (i.tag) s = `${i.tag} ${i.kind}`;
        return s;
      }).join(' + ');
      const result = r.result.type === 'object' ? `working ${OBJECT_TYPES[r.result.object].name}` : r.name;
      grid.insertAdjacentHTML('beforeend', `
        <div class="recipe ${k ? 'known' : ''}">
          <div class="recipe-name">${escapeHtml(r.name)}${k ? ' ✦' : ''}</div>
          <div class="recipe-eq">${escapeHtml(inputs)} → <b>${escapeHtml(result)}</b></div>
          <div class="recipe-desc">${escapeHtml(r.desc)}</div>
        </div>`);
    }
    out.appendChild(grid);
    out.insertAdjacentHTML('beforeend', '<p class="muted">Rest the items on a Workbench, then select the bench with the Inspect tool (6) and press Craft. Wood and gem pieces come from the Carve tool (7).</p>');
  }

  render_machines(out) {
    const reg = this.game.registry;
    const grid = document.createElement('div');
    grid.className = 'recipe-grid';
    for (const [key, t] of Object.entries(OBJECT_TYPES)) {
      const card = document.createElement('div');
      card.className = 'recipe known';
      card.appendChild(drawObjectIcon(this.game, key, 40));
      card.insertAdjacentHTML('beforeend', `<div class="recipe-name">${escapeHtml(t.name)}</div><div class="recipe-eq">${escapeHtml(t.group)}</div><div class="recipe-desc">${escapeHtml(t.desc)}</div>`);
      grid.appendChild(card);
    }
    for (const c of CELL_MACHINES) {
      const d = reg.get(c.key);
      const card = document.createElement('div');
      card.className = 'recipe known';
      card.appendChild(drawMaterialIcon(reg, d.id, 12));
      card.insertAdjacentHTML('beforeend', `<div class="recipe-name">${escapeHtml(d.name)}</div><div class="recipe-eq">Cell machine</div><div class="recipe-desc">${escapeHtml(c.how)}</div>`);
      grid.appendChild(card);
    }
    out.appendChild(grid);
  }

  render_materials(out) {
    const reg = this.game.registry;
    const unit = this.game.settings.get('tempUnit');
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search materials…';
    search.className = 'book-search';
    search.value = this.query;
    out.appendChild(search);
    const list = document.createElement('div');
    list.className = 'mat-table';
    out.appendChild(list);
    const draw = () => {
      const q = this.query.toLowerCase();
      list.innerHTML = '';
      for (const d of reg.defs) {
        if (d.hidden) continue;
        if (q && !`${d.name} ${d.key} ${d.desc}`.toLowerCase().includes(q)) continue;
        const row = document.createElement('div');
        row.className = 'mat-row';
        row.appendChild(drawMaterialIcon(reg, d.id, 12));
        const facts = [STATE_NAMES[d.stateId]];
        if (reg.hot[d.id]) facts.push(`▲${formatTemp(reg.hotT[d.id], unit)}`);
        if (reg.cold[d.id]) facts.push(`▼${formatTemp(reg.coldT[d.id], unit)}`);
        row.insertAdjacentHTML('beforeend', `<div><b>${escapeHtml(d.name)}</b> <small class="muted">${escapeHtml(facts.join(' · '))}</small><br><span class="small">${escapeHtml(d.desc)}</span></div>`);
        row.addEventListener('click', () => { this.game.tools.selectMaterial(d.id); this.ui.closeModal(); });
        list.appendChild(row);
      }
    };
    search.addEventListener('input', () => { this.query = search.value; draw(); });
    draw();
    setTimeout(() => search.focus(), 50);
  }
}
