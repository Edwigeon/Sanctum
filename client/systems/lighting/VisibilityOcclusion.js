/**
 * Merged-Wall Geometry Builder & Analytical 2D Ray-Segment Occlusion Engine
 */

import { ENGINE } from '../../../shared/Constants.js';
import { INV_TILE_SIZE } from './LightingTables.js';

export function isOpaqueRC(state, r, c) {
  if (r < 0 || r >= state.tileRows || c < 0 || c >= state.tileCols) return 1;
  return state.opaqueTiles[r * state.tileCols + c];
}

/**
 * Merges all exposed edges of adjacent 12x12 wall tiles into single continuous mathematical line segments.
 */
export function buildMergedWallSegments(state) {
  state.wallSegments = [];
  const ts = ENGINE.TILE_SIZE;
  const rows = state.tileRows;
  const cols = state.tileCols;

  for (let r = 0; r < rows; r++) {
    if (r > 0) {
      let runStart = -1;
      for (let c = 0; c <= cols; c++) {
        const isEdge = c < cols && isOpaqueRC(state, r, c) === 1 && isOpaqueRC(state, r - 1, c) === 0;
        if (isEdge && runStart === -1) {
          runStart = c;
        } else if (!isEdge && runStart !== -1) {
          const x1 = runStart * ts;
          const x2 = c * ts;
          const y = r * ts;
          state.wallSegments.push({ x1, y1: y, x2, y2: y, nx: 0, ny: -1, minX: x1, maxX: x2, minY: y, maxY: y });
          runStart = -1;
        }
      }
    }
    if (r < rows - 1) {
      let runStart = -1;
      for (let c = 0; c <= cols; c++) {
        const isEdge = c < cols && isOpaqueRC(state, r, c) === 1 && isOpaqueRC(state, r + 1, c) === 0;
        if (isEdge && runStart === -1) {
          runStart = c;
        } else if (!isEdge && runStart !== -1) {
          const x1 = runStart * ts;
          const x2 = c * ts;
          const y = (r + 1) * ts;
          state.wallSegments.push({ x1, y1: y, x2, y2: y, nx: 0, ny: 1, minX: x1, maxX: x2, minY: y, maxY: y });
          runStart = -1;
        }
      }
    }
  }

  for (let c = 0; c < cols; c++) {
    if (c > 0) {
      let runStart = -1;
      for (let r = 0; r <= rows; r++) {
        const isEdge = r < rows && isOpaqueRC(state, r, c) === 1 && isOpaqueRC(state, r, c - 1) === 0;
        if (isEdge && runStart === -1) {
          runStart = r;
        } else if (!isEdge && runStart !== -1) {
          const y1 = runStart * ts;
          const y2 = r * ts;
          const x = c * ts;
          state.wallSegments.push({ x1: x, y1, x2: x, y2, nx: -1, ny: 0, minX: x, maxX: x, minY: y1, maxY: y2 });
          runStart = -1;
        }
      }
    }
    if (c < cols - 1) {
      let runStart = -1;
      for (let r = 0; r <= rows; r++) {
        const isEdge = r < rows && isOpaqueRC(state, r, c) === 1 && isOpaqueRC(state, r, c + 1) === 0;
        if (isEdge && runStart === -1) {
          runStart = r;
        } else if (!isEdge && runStart !== -1) {
          const y1 = runStart * ts;
          const y2 = r * ts;
          const x = (c + 1) * ts;
          state.wallSegments.push({ x1: x, y1, x2: x, y2, nx: 1, ny: 0, minX: x, maxX: x, minY: y1, maxY: y2 });
          runStart = -1;
        }
      }
    }
  }
}

export function getWallSurfaceDepth(state, tx, ty, tc, tr) {
  const ts = ENGINE.TILE_SIZE;
  const localX = tx - tc * ts;
  const localY = ty - tr * ts;
  let minDepth = 16.0;

  if (!isOpaqueRC(state, tr + 1, tc)) minDepth = Math.min(minDepth, ts - localY);
  if (!isOpaqueRC(state, tr - 1, tc)) minDepth = Math.min(minDepth, localY);
  if (!isOpaqueRC(state, tr, tc + 1)) minDepth = Math.min(minDepth, ts - localX);
  if (!isOpaqueRC(state, tr, tc - 1)) minDepth = Math.min(minDepth, localX);

  if (minDepth > 12.0) {
    if (!isOpaqueRC(state, tr + 1, tc + 1)) minDepth = Math.min(minDepth, Math.hypot(ts - localX, ts - localY));
    if (!isOpaqueRC(state, tr + 1, tc - 1)) minDepth = Math.min(minDepth, Math.hypot(localX, ts - localY));
    if (!isOpaqueRC(state, tr - 1, tc + 1)) minDepth = Math.min(minDepth, Math.hypot(ts - localX, localY));
    if (!isOpaqueRC(state, tr - 1, tc - 1)) minDepth = Math.min(minDepth, Math.hypot(localX, localY));
  }
  return minDepth;
}

export function checkStaticObjectOcclusion(state, sx, sy, tx, ty, dist) {
  if (state.staticOccluders.size === 0 || dist < 4) return 1.0;
  const dirX = (tx - sx) / dist;
  const dirY = (ty - sy) / dist;

  for (const occ of state.staticOccluders.values()) {
    if (!occ.enabled) continue;
    const vx = occ.x - sx;
    const vy = occ.y - sy;
    const proj = vx * dirX + vy * dirY;
    if (proj <= occ.radius || proj >= dist - occ.radius * 0.5) continue;

    const perp = Math.abs(vx * dirY - vy * dirX);
    if (perp < occ.radius) {
      if (perp > occ.radius * 0.65) {
        return (perp - occ.radius * 0.65) / (occ.radius * 0.35);
      }
      return 0.0;
    }
  }
  return 1.0;
}

/**
 * Exact Analytical Ray-Segment Visibility against Merged Continuous Wall Segments.
 */
export function computeVisibility(state, sx, sy, tx, ty, segs = state.wallSegments) {
  const dx = tx - sx;
  const dy = ty - sy;
  const distSq = dx * dx + dy * dy;
  if (distSq < 2.25) return 1.0;
  const dist = Math.sqrt(distSq);

  const targetCol = (tx * INV_TILE_SIZE) | 0;
  const targetRow = (ty * INV_TILE_SIZE) | 0;
  const targetIsWall = isOpaqueRC(state, targetRow, targetCol) === 1;

  let wallSurfaceFade = 1.0;
  if (targetIsWall) {
    const surfaceDepth = getWallSurfaceDepth(state, tx, ty, targetCol, targetRow);
    if (surfaceDepth > 11.0) return 0.0;
    wallSurfaceFade = 1.0 - Math.max(0, (surfaceDepth - 3.0) / 8.0);
    if (wallSurfaceFade <= 0.0) return 0.0;
  }

  const objVis = checkStaticObjectOcclusion(state, sx, sy, tx, ty, dist);
  if (objVis <= 0.0) return 0.0;

  const rayMinX = sx < tx ? sx : tx;
  const rayMaxX = sx > tx ? sx : tx;
  const rayMinY = sy < ty ? sy : ty;
  const rayMaxY = sy > ty ? sy : ty;

  const selfWallMinT = targetIsWall ? Math.max(0, 1.0 - 15.0 / dist) : 1.0;

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.maxX < rayMinX || seg.minX > rayMaxX || seg.maxY < rayMinY || seg.minY > rayMaxY) {
      continue;
    }

    if (seg.ny !== 0) {
      if (Math.abs(dy) < 1e-5) continue;
      const t = (seg.y1 - sy) / dy;
      if (t <= 0.001 || t >= 0.999) continue;
      const ix = sx + t * dx;
      if (ix < seg.x1 - 0.01 || ix > seg.x2 + 0.01) continue;

      if (!targetIsWall) return 0.0;
      if (dy * seg.ny > 0 || t < selfWallMinT) return 0.0;
    } else {
      if (Math.abs(dx) < 1e-5) continue;
      const t = (seg.x1 - sx) / dx;
      if (t <= 0.001 || t >= 0.999) continue;
      const iy = sy + t * dy;
      if (iy < seg.y1 - 0.01 || iy > seg.y2 + 0.01) continue;

      if (!targetIsWall) return 0.0;
      if (dx * seg.nx > 0 || t < selfWallMinT) return 0.0;
    }
  }

  return wallSurfaceFade * objVis;
}

