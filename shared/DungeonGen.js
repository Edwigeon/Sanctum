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

    function carveHCorridor(x1, x2, y, widthTiles = 2) {
      const start = Math.min(x1, x2);
      const end = Math.max(x1, x2);
      for (let x = start; x <= end; x++) {
        for (let w = 0; w < widthTiles; w++) {
          const cy = y + w;
          if (cy > 0 && cy < height - 1 && x > 0 && x < width - 1) map[cy][x] = TILES.FLOOR;
        }
      }
    }

    function carveVCorridor(y1, y2, x, widthTiles = 2) {
      const start = Math.min(y1, y2);
      const end = Math.max(y1, y2);
      for (let y = start; y <= end; y++) {
        for (let w = 0; w < widthTiles; w++) {
          const cx = x + w;
          if (y > 0 && y < height - 1 && cx > 0 && cx < width - 1) map[y][cx] = TILES.FLOOR;
        }
      }
    }

    function connectRooms(rA, rB) {
      if (rng.next() % 2 === 0) {
        carveHCorridor(rA.cx, rB.cx, rA.cy);
        carveVCorridor(rA.cy, rB.cy, rB.cx);
      } else {
        carveVCorridor(rA.cy, rB.cy, rA.cx);
        carveHCorridor(rA.cx, rB.cx, rB.cy);
      }
    }

    const MAX_ROOMS = 8;
    for (let i = 0; i < 30; i++) {
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

    // Connect sequential backbone
    for (let i = 0; i < rooms.length - 1; i++) {
      connectRooms(rooms[i], rooms[i + 1]);
    }

    // Connect loops for tactical kiting paths
    if (rooms.length >= 4) {
      connectRooms(rooms[0], rooms[rooms.length - 2]);
    }
    if (rooms.length >= 6) {
      connectRooms(rooms[1], rooms[rooms.length - 1]);
    }

    const spawnPoint = { x: rooms[0].cx, y: rooms[0].cy };
    const exitPoint = { x: rooms[rooms.length - 1].cx, y: rooms[rooms.length - 1].cy };
    map[exitPoint.y][exitPoint.x] = TILES.STAIRS_DOWN;

    // Guaranteed traversability verification (Flood-fill / BFS)
    const visited = Array.from({ length: height }, () => new Uint8Array(width));
    const q = [{ x: spawnPoint.x, y: spawnPoint.y }];
    visited[spawnPoint.y][spawnPoint.x] = 1;
    while (q.length > 0) {
      const { x, y } = q.shift();
      for (const [dx, dy] of [[1,0], [-1,0], [0,1], [0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1 && !visited[ny][nx] && map[ny][nx] !== TILES.WALL) {
          visited[ny][nx] = 1;
          q.push({ x: nx, y: ny });
        }
      }
    }

    // Connect any unvisited room (defensive guarantee)
    for (let i = 0; i < rooms.length; i++) {
      if (!visited[rooms[i].cy][rooms[i].cx]) {
        connectRooms(rooms[i], rooms[0]);
      }
    }

    return { width, height, map, rooms, spawnPoint, exitPoint };
  }
}
