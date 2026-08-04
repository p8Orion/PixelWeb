import { LANDCOVER } from '../../game.js';
import type { ProceduralContext } from '../context.js';
import type { ProceduralStage } from './types.js';

/**
 * Stage 5 — biomes / landcover from elev + mask + temp + precip + rivers.
 */
export const biomesStage: ProceduralStage = {
  id: 'biomes',
  label: '5 · Biomas',
  description: 'Landcover final a partir de clima, relieve y ríos',
  paramsKey: 'biomes',
  run(ctx: ProceduralContext) {
    const { width, height, params } = ctx;
    const elev = ctx.buffers.elevation as Float32Array;
    const mask = ctx.buffers.landmask as Uint8Array;
    const temp = ctx.buffers.temp as Float32Array;
    const precip = ctx.buffers.precip as Float32Array;
    const river = ctx.buffers.river as Uint8Array;
    const cover = ctx.buffers.landcover as Uint8Array;
    const snowT = params.biomes.snowTempC;
    const n = width * height;

    for (let i = 0; i < n; i++) {
      if (mask[i] === 0) {
        cover[i] = LANDCOVER.WATER;
        continue;
      }
      if (river[i] > 40) {
        cover[i] = LANDCOVER.FRESHWATER;
        continue;
      }

      const t = temp[i];
      const p = precip[i];
      const elevM = Math.max(0, elev[i]); // elev is 0 at shoreline after ocean rebase

      if (t < snowT || elevM > 3800) {
        cover[i] = LANDCOVER.SNOW_ICE;
      } else if (elevM < 8 && p > 0.55) {
        cover[i] = LANDCOVER.WETLAND;
      } else if (p < 0.28) {
        cover[i] = elevM > 900 ? LANDCOVER.BARE : LANDCOVER.BARE;
      } else if (p < 0.42) {
        cover[i] = LANDCOVER.SHRUBLAND;
      } else if (p > 0.62 && t > 5 && elevM < 2200) {
        cover[i] = LANDCOVER.TREE_COVER;
      } else if (t > 12 && p > 0.45 && elevM < 800) {
        cover[i] = LANDCOVER.GRASSLAND;
      } else if (elevM > 1800) {
        cover[i] = LANDCOVER.SHRUBLAND;
      } else {
        cover[i] = LANDCOVER.GRASSLAND;
      }
    }
  },
};
