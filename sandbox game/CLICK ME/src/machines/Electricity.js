// Power network: flood-fills from sources (batteries, sunlit solar panels, hot thermocouples)
// through conductors. Switches conduct when on; thermostats only below their setpoint; heat
// sensors only above it; pressure plates when something rests on them; liquid sensors when wet.
import { POWER, STATE } from '../materials/MaterialProperties.js';

const DX8 = [-1, 1, 0, 0, -1, 1, -1, 1];
const DY8 = [0, 0, -1, 1, -1, -1, 1, 1];

export class Electricity {
  constructor(sim) {
    this.sim = sim;
    this.visited = null;
    this.queue = null;
    this.hadPower = false;
    this.poweredCount = 0;
  }

  reset() {
    this.visited = null;
    this.queue = null;
    this.hadPower = false;
    this.poweredCount = 0;
  }

  update() {
    const world = this.sim.world, reg = this.sim.reg;
    const n = world.size, w = world.w, h = world.h;
    const { cells, life, temp, power } = world;
    const kind = reg.powerKind;
    if (!this.visited || this.visited.length !== n) {
      this.visited = new Uint8Array(n);
      this.queue = new Int32Array(n);
    }
    const vis = this.visited, q = this.queue;
    this.evaluateSensors();
    vis.fill(0);
    let qt = 0;
    let anyElectric = false;
    for (let i = 0; i < n; i++) {
      const k = kind[cells[i]];
      if (k === 0) continue;
      anyElectric = true;
      if (k === POWER.SOURCE || (k === POWER.THERMOCOUPLE && temp[i] > 150) || (k === POWER.SOLAR && this.seesSky(i))) {
        vis[i] = 1;
        q[qt++] = i;
      }
    }
    if (!anyElectric && !this.hadPower) return;

    let qh = 0;
    while (qh < qt) {
      const i = q[qh++];
      const y = (i / w) | 0;
      const x = i - y * w;
      // 8-way: wires that only touch at a corner (diagonal lines) still connect.
      for (let d = 0; d < 8; d++) {
        const dx = DX8[d], dy = DY8[d];
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = i + dx + dy * w;
        if (vis[j]) continue;
        const k = kind[cells[j]];
        if (k === 0) continue;
        if (k >= POWER.SWITCH && !this.gateOpen(j, k)) continue;
        vis[j] = 1;
        q[qt++] = j;
      }
    }
    // Circuit sounds: power up / power down / relay click when the live network changes.
    const prev = this.poweredCount || 0;
    if (qt !== prev) {
      const audio = this.sim.game?.audio;
      if (prev === 0 && qt > 0) audio?.play('powerOn', 0.6);
      else if (qt === 0 && prev > 0) audio?.play('powerOff', 0.6);
      else audio?.play('relay', 0.35);
    }
    this.poweredCount = qt;
    this.hadPower = qt > 0;
    for (let i = 0; i < n; i++) {
      if (power[i] !== vis[i]) {
        power[i] = vis[i];
        world.wake(i);
      }
    }
  }

  /**
   * A connected block of the same sensor acts as ONE sensor: if any of its cells is triggered
   * (pressed / wet / hot) the whole block conducts. So pressing one end of a long pressure plate
   * completes the circuit through all of it.
   */
  evaluateSensors() {
    const world = this.sim.world, reg = this.sim.reg;
    const n = world.size, w = world.w, h = world.h;
    const { cells } = world;
    const kind = reg.powerKind;
    if (!this.sensorOpen || this.sensorOpen.length !== n) {
      this.sensorOpen = new Uint8Array(n);
      this.sensorSeen = new Uint8Array(n);
      this.sensorStack = new Int32Array(n);
    }
    const open = this.sensorOpen, seen = this.sensorSeen, stack = this.sensorStack;
    seen.fill(0);
    for (let i = 0; i < n; i++) {
      const k = kind[cells[i]];
      if ((k !== POWER.PRESSURE && k !== POWER.LIQUIDSENSOR && k !== POWER.HEATSENSOR) || seen[i]) continue;
      const m = cells[i];
      // Collect the block.
      let sp = 0, top = 0, any = false;
      stack[top++] = i;
      seen[i] = 1;
      while (sp < top) {
        const j = stack[sp++];
        if (!any) {
          if (k === POWER.PRESSURE) any = this.isPressed(j);
          else if (k === POWER.LIQUIDSENSOR) any = this.isWet(j);
          else any = world.temp[j] >= world.life[j];
        }
        const y = (j / w) | 0, x = j - y * w;
        if (x > 0 && !seen[j - 1] && cells[j - 1] === m) { seen[j - 1] = 1; stack[top++] = j - 1; }
        if (x < w - 1 && !seen[j + 1] && cells[j + 1] === m) { seen[j + 1] = 1; stack[top++] = j + 1; }
        if (y > 0 && !seen[j - w] && cells[j - w] === m) { seen[j - w] = 1; stack[top++] = j - w; }
        if (y < h - 1 && !seen[j + w] && cells[j + w] === m) { seen[j + w] = 1; stack[top++] = j + w; }
      }
      const v = any ? 1 : 0;
      for (let s = 0; s < top; s++) open[stack[s]] = v;
    }
  }

  /** Does a conditional component currently let power through? */
  gateOpen(j, k) {
    const world = this.sim.world;
    switch (k) {
      case POWER.SWITCH: return world.life[j] === 1;
      case POWER.THERMOSTAT: return world.temp[j] < world.life[j];
      case POWER.HEATSENSOR:
      case POWER.PRESSURE:
      case POWER.LIQUIDSENSOR: return this.sensorOpen[j] === 1;
      case POWER.THERMOCOUPLE: case POWER.SOLAR: return true; // they also conduct
      default: return true;
    }
  }

  isPressed(j) {
    const world = this.sim.world;
    const w = world.w;
    if (j < w) return false;
    const a = j - w;
    if (world.objMask[a] !== 0) return true;
    const m = world.cells[a];
    if (m === 0 || m === world.cells[j]) return false;
    const s = this.sim.reg.state[m];
    return s === STATE.SOLID || s === STATE.POWDER || s === STATE.LIQUID;
  }

  isWet(j) {
    const world = this.sim.world, reg = this.sim.reg;
    const w = world.w, h = world.h;
    const y = (j / w) | 0, x = j - y * w;
    const check = (i) => {
      const m = world.cells[i];
      if (m !== 0 && reg.state[m] === STATE.LIQUID) return true;
      const om = world.objMask[i];
      if (om < 0) {
        const o = this.sim.game.objects.byId.get(-om);
        const cm = o ? o.mat[world.objLocal[i]] : 0;
        return cm !== 0 && reg.state[cm] === STATE.LIQUID;
      }
      return false;
    };
    return (x > 0 && check(j - 1)) || (x < w - 1 && check(j + 1)) || (y > 0 && check(j - w)) || (y < h - 1 && check(j + w));
  }

  /** Solar panels need a clear column of air/gas above them. */
  seesSky(i) {
    const world = this.sim.world, reg = this.sim.reg;
    const w = world.w;
    for (let j = i - w; j >= 0; j -= w) {
      if (world.objMask[j] > 0) return false;
      const m = world.cells[j];
      if (m !== 0 && reg.state[m] < STATE.GAS) {
        const glassLike = reg.render[m] === 11; // light passes through glass
        if (!glassLike) return false;
      }
    }
    return true;
  }

  /** Is any world cell next to (wx, wy) (incl. diagonals) powered? Used by machine objects' terminals. */
  poweredNear(wx, wy) {
    const world = this.sim.world;
    if (!world) return false;
    const w = world.w, h = world.h;
    for (let d = -1; d < 8; d++) {
      const x = wx + (d < 0 ? 0 : DX8[d]), y = wy + (d < 0 ? 0 : DY8[d]);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (world.power[y * w + x]) return true;
    }
    return false;
  }
}
