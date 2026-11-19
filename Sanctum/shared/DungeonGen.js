import { TILES } from './Constants.js';
import { PRNG } from './MathUtils.js';

export class DungeonGen {
  static generate(seed, width = 40, height = 30) {
    const rng = new PRNG(seed);
    const map = Array.from({ length: height }, () => new Uint8Array(width).fill(TILES.WALL));
    const rooms = [];

    function carveRoom(rx, ry, rw, rh) {
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          if (y > 0 && y < height - 1 && x > 0 && x < width - 1) {
            map[y][x] = TILES.FLOOR;
          }
        }
      }
      rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: (rx + rw / 2) | 0, cy: (ry + rh / 2) | 0 });
    }

    function carveHCorridor(x1, x2, y) {
      const start = Math.min(x1, x2);
      const end = Math.max(x1, x2);
      for (let x = start; x <= end; x++) {
        if (y > 0 && y < height - 1) map[y][x] = TILES.FLOOR;
      }
    }

    function carveVCorridor(y1, y2, x) {
      const start = Math.min(y1, y2);
      const end = Math.max(y1, y2);
      for (let y = start; y <= end; y++) {
        if (x > 0 && x < width - 1) map[y][x] = TILES.FLOOR;
      }
    }

    const MAX_ROOMS = 8;
    for (let i = 0; i < 25; i++) {
      if (rooms.length >= MAX_ROOMS) break;
      const rw = rng.range(6, 11);
      const rh = rng.range(5, 8);
      const rx = rng.range(2, width - rw - 2);
      const ry = rng.range(2, height - rh - 2);

      let overlap = false;
      for (const r of rooms) {
        if (rx <= r.x + r.w + 1 && rx + rw + 1 >= r.x &&
            ry <= r.y + r.h + 1 && ry + rh + 1 >= r.y) {
          overlap = true;
          break;
        }
      }

      if (!overlap) {
        carveRoom(rx, ry, rw, rh);
      }
    }

    for (let i = 0; i < rooms.length - 1; i++) {
      const rA = rooms[i];
      const rB = rooms[i + 1];
      if (rng.next() % 2 === 0) {
        carveHCorridor(rA.cx, rB.cx, rA.cy);
        carveVCorridor(rA.cy, rB.cy, rB.cx);
      } else {
        carveVCorridor(rA.cy, rB.cy, rA.cx);
        carveHCorridor(rA.cx, rB.cx, rB.cy);
      }
    }

    const spawnPoint = { x: rooms[0].cx, y: rooms[0].cy };
    const exitPoint = { x: rooms[rooms.length - 1].cx, y: rooms[rooms.length - 1].cy };
    map[exitPoint.y][exitPoint.x] = TILES.STAIRS_DOWN;

    return { width, height, map, rooms, spawnPoint, exitPoint };
  }
}
