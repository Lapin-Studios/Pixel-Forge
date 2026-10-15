// Right-hand panel: live cursor readout, selected object/cell details and machine controls.
import { STATE_NAMES, POWER, POWER_LABELS } from '../materials/MaterialProperties.js';
import { REACTION_DEFS } from '../materials/Reactions.js';
import { escapeHtml, formatTemp } from '../utils/MathUtils.js';
import { drawMaterialIcon } from './MaterialPanel.js';

export class Inspector {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.key = null;
    this.root.innerHTML = `
      <section class="insp-section" id="insp-cursor"><h3>Cursor</h3><div class="insp-cursor-body"></div></section>
      <section class="insp-section" id="insp-selection"><h3>Selection</h3><div class="insp-sel-body"></div></section>`;
    this.cursorEl = this.root.querySelector('.insp-cursor-body');
    this.selEl = this.root.querySelector('.insp-sel-body');
  }

  get unit() { return this.game.settings.get('tempUnit'); }

  onHover() { /* cursor section refreshes on the UI tick */ }

  refresh(force) {
    this.renderCursor();
    const tools = this.game.tools;
    let sel = tools.selected;
    if (sel && sel.type === 'object' && sel.obj.dead) { tools.selected = sel = null; }
    const key = sel ? (sel.type === 'object' ? `o${sel.obj.id}` : `c${sel.x},${sel.y}`) : `m${tools.tool}${tools.material}${tools.spawnType}`;
    if (force || key !== this.key) {
      this.key = key;
      this.buildSelection(sel);
    } else {
      this.updateSelection(sel);
    }
  }

  renderCursor() {
    const game = this.game, world = game.world, reg = game.registry;
    const h = game.tools.hover;
    if (!world || !h.inside) { this.cursorEl.innerHTML = '<p class="muted">Move the cursor over the world.</p>'; return; }
    const i = h.y * world.w + h.x;
    const om = world.objMask[i];
    let html;
    if (om) {
      const o = game.objects.byId.get(Math.abs(om));
      const li = world.objLocal[i];
      const m = o ? o.mat[li] : 0;
      html = `<div class="kv"><span>Object</span><b>${escapeHtml(o?.name || '?')}</b></div>
        <div class="kv"><span>${om > 0 ? 'Body' : 'Contents'}</span><b>${m ? escapeHtml(reg.name(m)) : 'empty'}</b></div>
        <div class="kv"><span>Temperature</span><b>${formatTemp(o ? o.temp[li] : NaN, this.unit)}</b></div>`;
    } else {
      const m = world.cells[i];
      const extra = [];
      if (world.burn[i]) extra.push('<span class="tag tag-fire">burning</span>');
      if (world.power[i]) extra.push('<span class="tag tag-power">powered</span>');
      if (world.pipe[i]) extra.push(`<span class="tag">carrying ${escapeHtml(reg.name(world.pipe[i]))}</span>`);
      html = `<div class="kv"><span>Material</span><b>${escapeHtml(reg.name(m))}</b></div>
        <div class="kv"><span>Temperature</span><b>${formatTemp(world.temp[i], this.unit)}</b></div>
        <div class="kv"><span>Position</span><b>${h.x}, ${h.y}</b></div>${extra.length ? `<div class="tags">${extra.join('')}</div>` : ''}`;
    }
    this.cursorEl.innerHTML = html;
  }

  buildSelection(sel) {
    const el = this.selEl;
    el.innerHTML = '';
    const title = this.root.querySelector('#insp-selection h3');
    if (!sel) {
      title.textContent = this.game.tools.tool === 'spawn' ? 'Placing' : 'Brush material';
      this.buildMaterialInfo(this.game.tools.material);
      return;
    }
    if (sel.type === 'cell') {
      title.textContent = 'Cell';
      this.buildCellInfo(sel);
      return;
    }
    title.textContent = sel.obj.isRagdoll ? 'Ragdoll' : 'Object';
    this.buildObjectInfo(sel.obj);
  }

  updateSelection(sel) {
    if (!sel) return;
    if (sel.type === 'object') {
      const d = sel.obj.describe();
      const rowsEl = this.selEl.querySelector('.insp-rows');
      if (rowsEl) rowsEl.innerHTML = this.rowsHtml(d.rows);
      const barsEl = this.selEl.querySelector('.insp-bars');
      if (barsEl) barsEl.innerHTML = this.barsHtml(d.bars);
      const contEl = this.selEl.querySelector('.insp-contents');
      if (contEl) contEl.innerHTML = this.contentsHtml(d.contents);
      // Rebuild controls when the set of controls changes (e.g. new craftable recipe).
      const sig = (d.controls || []).map((c) => `${c.id}:${c.label}:${c.disabled ? 1 : 0}`).join('|');
      if (sig !== this.controlSig) this.buildObjectInfo(sel.obj);
    } else if (sel.type === 'cell') {
      const rowsEl = this.selEl.querySelector('.insp-rows');
      if (rowsEl) rowsEl.innerHTML = this.rowsHtml(this.cellRows(sel));
    }
  }

  rowsHtml(rows = []) {
    return rows.map(([k, v]) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('');
  }

  barsHtml(bars = []) {
    return (bars || []).map((b) => `
      <div class="bar"><div class="bar-label"><span>${escapeHtml(b.label)}</span><span>${Math.round(b.value * 100)}%</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, b.value * 100))}%;background:${b.color}"></div></div></div>`).join('');
  }

  contentsHtml(contents) {
    if (!contents || !contents.length) return '';
    const reg = this.game.registry;
    return `<div class="insp-sub">Contents</div>` + contents.slice(0, 8).map((c) => `
      <div class="kv"><span>${escapeHtml(reg.name(c.m))}</span><b>${c.count} · ${formatTemp(c.avgT, this.unit)}</b></div>`).join('');
  }

  buildObjectInfo(o) {
    const el = this.selEl;
    const d = o.describe();
    el.innerHTML = `
      <div class="insp-title">${escapeHtml(d.title)}</div>
      <div class="insp-subtitle">${escapeHtml(d.subtitle || '')}</div>
      <div class="insp-rows">${this.rowsHtml(d.rows)}</div>
      <div class="insp-bars">${this.barsHtml(d.bars)}</div>
      <div class="insp-contents">${this.contentsHtml(d.contents)}</div>
      <div class="insp-controls"></div>
      <div class="insp-actions">
        <button class="btn btn-sm" data-a="rotl" title="Tilt left">⟲</button>
        <button class="btn btn-sm" data-a="level" title="Level (R)">Level</button>
        <button class="btn btn-sm" data-a="rotr" title="Tilt right">⟳</button>
        <button class="btn btn-sm btn-danger" data-a="delete" title="Delete (Del)">Delete</button>
      </div>`;
    const tools = this.game.tools;
    if (o.isRagdoll) {
      el.querySelector('.insp-actions').innerHTML = '<button class="btn btn-sm btn-danger" data-a="delete" title="Delete (Del)">Delete</button>';
      el.querySelector('[data-a=delete]').onclick = () => { tools.deleteDoll(o); tools.selected = null; this.refresh(true); };
      this.buildControls(el.querySelector('.insp-controls'), d.controls || []);
      this.controlSig = (d.controls || []).map((c) => `${c.id}:${c.label}:${c.disabled ? 1 : 0}`).join('|');
      return;
    }
    el.querySelector('[data-a=rotl]').onclick = () => tools.rotateObject(o, o.angle - Math.PI / 12);
    el.querySelector('[data-a=rotr]').onclick = () => tools.rotateObject(o, o.angle + Math.PI / 12);
    el.querySelector('[data-a=level]').onclick = () => tools.rotateObject(o, 0);
    el.querySelector('[data-a=delete]').onclick = () => { tools.deleteObject(o); this.refresh(true); };
    this.buildControls(el.querySelector('.insp-controls'), d.controls || []);
    this.controlSig = (d.controls || []).map((c) => `${c.id}:${c.label}:${c.disabled ? 1 : 0}`).join('|');
  }

  buildControls(root, controls) {
    root.innerHTML = '';
    for (const c of controls) {
      const wrap = document.createElement('div');
      wrap.className = `ctl ctl-${c.type}`;
      if (c.type === 'button') {
        const b = document.createElement('button');
        b.className = `btn ${c.primary ? 'btn-primary' : ''} ${c.id && c.id.startsWith('preset-') ? 'btn-sm' : ''}`;
        if (c.id && c.id.startsWith('preset-')) wrap.classList.add('ctl-inline');
        b.textContent = c.label;
        b.disabled = !!c.disabled;
        b.onclick = () => { this.game.audio?.play('click'); c.onClick(); this.refresh(true); };
        wrap.appendChild(b);
      } else if (c.type === 'toggle') {
        wrap.innerHTML = `<label class="setting compact"><span>${escapeHtml(c.label)}</span><input type="checkbox" ${c.value ? 'checked' : ''}><i class="switch"></i></label>`;
        wrap.querySelector('input').onchange = (e) => { c.onChange(e.target.checked); this.game.audio?.play('click'); };
      } else if (c.type === 'slider') {
        const fmt = c.format || ((v) => String(v));
        wrap.innerHTML = `<div class="bar-label"><span>${escapeHtml(c.label)}</span><span class="val">${escapeHtml(fmt(c.value))}</span></div>
          <input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}">`;
        const input = wrap.querySelector('input');
        input.oninput = () => { const v = Number(input.value); c.onChange(v); wrap.querySelector('.val').textContent = fmt(v); };
      } else if (c.type === 'note') {
        wrap.innerHTML = `<p class="muted small">${escapeHtml(c.label)}</p>`;
      }
      root.appendChild(wrap);
    }
  }

  cellRows(sel) {
    const game = this.game, world = game.world, reg = game.registry;
    const i = sel.y * world.w + sel.x;
    const m = world.cells[i];
    const rows = [
      ['Material', reg.name(m)],
      ['State', m ? STATE_NAMES[reg.state[m]] : 'Empty'],
      ['Temperature', formatTemp(world.temp[i], this.unit)],
    ];
    if (world.burn[i]) rows.push(['Burning', `${world.burn[i]} ticks left`]);
    if (reg.powerKind[m]) rows.push(['Power', world.power[i] ? 'Live ⚡' : 'Not powered']);
    if (m === reg.THERMOSTAT || m === reg.HEAT_SENSOR) rows.push(['Setpoint', formatTemp(world.life[i], this.unit)]);
    if (m === reg.HEAT_LIMITER) rows.push(['Limit', `${formatTemp(world.life[i], this.unit)} within 12 cells`]);
    if (world.pipe[i]) rows.push(['Pipe carries', reg.name(world.pipe[i])]);
    return rows;
  }

  buildCellInfo(sel) {
    const game = this.game, world = game.world, reg = game.registry;
    if (!world.inBounds(sel.x, sel.y)) return;
    const i = sel.y * world.w + sel.x;
    const m = world.cells[i];
    this.selEl.innerHTML = `<div class="insp-rows">${this.rowsHtml(this.cellRows(sel))}</div><div class="insp-controls"></div><div class="insp-mat"></div>`;
    const controls = [];
    if (m === reg.SWITCH) controls.push({ type: 'button', id: 'sw', label: world.life[i] === 1 ? 'Turn switch OFF' : 'Turn switch ON', primary: true, onClick: () => game.tools.toggleSwitchAt(sel.x, sel.y) });
    if (m === reg.HEAT_LIMITER) {
      controls.push({
        type: 'slider', id: 'lim', label: 'Heat limit (whole block)', min: 0, max: 5000, step: 25, value: world.life[i],
        format: (v) => formatTemp(v, this.unit),
        onChange: (v) => this.setThermostat(sel.x, sel.y, v),
      });
    }
    if (m === reg.THERMOSTAT || m === reg.HEAT_SENSOR) {
      controls.push({
        type: 'slider', id: 'sp', label: `${reg.name(m)} setpoint (whole block)`, min: -100, max: 2500, step: 10, value: world.life[i],
        format: (v) => formatTemp(v, this.unit),
        onChange: (v) => this.setThermostat(sel.x, sel.y, v),
      });
    }
    if (m) controls.push({ type: 'button', id: 'pick', label: `Use ${reg.name(m)} as brush`, onClick: () => game.tools.selectMaterial(m) });
    this.buildControls(this.selEl.querySelector('.insp-controls'), controls);
    if (m) this.buildMaterialInfo(m, this.selEl.querySelector('.insp-mat'));
  }

  setThermostat(x, y, v) {
    const world = this.game.world;
    const stack = [y * world.w + x];
    const target = world.cells[stack[0]];
    const seen = new Set(stack);
    while (stack.length && seen.size < 2000) {
      const j = stack.pop();
      world.life[j] = v;
      world.wake(j);
      const jx = j % world.w, jy = (j / world.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = jx + dx, ny = jy + dy;
        if (!world.inBounds(nx, ny)) continue;
        const k = ny * world.w + nx;
        if (!seen.has(k) && world.cells[k] === target) { seen.add(k); stack.push(k); }
      }
    }
  }

  buildMaterialInfo(m, target = this.selEl) {
    const reg = this.game.registry;
    const d = reg.get(m);
    if (!d) return;
    if (this.game.tools.tool === 'spawn' && target === this.selEl) {
      target.innerHTML = '<p class="muted">Click in the world to place the object. Press Esc to stop.</p>';
      return;
    }
    const facts = [['State', STATE_NAMES[d.stateId]], ['Density', d.state === 'gas' ? `${d.density} (air 1.2)` : String(d.density)], ['Conductivity', `${Math.round(d.cond * 100)}%`]];
    if (reg.hot[m]) facts.push([`Above ${formatTemp(reg.hotT[m], this.unit)}`, [...reg.hot[m].ids].map((i) => reg.name(i)).join(' / ')]);
    if (reg.cold[m]) facts.push([`Below ${formatTemp(reg.coldT[m], this.unit)}`, [...reg.cold[m].ids].map((i) => reg.name(i)).join(' / ')]);
    if (d.flammable) facts.push(['Ignites', `~${formatTemp(d.ignite, this.unit)}`]);
    if (d.fuel) facts.push(['Fuel value', String(d.fuel)]);
    if (reg.powerKind[m] && reg.powerKind[m] !== POWER.NONE) facts.push(['Electrical', POWER_LABELS[reg.powerKind[m]]]);
    const reactions = REACTION_DEFS.filter((r) => {
      const inSpec = (spec) => (Array.isArray(spec) ? spec : [spec]).some((s) => s === d.key || (s.startsWith('#') && reg.hasTag(m, s.slice(1))));
      return inSpec(r.a) || inSpec(r.b);
    });
    const wrap = document.createElement('div');
    wrap.className = 'mat-info';
    const head = document.createElement('div');
    head.className = 'mat-head';
    head.appendChild(drawMaterialIcon(reg, m, 12));
    const t = document.createElement('div');
    t.innerHTML = `<div class="insp-title">${escapeHtml(d.name)}</div><div class="insp-subtitle">${escapeHtml(d.cat)}</div>`;
    head.appendChild(t);
    wrap.appendChild(head);
    const p = document.createElement('p');
    p.className = 'mat-desc';
    p.textContent = d.desc;
    wrap.appendChild(p);
    const rows = document.createElement('div');
    rows.innerHTML = this.rowsHtml(facts);
    wrap.appendChild(rows);
    if (reactions.length) {
      const r = document.createElement('div');
      r.innerHTML = `<div class="insp-sub">Reactions</div>` + reactions.slice(0, 6).map((x) => {
        const known = this.game.discovery.reactions.has(x.id);
        return `<div class="reaction-chip ${known ? 'known' : ''}">${known ? '✦ ' : ''}${escapeHtml(x.name)}</div>`;
      }).join('');
      wrap.appendChild(r);
    }
    if (target === this.selEl) target.innerHTML = '';
    target.appendChild(wrap);
  }
}
