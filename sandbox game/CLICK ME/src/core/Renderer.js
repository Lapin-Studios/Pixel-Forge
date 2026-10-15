// Canvas2D renderer. The simulation is drawn into a world-sized ImageData (1 pixel per cell),
// then scaled by the camera with smoothing disabled for crisp pixels. Hot cells also write into
// a glow buffer that is down-sampled and added back for bloom.
import {
  BB_R, BB_G, BB_B, BB_I, bbIndex, HEAT_LUT, heatIndex, RENDER, STATE, POWER,
} from '../materials/MaterialProperties.js';
import { MASK } from '../objects/WorldObject.js';
import { packRGBA, hash2, formatTemp } from '../utils/MathUtils.js';
import { FAN_DIRS } from '../machines/Fan.js';

const SWITCH_ON = packRGBA(60, 220, 95);
const SWITCH_OFF = packRGBA(210, 70, 70);
const LAMP_ON = packRGBA(255, 244, 196);
const WIRE_ON = packRGBA(255, 214, 120);
const INTERIOR = packRGBA(24, 20, 19, 235);

export class Renderer {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.worldCanvas = document.createElement('canvas');
    this.wctx = this.worldCanvas.getContext('2d');
    this.glowCanvas = document.createElement('canvas');
    this.gctx = this.glowCanvas.getContext('2d');
    this.glowSmall = document.createElement('canvas');
    this.gsctx = this.glowSmall.getContext('2d');
    this.glowTiny = document.createElement('canvas');
    this.gtctx = this.glowTiny.getContext('2d');
    this.backdrop = document.createElement('canvas');
    this.heatView = false;
    this.powerView = false;
    this.time = 0;
    this.dpr = window.devicePixelRatio || 1;
    this.anyGlow = false;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.game.camera.setViewport(w, h);
    if (this.game.world) this.game.camera.setWorldSize(this.game.world.w, this.game.world.h);
  }

  setWorld(world) {
    const W = world.w, H = world.h;
    this.worldCanvas.width = W; this.worldCanvas.height = H;
    this.image = this.wctx.createImageData(W, H);
    this.buf32 = new Uint32Array(this.image.data.buffer);
    this.glowCanvas.width = W; this.glowCanvas.height = H;
    this.glowImage = this.gctx.createImageData(W, H);
    this.glow32 = new Uint32Array(this.glowImage.data.buffer);
    this.glowSmall.width = Math.max(1, Math.ceil(W / 2)); this.glowSmall.height = Math.max(1, Math.ceil(H / 2));
    this.glowTiny.width = Math.max(1, Math.ceil(W / 6)); this.glowTiny.height = Math.max(1, Math.ceil(H / 6));
    this.buildBackdrop(W, H);
  }

  buildBackdrop(W, H) {
    const c = this.backdrop;
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const d = new Uint32Array(img.data.buffer);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        // Large, dim workshop bricks behind the playfield.
        const bw = 24, bh = 10;
        const row = Math.floor(y / bh);
        const off = (row & 1) * (bw / 2);
        const mortar = y % bh === 0 || (x + off) % bw === 0;
        const n = hash2(Math.floor((x + off) / bw), row, 99) * 6 + hash2(x, y, 5) * 4;
        let r = 26 + n + v * 6, gg = 22 + n * 0.8 + v * 4, b = 26 + n * 0.7;
        if (mortar) { r *= 0.72; gg *= 0.72; b *= 0.75; }
        d[y * W + x] = packRGBA(r, gg, b, 255);
      }
    }
    g.putImageData(img, 0, 0);
    // vignette & warm floor light
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(60,30,10,0.18)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }

  render(dt) {
    const game = this.game;
    const world = game.world;
    if (!world || !this.buf32) return;
    this.time += dt;
    const settings = game.settings;
    const ctx = this.ctx;
    const cam = game.camera;

    this.renderCells(settings.get('heatHaze'));
    this.renderObjects();
    this.wctx.putImageData(this.image, 0, 0);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#09080b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    cam.applyTransform(ctx);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.backdrop, 0, 0);
    ctx.drawImage(this.worldCanvas, 0, 0);

    if (settings.get('glow') && this.anyGlow && !this.heatView) {
      this.gctx.putImageData(this.glowImage, 0, 0);
      this.gsctx.imageSmoothingEnabled = true;
      this.gsctx.clearRect(0, 0, this.glowSmall.width, this.glowSmall.height);
      this.gsctx.drawImage(this.glowCanvas, 0, 0, this.glowSmall.width, this.glowSmall.height);
      this.gtctx.imageSmoothingEnabled = true;
      this.gtctx.clearRect(0, 0, this.glowTiny.width, this.glowTiny.height);
      this.gtctx.drawImage(this.glowSmall, 0, 0, this.glowTiny.width, this.glowTiny.height);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      const pulse = 0.92 + Math.sin(this.time * 2.1) * 0.04;
      ctx.globalAlpha = 0.38 * pulse;
      ctx.drawImage(this.glowSmall, 0, 0, world.w, world.h);
      ctx.globalAlpha = 0.42 * pulse;
      ctx.drawImage(this.glowTiny, -1, -1, world.w + 2, world.h + 2);
      ctx.restore();
      ctx.imageSmoothingEnabled = false;
    }

    this.drawRagdolls(ctx);
    game.objects.ropes.draw(ctx, 1 / cam.zoom);
    if (settings.get('particles')) game.particles.draw(ctx);

    // World border
    ctx.strokeStyle = 'rgba(255,170,90,0.25)';
    ctx.lineWidth = 1 / cam.zoom;
    ctx.strokeRect(0, 0, world.w, world.h);

    this.drawOverlays(ctx);
  }

  renderCells(heatTint) {
    const game = this.game, world = game.world, reg = game.registry;
    const { w: W, h: H, cells, temp, shade, life, power, pipe, burn } = world;
    const buf = this.buf32, glow = this.glow32;
    const palette = reg.palette, tex = reg.tex, useTex = reg.useTex;
    const glowable = reg.glow, render = reg.render;
    const heatView = this.heatView;
    const tick = game.sim.tick;
    const time = this.time;
    glow.fill(0);
    let anyGlow = false;

    for (let y = 0; y < H; y++) {
      const row = y * W;
      const ty = (y & 31) << 5;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const m = cells[i];
        const t = temp[i];
        if (heatView) {
          const c = HEAT_LUT[heatIndex(t)];
          buf[i] = m === 0 ? ((c & 0x00ffffff) | ((t > 45 || t < 0 ? 150 : 40) << 24)) >>> 0 : c;
          continue;
        }
        if (m === 0) {
          if (heatTint && t > 200) {
            const a = t > 1400 ? 50 : ((t - 200) * 0.042) | 0;
            buf[i] = packRGBA(255, 120 + Math.min(100, t / 20), 40, a);
          } else buf[i] = 0;
          continue;
        }
        let c = useTex[m] ? tex[m][ty | (x & 31)] : palette[m][shade[i] & 15];
        const rm = render[m];
        let r, g, b, a;
        if (rm !== 0) {
          switch (rm) {
            case RENDER.FIRE: {
              const l = life[i];
              const f = hash2(i, tick >> 1, 3);
              const heat = Math.min(1, l / 40) * 0.7 + f * 0.3;
              if (m === reg.FIRE) c = packRGBA(255, 70 + heat * 170, 10 + heat * 60, 200 + f * 55);
              else if (reg.burnTemp[m] > 3000) c = packRGBA(220 + f * 35, 110 + heat * 120, 255, 230);
              else c = packRGBA(255, 230 + f * 25, 160 + heat * 90, 230);
              glow[i] = c | 0xff000000;
              anyGlow = true;
              buf[i] = c;
              continue;
            }
            case RENDER.MOLTEN: {
              const wave = Math.sin(time * 2.4 + x * 0.42 + y * 0.31 + (shade[i] & 7)) * 0.1 + Math.sin(time * 1.3 - x * 0.2) * 0.05;
              const k = 1 + wave;
              c = packRGBA((c & 255) * k, ((c >>> 8) & 255) * k, ((c >>> 16) & 255) * k, 255);
              break;
            }
            case RENDER.WATER:
            case RENDER.CRYO: {
              const s = Math.sin(time * 3 + x * 0.55 + y * 0.35) * 0.07;
              const k = 1 + s;
              c = packRGBA((c & 255) * k, ((c >>> 8) & 255) * k, ((c >>> 16) & 255) * (k + 0.02), c >>> 24);
              break;
            }
            case RENDER.WIRE:
              if (power[i]) c = ((tick + x + y) & 7) === 0 ? 0xffffffff : WIRE_ON;
              break;
            case RENDER.SWITCH: {
              const edge = ((x + y) & 1) === 0;
              c = life[i] === 1 ? SWITCH_ON : SWITCH_OFF;
              if (edge) c = packRGBA((c & 255) * 0.8, ((c >>> 8) & 255) * 0.8, ((c >>> 16) & 255) * 0.8, 255);
              break;
            }
            case RENDER.LAMP:
              if (power[i]) { c = LAMP_ON; glow[i] = packRGBA(255, 220, 140, 255); anyGlow = true; buf[i] = c; continue; }
              break;
            case RENDER.LED: {
              if (power[i]) {
                c = reg.accentColor[m];
                const g2 = ((c & 255) * 0.85) | 0, gg2 = (((c >>> 8) & 255) * 0.85) | 0, gb2 = (((c >>> 16) & 255) * 0.85) | 0;
                glow[i] = packRGBA(g2, gg2, gb2, 255);
                anyGlow = true;
                buf[i] = c;
                continue;
              }
              break;
            }
            case RENDER.PLATE: {
              const top = y === 0 || cells[i - W] !== m;
              if (power[i]) c = top ? packRGBA(120, 230, 140, 255) : packRGBA(70, 150, 90, 255);
              else if (top) c = packRGBA(150, 156, 166, 255);
              break;
            }
            case RENDER.CONVEYOR: {
              const dir = life[i] < 0 ? -1 : 1;
              const phase = (x - dir * (power[i] ? tick >> 2 : 0)) & 3;
              const k = phase < 2 ? 1.25 : 0.8;
              c = packRGBA((c & 255) * k, ((c >>> 8) & 255) * k, ((c >>> 16) & 255) * k, 255);
              break;
            }
            case RENDER.PIPE: {
              const pm = pipe[i];
              if (pm) {
                c = palette[pm][(i + (tick >> 3)) & 15];
                c = packRGBA((c & 255) * 0.85 + 20, ((c >>> 8) & 255) * 0.85 + 20, ((c >>> 16) & 255) * 0.85 + 20, 255);
              } else if (((x * 7 + y * 3) & 3) === 0) c = packRGBA(110, 116, 124, 255);
              break;
            }
            case RENDER.FAN: {
              const [dx, dy] = FAN_DIRS[((life[i] % 4) + 4) % 4];
              const spin = power[i] ? (tick >> 1) : 0;
              const k = ((x * (dy !== 0 ? 1 : 0) + y * (dx !== 0 ? 1 : 0) + spin) & 1) ? 1.35 : 0.85;
              c = packRGBA((c & 255) * k, ((c >>> 8) & 255) * k, ((c >>> 16) & 255) * k, 255);
              break;
            }
            default: break;
          }
        }
        if (m === reg.STOVE) {
          // Burner rings: dark grey when off, glowing red-orange when powered.
          const ring = ((x * 3 + y * 5) % 4) === 0 || ((x + y) & 3) === 1;
          if (power[i]) {
            const f = 0.8 + 0.2 * Math.sin(time * 4 + x);
            c = ring ? packRGBA(255 * f, 110 * f, 30, 255) : packRGBA(150, 40, 22, 255);
            glow[i] = packRGBA(200, 70, 20, 255);
            anyGlow = true;
          } else c = ring ? packRGBA(70, 70, 76, 255) : packRGBA(40, 40, 46, 255);
        } else if (m === reg.HEAT_LIMITER) {
          if (power[i] && ((x + y + (tick >> 3)) & 3) === 0) { c = packRGBA(110, 225, 255, 255); glow[i] = packRGBA(40, 110, 150, 255); anyGlow = true; }
        } else if (m === reg.SPOUT) {
          // Nozzle shows a dot of the material it pours.
          const src = life[i];
          if (src > 0 && src < palette.length && palette[src] && ((x + y) & 1) === 0) c = palette[src][(x * 5 + y) & 15] | 0xff000000;
        }
        if (power[i] !== 0 && reg.behavior[m] === 19 && ((tick >> 2) + x + y) & 1) {
          c = reg.accentColor[m]; // buzzer vibrating
        }
        if (burn[i] !== 0) {
          const f = hash2(i, tick >> 2, 9);
          c = packRGBA(255, 90 + f * 120, 20 + f * 30, 255);
          glow[i] = packRGBA(255, 120, 30, 255);
          anyGlow = true;
          buf[i] = c;
          continue;
        }
        if (glowable[m] && t > 430) {
          const k = bbIndex(t);
          const f = BB_I[k];
          if (f > 0) {
            r = c & 255; g = (c >>> 8) & 255; b = (c >>> 16) & 255; a = c >>> 24;
            const molten = rm === RENDER.MOLTEN;
            const ff = molten ? Math.min(1, f * 1.1) : f * 0.72;
            r += (BB_R[k] - r) * ff; g += (BB_G[k] - g) * ff; b += (BB_B[k] - b) * ff;
            c = packRGBA(r, g, b, Math.max(a, 200 + ff * 55));
            const gf = molten ? f : f * 0.45;
            glow[i] = packRGBA(BB_R[k] * gf, BB_G[k] * gf, BB_B[k] * gf, 255);
            anyGlow = true;
          }
        }
        buf[i] = c;
      }
    }
    this.anyGlow = anyGlow;
    if (this.powerView && !heatView) this.renderPowerView();
  }

  /** Power view: dims everything that isn't electrical and colours the wiring by state. */
  renderPowerView() {
    const game = this.game, world = game.world, reg = game.registry;
    const { cells, power, size } = world;
    const buf = this.buf32, glow = this.glow32, kind = reg.powerKind;
    const pulse = 0.8 + Math.sin(this.time * 7) * 0.2;
    const live = packRGBA(255, 200 + 40 * pulse, 70 * pulse, 255);
    const LIVE_GLOW = packRGBA(110, 90, 20, 255);
    const SRC = packRGBA(255, 255, 220, 255);
    const GATE_ON = packRGBA(90, 235, 120, 255);
    const GATE_OFF = packRGBA(240, 70, 60, 255);
    const DEAD = packRGBA(130, 46, 46, 255);
    for (let i = 0; i < size; i++) {
      const m = cells[i];
      if (m === 0) continue;
      const k = kind[m];
      if (k === 0) {
        const c = buf[i];
        buf[i] = packRGBA((c & 255) * 0.3, ((c >>> 8) & 255) * 0.3, ((c >>> 16) & 255) * 0.3, c >>> 24);
        glow[i] = 0;
        continue;
      }
      let c;
      if (power[i]) {
        c = k === POWER.SOURCE || k === POWER.SOLAR || k === POWER.THERMOCOUPLE ? SRC : k >= POWER.SWITCH ? GATE_ON : live;
        glow[i] = LIVE_GLOW;
        this.anyGlow = true;
      } else c = k >= POWER.SWITCH ? GATE_OFF : DEAD;
      buf[i] = c;
    }
  }

  renderObjects() {
    const game = this.game, world = game.world, reg = game.registry;
    const buf = this.buf32, glow = this.glow32;
    const W = world.w, H = world.h;
    const list = game.objects.list;
    const heatView = this.heatView;
    const time = this.time;
    // Draw non-held objects first, held object last (on top).
    for (let pass = 0; pass < 2; pass++) {
      for (const o of list) {
        if (o.dead || (pass === 0) === o.held) continue;
        const fp = o.getFootprint();
        const edges = o.getEdges();
        const ox = o.ox, oy = o.oy;
        const ow = o.w;
        for (let k = 0; k < fp.count; k++) {
          const wx = ox + fp.offs[2 * k], wy = oy + fp.offs[2 * k + 1];
          if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
          const i = wy * W + wx;
          const li = fp.loc[k];
          const kind = fp.kinds[k];
          const m = o.mat[li];
          const t = o.temp[li];
          if (heatView) { buf[i] = kind === MASK.WALL || m ? HEAT_LUT[heatIndex(t)] : INTERIOR; continue; }
          let c;
          if (kind === MASK.WALL) {
            const lx = li % ow, ly = (li / ow) | 0;
            c = reg.useTex[m] ? reg.tex[m][((ly & 31) << 5) | (lx & 31)] : reg.palette[m][(lx * 7 + ly * 13) & 15];
            const e = edges[li];
            if (e) {
              const kk = e & 1 ? 1.22 : 0.68;
              c = packRGBA(Math.min(255, (c & 255) * kk), Math.min(255, ((c >>> 8) & 255) * kk), Math.min(255, ((c >>> 16) & 255) * kk), 255);
            } else c = (c | 0xff000000) >>> 0;
          } else if (m) {
            c = reg.palette[m][(li * 7 + o.id * 5) & 15];
            if (reg.render[m] === RENDER.MOLTEN) {
              const wave = 1 + Math.sin(time * 2.4 + wx * 0.42 + wy * 0.31 + (li & 7)) * 0.1;
              c = packRGBA((c & 255) * wave, ((c >>> 8) & 255) * wave, ((c >>> 16) & 255) * wave, 255);
            }
            if (reg.state[m] === STATE.GAS) c = packRGBA(c & 255, (c >>> 8) & 255, (c >>> 16) & 255, 200);
          } else {
            c = INTERIOR;
          }
          if ((kind === MASK.WALL || m) && reg.glow[m] && t > 430) {
            const bk = bbIndex(t);
            const f = BB_I[bk];
            if (f > 0) {
              let r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
              const molten = reg.render[m] === RENDER.MOLTEN;
              // Walls keep some of their own colour and edge shading so the shape stays readable.
              const ff = molten ? Math.min(1, f * 1.1) : f * (kind === MASK.WALL ? 0.6 : 0.75);
              r += (BB_R[bk] - r) * ff; g += (BB_G[bk] - g) * ff; b += (BB_B[bk] - b) * ff;
              c = packRGBA(r, g, b, 255);
              const gf = molten ? f : f * 0.35;
              glow[i] = packRGBA(BB_R[bk] * gf, BB_G[bk] * gf, BB_B[bk] * gf, 255);
              this.anyGlow = true;
            }
          }
          buf[i] = c;
        }
      }
    }
    // Burning ragdolls light up the bloom.
    for (const d of game.objects.dolls) {
      if (d.onFire <= 0) continue;
      for (let k = 0; k < d.x.length; k++) {
        const x = Math.floor(d.x[k]), y = Math.floor(d.y[k]);
        if (x >= 0 && y >= 0 && x < W && y < H) { glow[y * W + x] = packRGBA(220, 110, 30, 255); this.anyGlow = true; }
      }
    }
  }

  /** Ragdolls are drawn as their own high-resolution sprites on top of the world (carried one last). */
  drawRagdolls(ctx) {
    const game = this.game;
    const opts = { tick: game.sim.tick, heatView: this.heatView };
    const held = game.tools.heldDoll;
    for (const d of game.objects.dolls) {
      if (d === held) continue;
      const s = d.renderSprite(opts);
      if (s) ctx.drawImage(s.canvas, s.x, s.y, s.w, s.h);
    }
    if (held) {
      const s = held.renderSprite(opts);
      if (s) ctx.drawImage(s.canvas, s.x, s.y, s.w, s.h);
    }
  }

  drawOverlays(ctx) {
    const game = this.game;
    const cam = game.camera;
    const tools = game.tools;
    const lw = 1 / cam.zoom;
    const hover = tools.hover;

    // Highlight hovered / selected / held objects.
    const outline = (o, color, dash) => {
      const b = o.bounds();
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * lw;
      if (dash) ctx.setLineDash([3 * lw, 2 * lw]);
      ctx.strokeRect(b.x0 - 1, b.y0 - 1, b.x1 - b.x0 + 3, b.y1 - b.y0 + 3);
      ctx.restore();
    };
    if (tools.held) outline(tools.held, 'rgba(255,170,80,0.9)', false);
    else if (hover.obj) outline(hover.obj, 'rgba(255,220,160,0.55)', true);
    const sel = tools.selected;
    if (sel && sel.type === 'object' && sel.obj !== tools.held && !sel.obj.dead) outline(sel.obj, 'rgba(120,190,255,0.8)', true);
    if (hover.doll && !tools.heldDoll && hover.doll.doll !== sel?.obj) outline(hover.doll.doll, 'rgba(255,220,160,0.55)', true);
    if (tools.heldDoll) {
      // A taut line from the hand to the body part being dragged.
      const d = tools.heldDoll, k = d.grab;
      if (k >= 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,190,110,0.85)';
        ctx.lineWidth = 1.2 * lw;
        ctx.beginPath();
        ctx.moveTo(hover.wx, hover.wy);
        ctx.lineTo(d.x[k], d.y[k]);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,190,110,0.95)';
        ctx.beginPath();
        ctx.arc(d.x[k], d.y[k], 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    if (sel && sel.type === 'cell') {
      ctx.strokeStyle = 'rgba(120,190,255,0.9)';
      ctx.lineWidth = lw * 1.5;
      ctx.strokeRect(sel.x - 0.5, sel.y - 0.5, 2, 2);
    }

    // Brush cursor
    if (hover.inside && !tools.held && !tools.heldDoll && tools.showsBrush()) {
      const r = tools.brushSize;
      const cx = Math.floor(hover.wx) + 0.5, cy = Math.floor(hover.wy) + 0.5;
      ctx.strokeStyle = tools.tool === 'erase' ? 'rgba(255,90,90,0.8)' : tools.tool === 'heat' ? 'rgba(255,140,40,0.9)' : tools.tool === 'cool' ? 'rgba(120,200,255,0.9)' : tools.tool === 'mix' ? 'rgba(200,140,255,0.9)' : 'rgba(255,255,255,0.7)';
      if (tools.tool === 'mix') ctx.setLineDash([2 * lw, 2 * lw]);
      ctx.lineWidth = lw * 1.2;
      ctx.beginPath();
      if (tools.brushShape === 'square' || r === 0) ctx.rect(cx - r - 0.5, cy - r - 0.5, r * 2 + 1, r * 2 + 1);
      else ctx.arc(cx, cy, r + 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Heat Limiter range while hovering one
    if (hover.inside && game.world.cells[hover.y * game.world.w + hover.x] === game.registry.HEAT_LIMITER) {
      ctx.save();
      ctx.strokeStyle = 'rgba(95,208,255,0.7)';
      ctx.setLineDash([2 * lw, 2 * lw]);
      ctx.lineWidth = lw * 1.2;
      ctx.strokeRect(hover.x - 12, hover.y - 12, 25, 25);
      ctx.restore();
    }
    // Line tool preview
    if (tools.lineStart && hover.inside) {
      const s = tools.lineStart;
      ctx.save();
      ctx.strokeStyle = s.erase ? 'rgba(255,90,90,0.55)' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = tools.brushSize * 2 + 1;
      ctx.lineCap = tools.brushShape === 'square' ? 'square' : 'round';
      ctx.beginPath();
      ctx.moveTo(s.x + 0.5, s.y + 0.5);
      ctx.lineTo(hover.x + 0.5, hover.y + 0.5);
      ctx.stroke();
      ctx.restore();
    }
    // Rope tool preview
    if (tools.ropeStart && hover.inside) {
      const s = tools.ropeStart;
      ctx.save();
      ctx.strokeStyle = 'rgba(200,160,100,0.85)';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([1.5, 1]);
      ctx.beginPath();
      ctx.moveTo(s.wx, s.wy);
      ctx.lineTo(hover.wx, hover.wy);
      ctx.stroke();
      ctx.restore();
    }
    if (tools.tool === 'spawn' && tools.spawnGhost && hover.inside) {
      const g = tools.spawnGhost;
      ctx.fillStyle = 'rgba(255,200,120,0.18)';
      ctx.strokeStyle = 'rgba(255,200,120,0.7)';
      ctx.lineWidth = lw;
      ctx.fillRect(hover.wx - g.w / 2, hover.wy - g.h / 2, g.w, g.h);
      ctx.strokeRect(hover.wx - g.w / 2, hover.wy - g.h / 2, g.w, g.h);
    }

    // Screen-space labels
    if (!game.settings.get('showLabels')) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = this.dpr;
    ctx.font = `${Math.round(11 * dpr)}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const unit = game.settings.get('tempUnit');
    const canvas = this.canvas;
    for (const o of game.objects.list) {
      let text = null, color = '#ffd9a8';
      if (o.type === 'thermometer') { text = formatTemp(o.reading, unit); color = '#9fe3ff'; }
      else if (o.labelText) {
        text = o.labelText(unit);
        color = o.on ? (o.fridge ? '#9fe3ff' : '#ffb070') : '#9a9088';
      }
      else if (o.type === 'furnace' || o.type === 'electric_furnace') {
        text = `${o.burning ? '🔥 ' : ''}${formatTemp(o.chamberTemp, unit)}${o.electric && !o.powered ? ' · no power' : ''}${!o.electric && o.fuel <= 0 ? ' · no fuel' : ''}`;
        color = o.burning ? '#ffb070' : '#9a9088';
      } else if (o.castShape && (o.held || o === hover.obj || o.fillCount() > 0)) {
        text = o.statusText();
        color = text.startsWith('Solid — ready') ? '#a6f08a' : '#ffd9a8';
      } else if (o.isContainer && (o.held || o === hover.obj) && o.capacity) {
        const f = o.fillCount();
        text = f ? `${Math.round((f / o.capacity) * 100)}% · ${formatTemp(o.avgTemp('content'), unit)}` : 'empty';
      } else if (o.isItem && (o.held || o === hover.obj)) {
        text = `${o.name} · ${formatTemp(o.avgTemp('wall'), unit)}`;
      }
      if (!text) continue;
      drawLabel(o, text, color);
    }
    // Ragdoll health tags (hovered / carried / selected / hurt).
    for (const d of game.objects.dolls) {
      const show = d === tools.heldDoll || d === hover.doll?.doll || d === sel?.obj || d.hurt > 0 || !d.alive || d.onFire > 0;
      if (!show) continue;
      const text = d.alive ? `${d.status()} · ❤ ${Math.round(d.health)}%` : '💀 Dead';
      drawLabel(d, text, !d.alive ? '#9a9088' : d.health > 50 ? '#a6f08a' : d.health > 20 ? '#ffcc4d' : '#ff7a6a');
    }
    function drawLabel(o, text, color) {
      const b = o.bounds();
      const [sx, sy] = cam.worldToScreen((b.x0 + b.x1 + 1) / 2, b.y0 - 1);
      if (sx < -100 || sy < -20 || sx > canvas.width + 100 || sy > canvas.height + 40) return;
      const tw = ctx.measureText(text).width + 10 * dpr;
      ctx.fillStyle = 'rgba(14,12,16,0.78)';
      ctx.fillRect(sx - tw / 2, sy - 17 * dpr, tw, 15 * dpr);
      ctx.fillStyle = color;
      ctx.fillText(text, sx, sy - 4 * dpr);
    }
  }
}
