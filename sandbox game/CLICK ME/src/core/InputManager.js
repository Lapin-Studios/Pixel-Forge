// Normalises pointer / wheel / keyboard input into device-pixel canvas coordinates.
export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.sx = 0;
    this.sy = 0;
    this.inside = false;
    this.buttons = 0;
    this.keys = new Set();
    this.handlers = new Map();
    this.bind();
  }

  on(evt, fn) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, []);
    this.handlers.get(evt).push(fn);
  }

  emit(evt, data) {
    for (const fn of this.handlers.get(evt) || []) {
      try { fn(data); } catch (e) { console.error(`Input handler (${evt}) failed`, e); }
    }
  }

  toCanvas(e) {
    const r = this.canvas.getBoundingClientRect();
    return [
      (e.clientX - r.left) * (this.canvas.width / Math.max(1, r.width)),
      (e.clientY - r.top) * (this.canvas.height / Math.max(1, r.height)),
    ];
  }

  isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      [this.sx, this.sy] = this.toCanvas(e);
      this.buttons = e.buttons;
      this.emit('down', { button: e.button, sx: this.sx, sy: this.sy, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, pointerType: e.pointerType });
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      [this.sx, this.sy] = this.toCanvas(e);
      this.inside = true;
      this.buttons = e.buttons;
      this.emit('move', { sx: this.sx, sy: this.sy, buttons: e.buttons, shift: e.shiftKey });
    });
    const up = (e) => {
      [this.sx, this.sy] = this.toCanvas(e);
      this.buttons = e.buttons;
      this.emit('up', { button: e.button, sx: this.sx, sy: this.sy });
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { this.inside = false; this.emit('leave', {}); });
    c.addEventListener('pointerenter', () => { this.inside = true; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      [this.sx, this.sy] = this.toCanvas(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.emit('wheel', { delta, sx: this.sx, sy: this.sy, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e) && e.key !== 'Escape') return;
      this.keys.add(e.key.toLowerCase());
      this.emit('keydown', e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      this.emit('keyup', e);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons = 0; this.emit('blur', {}); });
  }

  isDown(key) {
    return this.keys.has(key);
  }
}
