// Powered conveyor belts move powders resting on them, and objects resting on them (see ObjectPhysics).
export function conveyorDir(world, i) {
  const l = world.life[i];
  return l < 0 ? -1 : 1;
}

export function updateConveyor(sim, i, x, y, m) {
  const world = sim.world, reg = sim.reg;
  if (!world.power[i]) return true;
  world.wake(i);
  if (y === 0 || (sim.tick + x) % 3 !== 0) return true;
  const dir = conveyorDir(world, i);
  const above = i - world.w;
  const ma = world.cells[above];
  if (ma === 0 || world.objMask[above] !== 0 || world.stamp[above] === sim.mark) return true;
  const s = reg.state[ma];
  if (s !== 2 && s !== 3) return true; // powders and liquids only
  const nx = x + dir;
  if (nx < 0 || nx >= world.w) return true;
  const target = above + dir;
  if (world.cells[target] === 0 && world.objMask[target] === 0) {
    world.swap(above, target);
    world.stamp[target] = sim.mark;
  }
  return true;
}
