// Samples what is on screen a few times a second and drives the ambience beds:
// fire crackle, furnace roar, machine hum, flowing water and boiling bubbles.
import { STATE, BEHAVIOR, RENDER } from '../materials/MaterialProperties.js';
import { CHUNK_SHIFT } from '../core/World.js';

const MOTORS = new Set([BEHAVIOR.FAN, BEHAVIOR.CONVEYOR, BEHAVIOR.PUMP, BEHAVIOR.HEATER, BEHAVIOR.COOLER]);

export class Soundscape {
  constructor(game) {
    this.game = game;
    this.timer = 0;
  }

  update(dt) {
    this.timer += dt;
    if (this.timer < 0.25) return;
    this.timer = 0;
    const g = this.game, audio = g.audio, world = g.world, reg = g.registry;
    if (!audio?.ctx || !world) return;
    if (!g.running) { audio.setAmbience({}); return; }

    const cam = g.camera;
    const halfW = cam.viewW / 2 / cam.zoom, halfH = cam.viewH / 2 / cam.zoom;
    const x0 = Math.max(0, Math.floor(cam.x - halfW)), x1 = Math.min(world.w - 1, Math.ceil(cam.x + halfW));
    const y0 = Math.max(0, Math.floor(cam.y - halfH)), y1 = Math.min(world.h - 1, Math.ceil(cam.y + halfH));
    const area = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
    const stride = Math.max(1, Math.ceil(Math.sqrt(area / 12000)));
    const { cells, temp, burn, power, active, cw } = world;
    const W = world.w;
    let fire = 0, lava = 0, motors = 0, flowing = 0, boiling = 0;
    for (let y = y0; y <= y1; y += stride) {
      const row = y * W;
      const crow = (y >> CHUNK_SHIFT) * cw;
      for (let x = x0; x <= x1; x += stride) {
        const i = row + x;
        const m = cells[i];
        if (m === 0) continue;
        const s = reg.state[m];
        if (s === STATE.FIRE || burn[i]) fire++;
        else if (s === STATE.LIQUID) {
          if (reg.render[m] === RENDER.MOLTEN && temp[i] > 700) lava++;
          if (active[crow + (x >> CHUNK_SHIFT)]) flowing++;
          const ht = reg.hotT[m];
          if (ht < 400 && temp[i] >= ht - 2) boiling++;
        } else if (power[i] && MOTORS.has(reg.behavior[m])) motors++;
      }
    }
    const k = stride * stride;
    let roar = 0, hum = 0;
    for (const o of g.objects.list) {
      const b = o.bounds();
      if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) continue;
      if ((o.type === 'furnace' || o.type === 'fuel_heater') && o.burning) roar += 0.45;
      if (o.type === 'electric_furnace' && o.burning) hum += 0.5;
      if ((o.type === 'oven' || o.type === 'fridge' || o.type === 'hot_plate' || o.type === 'cooling_station') && o.on) hum += 0.25;
    }
    audio.setAmbience({
      fire: Math.min(1, (fire * k) / 250),
      roar: Math.min(1, roar + (lava * k) / 1500),
      hum: Math.min(1, hum + (motors * k) / 120),
      water: Math.min(1, (flowing * k) / 900),
      boiling: Math.min(0.5, (boiling * k) / 400),
    });
  }
}
