// Smooth pan / zoom camera with exact screen <-> world conversion.
import { clamp } from '../utils/MathUtils.js';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0; this.zoom = 3;
    this.tx = 0; this.ty = 0; this.tzoom = 3;
    this.viewW = 800; this.viewH = 600; // device pixels
    this.minZoom = 0.5; this.maxZoom = 24;
    this.worldW = 100; this.worldH = 100;
  }

  setViewport(w, h) {
    this.viewW = w;
    this.viewH = h;
  }

  setWorldSize(w, h) {
    this.worldW = w;
    this.worldH = h;
    this.minZoom = Math.max(0.25, Math.min(this.viewW / w, this.viewH / h) * 0.6);
  }

  setView(x, y, zoom) {
    this.tx = this.x = x;
    this.ty = this.y = y;
    if (zoom) this.tzoom = this.zoom = clamp(zoom * (window.devicePixelRatio || 1), this.minZoom, this.maxZoom);
    this.clampTarget();
    this.x = this.tx; this.y = this.ty;
  }

  fitWorld(w, h) {
    this.setWorldSize(w, h);
    const z = Math.min(this.viewW / w, this.viewH / h);
    this.tzoom = this.zoom = clamp(z, this.minZoom, this.maxZoom);
    this.tx = this.x = w / 2;
    this.ty = this.y = h / 2;
  }

  update(dt) {
    const k = 1 - Math.pow(0.0001, dt * 1.6);
    // Zoom around the anchor point so the cursor stays fixed while easing.
    if (Math.abs(this.tzoom - this.zoom) > 1e-4) {
      const nz = this.zoom + (this.tzoom - this.zoom) * k;
      if (this.anchor) {
        const { sx, sy, wx, wy } = this.anchor;
        this.zoom = nz;
        this.x = wx - (sx - this.viewW / 2) / nz;
        this.y = wy - (sy - this.viewH / 2) / nz;
        this.tx = this.x; this.ty = this.y;
        this.clampTarget();
        this.x = this.tx; this.y = this.ty;
      } else this.zoom = nz;
    } else {
      this.zoom = this.tzoom;
      this.anchor = null;
    }
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
  }

  clampTarget() {
    const halfW = this.viewW / 2 / this.tzoom, halfH = this.viewH / 2 / this.tzoom;
    const mx = Math.max(halfW, this.worldW / 2 + 40), my = Math.max(halfH, this.worldH / 2 + 40);
    this.tx = clamp(this.tx, this.worldW / 2 - mx + halfW, this.worldW / 2 + mx - halfW);
    this.ty = clamp(this.ty, this.worldH / 2 - my + halfH, this.worldH / 2 + my - halfH);
  }

  screenToWorld(sx, sy) {
    return [(sx - this.viewW / 2) / this.zoom + this.x, (sy - this.viewH / 2) / this.zoom + this.y];
  }

  worldToScreen(wx, wy) {
    return [(wx - this.x) * this.zoom + this.viewW / 2, (wy - this.y) * this.zoom + this.viewH / 2];
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.tzoom = clamp(this.tzoom * factor, this.minZoom, this.maxZoom);
    this.anchor = { sx, sy, wx, wy };
  }

  panBy(dxScreen, dyScreen, immediate = true) {
    this.anchor = null;
    this.tzoom = this.zoom;
    this.tx -= dxScreen / this.zoom;
    this.ty -= dyScreen / this.zoom;
    this.clampTarget();
    if (immediate) { this.x = this.tx; this.y = this.ty; }
  }

  /** Canvas transform for world-space drawing. */
  applyTransform(ctx) {
    ctx.setTransform(this.zoom, 0, 0, this.zoom, this.viewW / 2 - this.x * this.zoom, this.viewH / 2 - this.y * this.zoom);
  }
}
