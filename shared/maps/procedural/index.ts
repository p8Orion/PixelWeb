export { fbm, hash2, smoothNoise } from './noise.js';
export {
  CORE_BUFFERS,
  allocCoreBuffers,
  getBufferDef,
  listBuffers,
  registerBuffer,
  type BufferDef,
  type BufferDtype,
  type BufferStore,
} from './buffers.js';
export {
  DEFAULT_PROCEDURAL_PARAMS,
  cloneParams,
  type ProceduralParams,
  type TectonicsParams,
  type OceanParams,
  type ClimateParams,
  type RiversParams,
  type BiomesParams,
} from './params.js';
export {
  createContext,
  stageSeed,
  type ProceduralContext,
} from './context.js';
export {
  applyParams,
  applyParamsAsync,
  createAndRun,
  createAndRunAsync,
  runAll,
  runAllAsync,
  runFrom,
  runFromAsync,
  stageIndexForParamsKey,
  type StageProgress,
} from './runner.js';
export { exportGameLayers } from './exportGame.js';
export {
  renderBufferPreview,
  renderOrogenyPreview,
  defaultBufferForStage,
  drawVectorOverlay,
  drawOrogenyOverlay,
  drawCordilleraOverlay,
  isLandCell,
  ELEVATION_COLOR_KEY,
  ELEVATION_GRAY_KEY,
  TEMPERATURE_COLOR_KEY,
  PRECIPITATION_COLOR_KEY,
  OROGENY_LINE_COLORS,
} from './preview.js';
export type { OrogenyTrace, Cordillera, CordilleraPoint } from './context.js';
export {
  generateProceduralLayers,
  type ProceduralGenOptions,
} from './generate.js';
export {
  getStage,
  listStages,
  registerStage,
  type ProceduralStage,
} from './stages/index.js';

import type { MapWorldDef } from '../worlds.js';
import { getMapWorld } from '../worlds.js';
import { generateProceduralLayers } from './generate.js';
import type { GameWorldLayers } from '../game.js';
import type { ProceduralParams } from './params.js';

/** Worlds that are generated in-memory (no Earth ingest). */
export function isProceduralWorld(def: Pick<MapWorldDef, 'source'> | string): boolean {
  if (typeof def === 'string') {
    try {
      return getMapWorld(def).source === 'procedural';
    } catch {
      return false;
    }
  }
  return def.source === 'procedural';
}

export async function generateWorldFromDef(
  def: MapWorldDef,
  opts?: { seed?: number; profile?: string; params?: ProceduralParams },
): Promise<GameWorldLayers> {
  if (!isProceduralWorld(def)) {
    throw new Error(`World "${def.id}" is not a procedural source`);
  }
  return generateProceduralLayers({
    worldId: def.id,
    width: opts?.params?.width ?? def.width,
    height: opts?.params?.height ?? def.height,
    seed: opts?.params?.seed ?? opts?.seed ?? 42,
    profile: opts?.profile ?? 'procedural',
    params: opts?.params,
  });
}
