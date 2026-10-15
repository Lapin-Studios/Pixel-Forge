// Title screen: shown after the Lapin Studios splash, over the live world. Play, worlds, the
// interactive tutorial, a How to Play guide, loading and settings.
const HOW_TO_PLAY = [
  ['🖌 Painting', `Pick a material in the left sidebar (use the tabs or search) and <b>left-drag</b> to paint it.
    <b>Right-drag</b> erases. <b>Wheel</b> zooms, <b>middle-drag</b> or <b>WASD</b> pans, <b>Space</b> pauses,
    <b>[ ]</b> change the brush size. Brush size 1 paints exactly one pixel.`],
  ['🧰 Tools', `<b>1</b> Brush · <b>2</b> Eraser · <b>3</b> Heat gun · <b>4</b> Freeze spray · <b>5</b> Hand (drag objects and people) ·
    <b>6</b> Inspect · <b>7</b> Carve (cut solids loose) · <b>8</b> Mix (stir and dissolve) · <b>9</b> Line · <b>0</b> Rope · <b>K</b> Pin.`],
  ['🔥 Metalworking', `Drop ore or metal into a <b>Crucible</b>, heat it in a <b>Furnace</b> until it melts, carry it with the Hand,
    hold <b>Q / E</b> to tilt and pour into a <b>Mould</b>. When it has cooled, press <b>X</b> over the mould to take out your casting.`],
  ['🍳 Cooking', `Put ingredients in a <b>Cooking Pot</b> or <b>Frying Pan</b> (Tools tab → Kitchen) — they stir themselves.
    Set it on the <b>Hot Plate</b>, <b>Electric Stove</b> or in the <b>Oven</b> and pick a quick setting in the Inspector.
    The Food tab has a recipe card.`],
  ['⚡ Electronics', `Paint a <b>Battery</b>, draw <b>Wire</b> to a <b>Lamp</b> (or any part). Corners connect.
    Click switches to flip them, press <b>V</b> to see what's live. The Heat Limiter caps temperatures around it.`],
  ['🧍 Ragdolls & physics', `Tools tab → People → <b>Ragdoll Human</b>. He stands on his own; grab any part with the Hand to drag,
    dangle or throw him. Tie things up with <b>Rope</b>, nail them with <b>Pin</b>. Painted wood, stone and metal stay put —
    cut a piece loose with <b>Carve</b> (7) and it falls, tips and floats.`],
  ['💡 Handy keys', `<b>Ctrl+Z / Ctrl+Y</b> undo / redo · <b>Ctrl+C / Ctrl+V</b> copy / paste an object · <b>H</b> thermal view ·
    <b>B</b> recipe book · <b>Ctrl+S</b> save · <b>?</b> all controls · <b>Esc</b> back to this menu.`],
];

export class MainMenu {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.isOpen = false;
    this.el = document.createElement('div');
    this.el.id = 'main-menu';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="menu-card">
        <div class="menu-brand">
          <img src="assets/icons/logo.svg" alt="" width="56" height="56">
          <h1>PIXEL FORGE</h1>
          <p class="menu-tag">A pixel physics sandbox — melt, pour, cook, wire and build.</p>
        </div>
        <div class="menu-main">
          <button class="menu-btn primary" data-m="play">▶ <span>Play</span></button>
          <button class="menu-btn" data-m="tutorial">🎓 <span>Tutorial</span><small>Cast your first gold bar, step by step</small></button>
          <button class="menu-btn" data-m="howto">📖 <span>How to Play</span><small>Controls, tools and tips</small></button>
          <button class="menu-btn" data-m="worlds">🌍 <span>Worlds</span><small>Foundry, Kitchen, Volcano, Factory…</small></button>
          <button class="menu-btn" data-m="blank">⬛ <span>Blank Map</span><small>Start from nothing</small></button>
          <div class="menu-row">
            <button class="menu-btn small" data-m="load">📂 <span>Load</span></button>
            <button class="menu-btn small" data-m="settings">⚙ <span>Settings</span></button>
          </div>
        </div>
        <div class="menu-howto" hidden>
          <div class="menu-howto-body">${HOW_TO_PLAY.map(([h, p]) => `<section><h3>${h}</h3><p>${p}</p></section>`).join('')}</div>
          <div class="menu-row">
            <button class="menu-btn small" data-m="back">← <span>Back</span></button>
            <button class="menu-btn small primary" data-m="tutorial">🎓 <span>Start the tutorial</span></button>
          </div>
        </div>
        <p class="menu-foot">by Lapin Studios</p>
      </div>`;
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (b) this.action(b.dataset.m);
    });
  }

  open() {
    this.showHowTo(false);
    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add('show'));
    this.isOpen = true;
    this.ui.tutorial?.stop?.();
  }

  close() {
    this.el.classList.remove('show');
    this.isOpen = false;
    setTimeout(() => { if (!this.isOpen) this.el.hidden = true; }, 250);
  }

  showHowTo(on) {
    this.el.querySelector('.menu-main').hidden = on;
    this.el.querySelector('.menu-howto').hidden = !on;
    this.el.querySelector('.menu-card').classList.toggle('wide', on);
  }

  async action(name) {
    const game = this.game, ui = this.ui;
    game.audio?.ensure();
    game.audio?.play('click');
    switch (name) {
      case 'play':
        this.close();
        game.setRunning(true);
        break;
      case 'tutorial':
        // The tutorial walks through The Foundry, so start it in a fresh copy of that world.
        this.close();
        await game.loadPreset('foundry', { silent: true });
        game.setRunning(true);
        ui.tutorial.start();
        break;
      case 'howto': this.showHowTo(true); break;
      case 'back': this.showHowTo(false); break;
      case 'worlds': this.close(); ui.openSaveMenu('presets'); break;
      case 'blank':
        this.close();
        await game.loadPreset('blank');
        game.setRunning(true);
        break;
      case 'load': this.close(); ui.openSaveMenu('load'); break;
      case 'settings': this.close(); ui.openSettings(); break;
      default: break;
    }
  }
}

/** Fade out the Lapin Studios splash two seconds after the page opened. */
export function dismissSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  const wait = Math.max(0, 2000 - performance.now());
  setTimeout(() => {
    el.classList.add('fade');
    setTimeout(() => el.remove(), 900);
  }, wait);
}
