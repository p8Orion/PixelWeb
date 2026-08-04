import { LANDCOVER } from '../../shared/maps/game.js';
import {
  MAP_TILE_SIZE,
  tileKey,
  tilePixelBounds,
  worldToTile,
  type MapTileData,
} from '../../shared/maps/tiles.js';
import type { RoomOverlay, TilePatch } from '../../shared/rooms.js';
import { emptyOverlay } from '../../shared/rooms.js';

export { emptyOverlay };

function copyTile(tile: MapTileData): MapTileData {
  return {
    tx: tile.tx,
    ty: tile.ty,
    tw: tile.tw,
    th: tile.th,
    tileSize: tile.tileSize,
    landmask: new Uint8Array(tile.landmask),
    elevation: new Int16Array(tile.elevation),
    landcover: new Uint8Array(tile.landcover),
  };
}

function ensurePatch(overlay: RoomOverlay, key: string): TilePatch {
  let patch = overlay.tiles.get(key);
  if (!patch) {
    patch = {};
    overlay.tiles.set(key, patch);
  }
  return patch;
}

/** Merge base tile ⊕ sea level ⊕ sparse cell patches. Never mutates base. */
export function applyOverlayToTile(base: MapTileData, overlay: RoomOverlay): MapTileData {
  const out = copyTile(base);
  const n = out.tw * out.th;
  const sea = overlay.seaLevelOffsetM;

  if (sea !== 0) {
    for (let i = 0; i < n; i++) {
      if (out.elevation[i] <= sea) {
        out.landmask[i] = 0;
        out.landcover[i] = LANDCOVER.WATER;
      }
    }
  }

  const patch = overlay.tiles.get(tileKey(base.tx, base.ty));
  if (!patch) return out;

  if (patch.elevDelta) {
    for (const [i, d] of patch.elevDelta) {
      if (i < 0 || i >= n) continue;
      out.elevation[i] = Math.max(-32768, Math.min(32767, out.elevation[i] + d));
    }
  }
  if (patch.landmask) {
    for (const [i, v] of patch.landmask) {
      if (i < 0 || i >= n) continue;
      out.landmask[i] = v ? 1 : 0;
    }
  }
  if (patch.landcover) {
    for (const [i, v] of patch.landcover) {
      if (i < 0 || i >= n) continue;
      out.landcover[i] = v;
    }
  }

  // Re-apply sea level after elev deltas so raised/lowered cells stay consistent.
  if (sea !== 0 && patch.elevDelta) {
    for (const [i] of patch.elevDelta) {
      if (i < 0 || i >= n) continue;
      if (out.elevation[i] <= sea) {
        out.landmask[i] = 0;
        out.landcover[i] = LANDCOVER.WATER;
      }
    }
  }

  return out;
}

export function setSeaLevelOffset(overlay: RoomOverlay, meters: number): void {
  overlay.seaLevelOffsetM = Math.max(-200, Math.min(200, Math.round(meters)));
}

/**
 * Flood a world-pixel AABB: land cells become freshwater (inland flood).
 * Returns touched tile coords for cache invalidation / sync.
 */
export function floodRect(
  overlay: RoomOverlay,
  mapWidth: number,
  mapHeight: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tileSize: number = MAP_TILE_SIZE,
): Array<{ tx: number; ty: number }> {
  const left = Math.max(0, Math.min(mapWidth - 1, Math.floor(Math.min(x0, x1))));
  const right = Math.max(0, Math.min(mapWidth - 1, Math.floor(Math.max(x0, x1))));
  const top = Math.max(0, Math.min(mapHeight - 1, Math.floor(Math.min(y0, y1))));
  const bottom = Math.max(0, Math.min(mapHeight - 1, Math.floor(Math.max(y0, y1))));

  const touched = new Map<string, { tx: number; ty: number }>();

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const tx = worldToTile(x, tileSize);
      const ty = worldToTile(y, tileSize);
      const key = tileKey(tx, ty);
      touched.set(key, { tx, ty });
      const patch = ensurePatch(overlay, key);
      if (!patch.landmask) patch.landmask = new Map();
      if (!patch.landcover) patch.landcover = new Map();
      const { tw } = tilePixelBounds(tx, ty, mapWidth, mapHeight, tileSize);
      const lx = x - tx * tileSize;
      const ly = y - ty * tileSize;
      const local = ly * tw + lx;
      patch.landmask.set(local, 1);
      patch.landcover.set(local, LANDCOVER.FRESHWATER);
    }
  }

  return [...touched.values()];
}
