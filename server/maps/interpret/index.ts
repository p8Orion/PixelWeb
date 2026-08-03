import { LANDCOVER_LABELS, type GameWorldLayers, type GameWorldMeta } from '../../../shared/maps/game.js';
import type { IngestedWorld } from '../../../shared/maps/ingest.js';
import { MAP_TILE_SIZE } from '../../../shared/maps/tiles.js';
import { getMapWorld } from '../../../shared/maps/worlds.js';
import { defaultProfile } from './profiles/default.js';
import type { InterpretOptions, InterpretProfile } from './types.js';

const profiles: Record<string, InterpretProfile> = {
  [defaultProfile.id]: defaultProfile,
};

export function listProfiles(): InterpretProfile[] {
  return Object.values(profiles);
}

export function getProfile(id: string): InterpretProfile {
  const p = profiles[id];
  if (!p) throw new Error(`Unknown interpret profile: ${id}. Known: ${Object.keys(profiles).join(', ')}`);
  return p;
}

export function interpretWorld(
  ingested: IngestedWorld,
  profileId = 'default',
  opts?: InterpretOptions & { worldId?: string },
): GameWorldLayers {
  const profile = getProfile(profileId);
  const worldId = opts?.worldId ?? 'default';
  const world = getMapWorld(worldId);
  const hydroStrokeScale = opts?.hydroStrokeScale ?? world.hydroStrokeScale;
  const result = profile.interpret(ingested, { hydroStrokeScale });

  const meta: GameWorldMeta = {
    version: 1,
    kind: 'interpreted',
    profile: profile.id,
    worldId,
    projection: ingested.meta.projection,
    width: ingested.meta.width,
    height: ingested.meta.height,
    lonRange: ingested.meta.lonRange,
    latRange: ingested.meta.latRange,
    tileSize: MAP_TILE_SIZE,
    layers: {
      landmask: {
        file: 'landmask.bin',
        dtype: 'uint8',
        meaning: result.notes.landmask,
      },
      elevation: {
        file: 'elevation.bin',
        dtype: 'int16',
        unit: 'meters',
        note: result.notes.elevation,
      },
      landcover: {
        file: 'landcover.bin',
        dtype: 'uint8',
        codes: LANDCOVER_LABELS,
        meaning: result.notes.landcover,
      },
    },
    ingestBuiltAt: ingested.meta.builtAt,
    interpretedAt: new Date().toISOString(),
  };

  return {
    meta,
    landmask: result.landmask,
    elevation: result.elevation,
    landcover: result.landcover,
  };
}
