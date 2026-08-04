/**
 * Convenience: full pipeline → GameWorldLayers (server boot / apply).
 */

import type { GameWorldLayers } from '../game.js';
import { exportGameLayers } from './exportGame.js';
import {
  DEFAULT_PROCEDURAL_PARAMS,
  cloneParams,
  type ProceduralParams,
} from './params.js';
import { createAndRun } from './runner.js';

export interface ProceduralGenOptions {
  worldId?: string;
  width?: number;
  height?: number;
  seed?: number;
  profile?: string;
  params?: Partial<ProceduralParams> & {
    tectonics?: Partial<ProceduralParams['tectonics']>;
    ocean?: Partial<ProceduralParams['ocean']>;
    climate?: Partial<ProceduralParams['climate']>;
    rivers?: Partial<ProceduralParams['rivers']>;
    biomes?: Partial<ProceduralParams['biomes']>;
  };
}

function mergeParams(opts: ProceduralGenOptions = {}): ProceduralParams {
  const base = cloneParams(DEFAULT_PROCEDURAL_PARAMS);
  if (opts.width) base.width = opts.width;
  if (opts.height) base.height = opts.height;
  if (opts.seed != null) base.seed = opts.seed;
  const p = opts.params;
  if (!p) return base;
  if (p.seed != null) base.seed = p.seed;
  if (p.width) base.width = p.width;
  if (p.height) base.height = p.height;
  if (p.tectonics) Object.assign(base.tectonics, p.tectonics);
  if (p.ocean) Object.assign(base.ocean, p.ocean);
  if (p.climate) Object.assign(base.climate, p.climate);
  if (p.rivers) Object.assign(base.rivers, p.rivers);
  if (p.biomes) Object.assign(base.biomes, p.biomes);
  return base;
}

export async function generateProceduralLayers(
  opts: ProceduralGenOptions = {},
): Promise<GameWorldLayers> {
  const params = mergeParams(opts);
  const ctx = await createAndRun(params);
  return exportGameLayers(ctx, {
    worldId: opts.worldId ?? 'procedural',
    profile: opts.profile ?? 'procedural',
  });
}
