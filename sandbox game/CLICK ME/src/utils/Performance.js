// Lightweight frame / section timing used by the status bar and adaptive quality.

export class PerfMonitor {
  constructor() {
    this.fps = 60;
    this.frameMs = 16;
    this.sections = new Map();
    this._frames = 0;
    this._last = performance.now();
    this._starts = new Map();
  }

  frame(now) {
    this._frames++;
    const dt = now - this._last;
    if (dt >= 500) {
      this.fps = (this._frames * 1000) / dt;
      this.frameMs = dt / this._frames;
      this._frames = 0;
      this._last = now;
    }
  }

  begin(name) {
    this._starts.set(name, performance.now());
  }

  end(name) {
    const s = this._starts.get(name);
    if (s === undefined) return;
    const ms = performance.now() - s;
    const prev = this.sections.get(name) ?? ms;
    this.sections.set(name, prev * 0.9 + ms * 0.1);
  }

  get(name) {
    return this.sections.get(name) ?? 0;
  }
}
