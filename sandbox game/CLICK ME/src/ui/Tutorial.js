// Short interactive tutorial: each step completes when the player actually does the thing.
import { isCavityKind } from '../objects/WorldObject.js';

function countMat(obj, ids) {
  let c = 0;
  for (let i = 0; i < obj.mask.length; i++) if (isCavityKind(obj.mask[i]) && ids.includes(obj.mat[i])) c++;
  return c;
}

export class Tutorial {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.step = -1;
    this.panel = document.getElementById('tutorial-panel');
    this.base = null;
    const reg = game.registry;
    const gold = reg.id('gold'), mgold = reg.id('molten_gold'), sand = reg.id('sand');
    this.steps = [
      {
        title: 'Welcome to Pixel Forge',
        text: 'Every pixel is simulated: heat flows, metals melt, liquids pour. This tutorial walks you through casting a <b>gold bar</b>. Press <b>Next</b> to begin.',
        manual: true,
      },
      {
        title: 'Look around',
        text: 'Zoom with the <b>mouse wheel</b> and pan with <b>WASD</b> or middle-drag. Try it now.',
        start: () => { this.base = { x: game.camera.x, y: game.camera.y, z: game.camera.zoom }; },
        check: () => Math.abs(game.camera.x - this.base.x) + Math.abs(game.camera.y - this.base.y) > 20 || Math.abs(game.camera.zoom - this.base.z) > 0.3,
      },
      {
        title: 'Paint some sand',
        text: 'Pick <b>Sand</b> in the left sidebar (Earth &amp; Minerals) and <b>left-click</b> in empty space. Right-click erases.',
        start: () => { this.base = this.countWorld(sand); },
        check: () => this.countWorld(sand) > this.base + 30,
      },
      {
        title: 'Grab the crucible',
        text: 'The furnace on the left holds a <b>crucible full of gold</b>. Press <b>5</b> for the Hand tool and drag the crucible by its wall — lift it out of the furnace.',
        check: () => game.tools.held && game.tools.held.type.startsWith('crucible'),
      },
      {
        title: 'Tilt it',
        text: 'While holding it, press <b>Q</b> / <b>E</b> or scroll the wheel to tilt. Level it again with <b>R</b>, then put it back in the furnace chamber.',
        check: () => game.tools.held && Math.abs(game.tools.held.angle) > 0.35,
      },
      {
        title: 'Melt the gold',
        text: 'Gold melts at <b>1064°C</b>. Leave the crucible in the burning furnace (fuel it with the inspector or coal in the hopper). Hover it to watch the temperature climb.',
        check: () => game.objects.list.some((o) => o.isContainer && !o.castShape && countMat(o, [mgold]) >= 15),
      },
      {
        title: 'Pour into the gold-bar mould',
        text: 'Carry the glowing crucible over the <b>Gold Bar Mould</b> on the casting table and tilt it to pour. Fill the cavity to the top.',
        check: () => game.objects.list.some((o) => o.castShape === 'bar' && countMat(o, [gold, mgold]) >= 30),
      },
      {
        title: 'Cool and extract',
        text: 'Wait until the mould label turns green (“ready”). Then hover the mould and press <b>X</b> — or select it with Inspect (6) and click <b>Extract casting</b>.',
        check: () => game.objects.list.some((o) => o.isItem && o.kind === 'bar' && o.material === 'gold'),
      },
      {
        title: 'You cast a gold bar!',
        text: 'Carry it around, drop it back in a crucible to remelt, or craft with it on the workbench. Open the <b>Recipe Book</b> (B) to discover alloys, smelting and machines. Have fun!',
        manual: true,
        last: true,
      },
    ];
  }

  countWorld(m) {
    const cells = this.game.world.cells;
    let c = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i] === m) c++;
    return c;
  }

  offer() {
    this.ui.confirm({
      title: 'New here?',
      message: 'Take the 2-minute interactive tutorial and cast your first gold bar. You can replay it any time from the top bar.',
      confirmLabel: 'Start tutorial',
      onConfirm: () => this.start(),
    });
    this.game.settings.set('tutorialDone', true);
  }

  start() {
    this.step = 0;
    this.show();
  }

  stop() {
    this.step = -1;
    this.panel.hidden = true;
    this.game.settings.set('tutorialDone', true);
  }

  show() {
    const s = this.steps[this.step];
    if (!s) { this.stop(); return; }
    s.start?.();
    this.panel.hidden = false;
    this.panel.innerHTML = `
      <div class="tut-head"><span class="tut-step">Step ${this.step + 1} / ${this.steps.length}</span><button class="tut-x" title="Close tutorial">✕</button></div>
      <h3>${s.title}</h3>
      <p>${s.text}</p>
      <div class="tut-foot">
        ${s.manual ? `<button class="btn btn-primary tut-next">${s.last ? 'Finish' : 'Next'}</button>` : '<span class="tut-wait">Waiting for you…</span><button class="btn btn-sm tut-skip">Skip step</button>'}
      </div>`;
    this.panel.classList.remove('pop');
    void this.panel.offsetWidth;
    this.panel.classList.add('pop');
    this.panel.querySelector('.tut-x').onclick = () => this.stop();
    const next = this.panel.querySelector('.tut-next');
    if (next) next.onclick = () => this.advance();
    const skip = this.panel.querySelector('.tut-skip');
    if (skip) skip.onclick = () => this.advance();
  }

  advance() {
    this.step++;
    if (this.step >= this.steps.length) { this.stop(); return; }
    this.game.audio?.play('discover');
    this.show();
  }

  check() {
    if (this.step < 0) return;
    const s = this.steps[this.step];
    if (!s || s.manual || !s.check) return;
    try {
      if (s.check()) this.advance();
    } catch (e) { /* objects may be mid-update */ }
  }
}
