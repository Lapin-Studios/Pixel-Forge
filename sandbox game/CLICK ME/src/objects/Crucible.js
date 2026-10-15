// Crucibles, the pouring ladle and the bucket: tiltable containers with physical contents.
import { Container } from './Container.js';
import { parseShape, MASK } from './WorldObject.js';

const SHAPES = {
  crucible: {
    rows: [
      '##oooooooooo##',
      '##oooooooooo##',
      '##oooooooooo##',
      '##oooooooooo##',
      '.##oooooooo##.',
      '.##oooooooo##.',
      '.##oooooooo##.',
      '.##oooooooo##.',
      '.##oooooooo##.',
      '..##oooooo##..',
      '..##oooooo##..',
      '..##oooooo##..',
      '...########...',
      '....######....',
    ],
    wall: 'graphite',
  },
  crucible_large: {
    rows: [
      '##oooooooooooooo##',
      '##oooooooooooooo##',
      '##oooooooooooooo##',
      '##oooooooooooooo##',
      '##oooooooooooooo##',
      '.##oooooooooooo##.',
      '.##oooooooooooo##.',
      '.##oooooooooooo##.',
      '.##oooooooooooo##.',
      '.##oooooooooooo##.',
      '.##oooooooooooo##.',
      '..##oooooooooo##..',
      '..##oooooooooo##..',
      '..##oooooooooo##..',
      '...##oooooooo##...',
      '...############...',
      '....##########....',
    ],
    wall: 'graphite',
  },
  ladle: {
    rows: [
      '#oooooooo#..............',
      '#oooooooo#..............',
      '#oooooooo###############',
      '##oooooo################',
      '.##oooo##...............',
      '..######................',
    ],
    wall: 'steel',
    pivot: [19, 3],
  },
  bucket: {
    rows: [
      '##oooooooo##',
      '##oooooooo##',
      '##oooooooo##',
      '##oooooooo##',
      '##oooooooo##',
      '##oooooooo##',
      '##oooooooo##',
      '##oooooooo##',
      '##oooooooo##',
      '############',
      '.##########.',
    ],
    wall: 'steel',
  },
};

export const CONTAINER_INFO = {
  crucible: { name: 'Crucible', desc: 'Graphite crucible (~100 cells). Fill it with ore or metal, heat it in a furnace, then tilt to pour.' },
  crucible_large: { name: 'Large Crucible', desc: 'Big graphite crucible (~200 cells) for large castings.' },
  ladle: { name: 'Pouring Ladle', desc: 'Steel ladle with a long handle — tilts around the grip for precise pours. Steel melts at 1450°C, so do not use it for molten iron or steel!' },
  bucket: { name: 'Steel Bucket', desc: 'Scoop up water, sand or anything else by dipping it in. Melts at 1450°C.' },
};

export class Crucible extends Container {
  constructor(game, type = 'crucible') {
    const def = SHAPES[type] || SHAPES.crucible;
    const shape = parseShape(game.registry, def.rows, {
      '#': { k: MASK.WALL, mat: def.wall },
      o: { k: MASK.CAVITY },
    });
    super(game, {
      type,
      name: CONTAINER_INFO[type]?.name || 'Container',
      category: 'Container',
      ...shape,
      pivot: def.pivot,
      looseSolids: true,
      impactSound: def.wall === 'steel' ? 'clink' : 'thud',
    });
  }
}
