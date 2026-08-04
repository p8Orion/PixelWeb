/**
 * Project pipeline buffers → GameWorldLayers (catalog / rooms / tiles path).
 */

import {
  LANDCOVER_LABELS,
  type GameWorldLayers,
  type GameWorldMeta,
} from '../game.js';
import { MAP_TILE_SIZE } from '../tiles.js';
import type { ProceduralContext } from './context.js';

export function exportGameLayers(
  ctx: ProceduralContext,
  opts?: { worldId?: string; profile?: string },
): GameWorldLayers {
  const { width, height } = ctx;
  const n = width * height;
  const elevF = ctx.buffers.elevation as Float32Array;
  const mask = ctx.buffers.landmask as Uint8Array;
  const cover = ctx.buffers.landcover as Uint8Array;

  const elevation = new Int16Array(n);
  const landmask = new Uint8Array(n);
  const landcover = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    elevation[i] = Math.max(-32768, Math.min(32767, Math.round(elevF[i])));
    landmask[i] = mask[i];
    landcover[i] = cover[i];
  }

  const now = new Date().toISOString();
  const worldId = opts?.worldId ?? 'procedural';
  const profile = opts?.profile ?? 'procedural';

  const meta: GameWorldMeta = {
    version: 1,
    kind: 'interpreted',
    profile,
    worldId,
    projection: 'equirectangular',
    width,
    height,
    lonRange: [-180, 180],
    latRange: [-90, 90],
    tileSize: MAP_TILE_SIZE,
    layers: {
      landmask: {
        file: 'landmask.bin',
        dtype: 'uint8',
        meaning: 'procedural pipeline stage ocean',
      },
      elevation: {
        file: 'elevation.bin',
        dtype: 'int16',
        unit: 'meters',
        note: `procedural pipeline seed=${ctx.seed}`,
      },
      landcover: {
        file: 'landcover.bin',
        dtype: 'uint8',
        codes: LANDCOVER_LABELS,
        meaning: 'procedural pipeline stage biomes',
      },
    },
    ingestBuiltAt: now,
    interpretedAt: now,
  };

  return { meta, landmask, elevation, landcover };
}
