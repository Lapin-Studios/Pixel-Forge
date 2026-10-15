// Procedural sound effects and ambience via WebAudio — no audio files needed.
// Buses: sfx (world sounds, stereo-panned by camera position), ui (interface), amb (continuous beds).

const THROTTLE = {
  // world
  sizzle: 140, clink: 70, thud: 90, crackle: 260, hum: 500, pour: 110, pourSand: 110, pourMetal: 120,
  boom: 120, pickup: 60, drop: 60, craft: 200, cast: 200, whoosh: 160, buzz: 450, splash: 90, pop: 35,
  iceCrack: 300, melt: 1500, fuse: 90, fizz: 120, shatter: 200, powerOn: 400, powerOff: 400, relay: 250,
  delete: 120, creak: 220, fry: 260, bubble: 70, chisel: 120,
  oof: 260, ow: 320, scream: 1100, groan: 800, crack: 200, zap: 140,
  // painting & tools
  paintPowder: 85, paintLiquid: 110, paintGas: 110, paintSolid: 70, paintFire: 140, erase: 90, torch: 120,
  spray: 120, swish: 160,
  // ui
  click: 30, tool: 40, open: 120, close: 120, blip: 120, chime: 200, save: 300, load: 300, undo: 80,
  redo: 80, play: 120, pause: 120, error: 200, discover: 400, coin: 150, fanfare: 600, sad: 600,
};

const UI_SOUNDS = new Set(['click', 'tool', 'open', 'close', 'blip', 'chime', 'save', 'load', 'undo', 'redo', 'play', 'pause', 'error', 'discover', 'coin', 'fanfare', 'sad']);

export class AudioManager {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.last = new Map();
    this.unlocked = false;
    this.camera = null;
    this.out = null; // current output node for synths (set per play call)
    const unlock = () => {
      this.ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      const c = this.ctx = new AC();
      this.master = c.createGain();
      this.master.connect(c.destination);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.ui = c.createGain(); this.ui.connect(this.master);
      this.amb = c.createGain(); this.amb.connect(this.master);
      const len = c.sampleRate * 2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.buildAmbience();
      this.applyVolume();
      this.unlocked = true;
    } catch (e) {
      console.warn('Audio unavailable', e);
      this.ctx = null;
    }
    return this.ctx;
  }

  applyVolume() {
    if (!this.master) return;
    const s = this.settings;
    const muted = s?.get('muted');
    this.master.gain.value = muted ? 0 : (s?.get('volume') ?? 0.6) * 0.5;
    this.ui.gain.value = s?.get('uiSounds') === false ? 0 : 0.9;
    this.amb.gain.value = s?.get('ambience') ?? 0.6;
  }

  // ------------------------------------------------------------------ playback

  /** Play a sound. vol 0..1; opts.pan -1..1 (world sounds). */
  play(name, vol = 1, opts = {}) {
    if (!this.ctx || this.settings?.get('muted')) return;
    const fn = this[`_${name}`];
    if (!fn) return;
    const now = performance.now();
    const lim = THROTTLE[name] ?? 80;
    if (now - (this.last.get(name) || 0) < lim) return;
    this.last.set(name, now);
    try {
      const bus = UI_SOUNDS.has(name) ? this.ui : this.sfx;
      let out = bus;
      if (opts.pan && this.ctx.createStereoPanner) {
        out = this.ctx.createStereoPanner();
        out.pan.value = Math.max(-1, Math.min(1, opts.pan));
        out.connect(bus);
        setTimeout(() => out.disconnect(), 3000);
      }
      this.out = out;
      fn.call(this, vol);
    } catch (e) {
      /* never let audio break the game */
    } finally {
      this.out = null;
    }
  }

  /** Play a world sound at world position (wx, wy): panned left/right and quieter off-screen. */
  playAt(name, wx, wy, vol = 1) {
    const cam = this.camera;
    if (!cam) { this.play(name, vol); return; }
    const halfW = cam.viewW / 2 / cam.zoom, halfH = cam.viewH / 2 / cam.zoom;
    const dx = (wx - cam.x) / Math.max(1, halfW);
    const dy = (wy - cam.y) / Math.max(1, halfH);
    const off = Math.max(Math.abs(dx), Math.abs(dy));
    const att = off <= 1 ? 1 : Math.max(0.15, 1.6 - off * 0.6);
    this.play(name, vol * att, { pan: dx * 0.75 });
  }

  // ------------------------------------------------------------------ synth helpers

  _dest() { return this.out || this.sfx; }

  _env(gainNode, t0, attack, decay, peak) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  _tone(type, freq, dur, vol, freqEnd, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    this._env(g, t, 0.005, dur, vol);
    o.connect(g).connect(this._dest());
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noiseBurst(dur, vol, filterType, freq, q = 1, freqEnd, delay = 0, attack = 0.01) {
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    this._env(g, t, attack, dur, vol);
    src.connect(f).connect(g).connect(this._dest());
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + attack + 0.05);
  }

  _seq(notes, type, step, dur, vol) {
    notes.forEach((f, k) => this._tone(type, f, dur, vol, null, k * step));
  }

  // ------------------------------------------------------------------ interface sounds

  _click(v) { this._tone('square', 900, 0.03, 0.05 * v); }
  _tool(v) { this._tone('sine', 1250, 0.035, 0.06 * v); this._tone('sine', 1650, 0.03, 0.03 * v, null, 0.02); }
  _open(v) { this._noiseBurst(0.16, 0.05 * v, 'bandpass', 300, 1.2, 1400); }
  _close(v) { this._noiseBurst(0.14, 0.045 * v, 'bandpass', 1400, 1.2, 300); }
  _blip(v) { this._tone('sine', 880, 0.07, 0.05 * v); }
  _chime(v) { this._tone('sine', 1047, 0.25, 0.06 * v); this._tone('sine', 1319, 0.3, 0.05 * v, null, 0.07); }
  _save(v) { this._seq([660, 880, 1320], 'triangle', 0.07, 0.16, 0.08 * v); }
  _load(v) { this._seq([1320, 880, 660], 'triangle', 0.07, 0.16, 0.08 * v); }
  _undo(v) { this._tone('sine', 720, 0.08, 0.06 * v, 430); }
  _redo(v) { this._tone('sine', 430, 0.08, 0.06 * v, 720); }
  _play(v) { this._tone('triangle', 440, 0.08, 0.07 * v, 660); }
  _pause(v) { this._tone('triangle', 660, 0.08, 0.07 * v, 440); }
  _error(v) { this._tone('square', 160, 0.12, 0.08 * v, 120); }
  _discover(v) { this._seq([660, 990], 'sine', 0.09, 0.25, 0.08 * v); }
  _coin(v) {
    this._tone('sine', 1568, 0.18, 0.09 * v);
    this._tone('sine', 2093, 0.35, 0.08 * v, null, 0.08);
    this._noiseBurst(0.05, 0.05 * v, 'highpass', 5000, 1);
  }
  _fanfare(v) { this._seq([523, 659, 784, 1047, 1319], 'triangle', 0.09, 0.28, 0.09 * v); }
  _sad(v) { this._seq([392, 349, 294], 'triangle', 0.18, 0.35, 0.07 * v); }

  // ------------------------------------------------------------------ world sounds

  _pickup(v) { this._tone('triangle', 300, 0.08, 0.15 * v, 520); }
  _drop(v) { this._tone('triangle', 420, 0.08, 0.12 * v, 220); }
  _thud(v) { this._tone('sine', 110, 0.18, 0.35 * v, 55); this._noiseBurst(0.08, 0.12 * v, 'lowpass', 600); }
  _clink(v) {
    const f = 1800 + Math.random() * 600;
    this._tone('sine', f, 0.25, 0.08 * v);
    this._tone('sine', f * 1.51, 0.18, 0.05 * v);
    this._tone('sine', 140, 0.1, 0.12 * v, 80);
  }
  _delete(v) { this._noiseBurst(0.22, 0.08 * v, 'lowpass', 900, 0.8, 200); this._tone('sine', 220, 0.18, 0.06 * v, 80); }
  /** Voice-ish grunt: a buzzy glottal tone shaped by two formant filters. */
  _voice(f0, f1, dur, vol, formants, vibrato = 0) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (vibrato) {
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 7; lg.gain.value = vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    const g = c.createGain();
    this._env(g, t, 0.02, dur, vol);
    for (const [f, q] of formants) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      o.connect(bp).connect(g);
    }
    g.connect(this._dest());
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  _oof(v) { this._voice(170 + Math.random() * 30, 105, 0.16, 0.5 * v, [[600, 5], [1000, 6]]); this._noiseBurst(0.06, 0.05 * v, 'lowpass', 500); }
  _ow(v) { this._voice(300 + Math.random() * 40, 190, 0.28, 0.45 * v, [[750, 5], [1150, 6]]); }
  _scream(v) { this._voice(420 + Math.random() * 60, 520, 0.7, 0.3 * v, [[900, 4], [1400, 5]], 18); }
  _groan(v) { this._voice(150, 80, 0.75, 0.4 * v, [[500, 5], [850, 6]], 4); }
  _crack(v) { this._noiseBurst(0.05, 0.22 * v, 'highpass', 2500, 1); this._tone('square', 140, 0.05, 0.06 * v, 70); this._noiseBurst(0.04, 0.12 * v, 'bandpass', 1200, 2, null, 0.03); }
  _zap(v) {
    this._tone('sawtooth', 90 + Math.random() * 60, 0.12, 0.05 * v, 140);
    this._noiseBurst(0.1, 0.06 * v, 'highpass', 3500, 0.8);
  }
  _creak(v) { this._tone('sawtooth', 95 + Math.random() * 20, 0.12, 0.012 * v, 130); }
  _chisel(v) {
    this._tone('sine', 2600, 0.12, 0.07 * v);
    this._noiseBurst(0.06, 0.08 * v, 'highpass', 3000, 1);
    this._tone('sine', 2100, 0.1, 0.05 * v, null, 0.09);
  }

  _paintPowder(v) { this._noiseBurst(0.09, 0.05 * v, 'highpass', 2600 + Math.random() * 800, 0.8); }
  _paintLiquid(v) {
    this._tone('sine', 320 + Math.random() * 80, 0.09, 0.05 * v, 170);
    this._noiseBurst(0.07, 0.025 * v, 'lowpass', 900, 0.8);
  }
  _paintGas(v) { this._noiseBurst(0.12, 0.03 * v, 'bandpass', 4200, 0.7); }
  _paintSolid(v) { this._tone('triangle', 1400 + Math.random() * 300, 0.03, 0.04 * v); this._noiseBurst(0.03, 0.02 * v, 'bandpass', 2500, 2); }
  _paintFire(v) { this._noiseBurst(0.25, 0.05 * v, 'bandpass', 500, 1, 1600); }
  _erase(v) { this._noiseBurst(0.09, 0.04 * v, 'bandpass', 1600, 1, 600); }
  _torch(v) {
    this._noiseBurst(0.16, 0.07 * v, 'lowpass', 900, 0.7);
    this._noiseBurst(0.12, 0.025 * v, 'bandpass', 2600, 2);
  }
  _spray(v) { this._noiseBurst(0.14, 0.05 * v, 'highpass', 5000, 0.7); }
  _swish(v) { this._noiseBurst(0.2, 0.05 * v, 'bandpass', 500, 1.5, 1800); }

  _sizzle(v) { this._noiseBurst(0.35, 0.12 * v, 'highpass', 3000, 0.7); }
  _fry(v) { this._noiseBurst(0.3, 0.06 * v, 'highpass', 2800, 0.6); this._noiseBurst(0.04, 0.03 * v, 'bandpass', 4000, 3, null, 0.1); }
  _pour(v) { this._noiseBurst(0.2, 0.08 * v, 'bandpass', 900, 0.8); this._tone('sine', 260 + Math.random() * 120, 0.08, 0.03 * v, 160); }
  _pourSand(v) { this._noiseBurst(0.18, 0.06 * v, 'highpass', 2200, 0.7); }
  _pourMetal(v) {
    this._noiseBurst(0.22, 0.06 * v, 'lowpass', 420, 0.9);
    this._noiseBurst(0.18, 0.05 * v, 'highpass', 3500, 0.7, null, 0.04);
  }
  _splash(v) { this._noiseBurst(0.14, 0.08 * v, 'bandpass', 1200, 0.7); this._tone('sine', 420, 0.1, 0.05 * v, 150); }
  _bubble(v) { const f = 250 + Math.random() * 350; this._tone('sine', f, 0.06, 0.035 * v, f * 2); }
  _pop(v) { this._tone('square', 900 + Math.random() * 300, 0.035, 0.05 * v, 280); this._noiseBurst(0.03, 0.04 * v, 'highpass', 2000, 1); }
  _iceCrack(v) {
    for (let k = 0; k < 3; k++) this._tone('sine', 2600 + Math.random() * 1400, 0.04, 0.04 * v, null, k * 0.05 + Math.random() * 0.03);
  }
  _melt(v) { this._tone('sine', 95, 0.7, 0.06 * v, 60); this._noiseBurst(0.6, 0.03 * v, 'lowpass', 300, 0.7, null, 0, 0.2); }
  _fuse(v) { for (let k = 0; k < 3; k++) this._noiseBurst(0.03, 0.04 * v, 'bandpass', 3000 + Math.random() * 2000, 3, null, k * 0.03); }
  _fizz(v) { for (let k = 0; k < 4; k++) this._noiseBurst(0.035, 0.03 * v, 'highpass', 4500, 1, null, k * 0.035); }
  _shatter(v) {
    this._noiseBurst(0.3, 0.1 * v, 'highpass', 3000, 0.7);
    for (let k = 0; k < 4; k++) this._tone('sine', 2500 + Math.random() * 2500, 0.15, 0.03 * v, null, Math.random() * 0.12);
  }
  _crackle(v) { for (let k = 0; k < 3; k++) this._noiseBurst(0.04, 0.06 * v, 'bandpass', 1500 + Math.random() * 2000, 2, null, k * 0.06 + Math.random() * 0.06); }
  _hum(v) { this._tone('sawtooth', 60, 0.4, 0.03 * v); }
  _buzz(v) { this._tone('square', 880, 0.18, 0.05 * v); this._tone('square', 660, 0.18, 0.05 * v, null, 0.2); }
  _relay(v) { this._tone('square', 320, 0.02, 0.05 * v); this._noiseBurst(0.02, 0.03 * v, 'bandpass', 2500, 3); }
  _powerOn(v) { this._tone('sine', 220, 0.16, 0.05 * v, 880); this._relay(v); }
  _powerOff(v) { this._tone('sine', 880, 0.16, 0.045 * v, 220); this._relay(v); }
  _boom(v) { this._noiseBurst(0.9, 0.5 * v, 'lowpass', 1200, 0.7, 80); this._tone('sine', 70, 0.7, 0.4 * v, 30); }
  _whoosh(v) { this._noiseBurst(0.4, 0.1 * v, 'bandpass', 400, 1, 2000); }
  _craft(v) { this._seq([523, 659, 784, 1047], 'triangle', 0.07, 0.18, 0.1 * v); }
  _cast(v) {
    this._tone('sine', 880, 0.9, 0.12 * v);
    this._tone('sine', 1320, 0.7, 0.06 * v);
    this._tone('sine', 2210, 0.5, 0.03 * v);
    this._sizzle(0.6 * v);
  }

  // ------------------------------------------------------------------ ambience

  buildAmbience() {
    const c = this.ctx;
    const loopNoise = () => {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.start();
      return s;
    };
    const bed = (src, type, freq, q) => {
      const f = c.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.amb);
      return g;
    };
    this.bedFire = bed(loopNoise(), 'bandpass', 1300, 0.6);
    this.bedRoar = bed(loopNoise(), 'lowpass', 230, 0.8);
    this.bedWater = bed(loopNoise(), 'bandpass', 700, 0.5);
    const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 55; hum.start();
    const hum2 = c.createOscillator(); hum2.type = 'sine'; hum2.frequency.value = 110; hum2.start();
    const mix = c.createGain(); hum.connect(mix); hum2.connect(mix);
    this.bedHum = bed(mix, 'lowpass', 420, 0.7);
    this.bedRoom = bed(loopNoise(), 'lowpass', 140, 0.5);
  }

  /** Smoothly steer the ambience beds. Levels are 0..1. */
  setAmbience({ fire = 0, roar = 0, hum = 0, water = 0, boiling = 0 }) {
    if (!this.ctx || !this.bedFire) return;
    const t = this.ctx.currentTime;
    const set = (g, v) => g.gain.setTargetAtTime(v, t, 0.35);
    set(this.bedFire, fire * 0.12);
    set(this.bedRoar, roar * 0.3);
    set(this.bedHum, hum * 0.035);
    set(this.bedWater, water * 0.05);
    set(this.bedRoom, 0.025);
    if (fire > 0.05 && Math.random() < fire * 0.6) this.play('crackle', 0.3 + fire * 0.5);
    if (boiling > 0.02 && Math.random() < boiling * 2) this.play('bubble', 0.4 + boiling);
  }
}
