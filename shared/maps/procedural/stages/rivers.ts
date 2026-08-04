import { fbm } from '../noise.js';
import { stageSeed, type ProceduralContext } from '../context.js';
import type { ProceduralStage } from './types.js';

/**
 * Stage 4 — rivers (lightweight).
 * Full flow-accumulation at 4k is heavy; use valley noise × precip as river likelihood,
 * then optional mild carve into elevation.
 */
export const riversStage: ProceduralStage = {
  id: 'rivers',
  label: '4 · Ríos',
  description: 'Red fluvial ligera (valles × precipitación)',
  paramsKey: 'rivers',
  run(ctx: ProceduralContext) {
    const { width, height, params } = ctx;
    const elev = ctx.buffers.elevation as Float32Array;
    const mask = ctx.buffers.landmask as Uint8Array;
    const precip = ctx.buffers.precip as Float32Array;
    const river = ctx.buffers.river as Uint8Array;
    const r = params.rivers;
    const seed = stageSeed(ctx, 400);
    const n = width * height;
    river.fill(0);

    for (let y = 0; y < height; y++) {
      const latN = height <= 1 ? 0 : (y / (height - 1)) * 2 - 1;
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (mask[i] === 0) continue;

        const lon01 = x / width;
        // Ridge noise → valleys where low
        const ridge = fbm(lon01 * 6.5, latN * 5.2, 4, seed);
        const valley = 1 - Math.abs(2 * ridge - 1);
        const score = valley * 0.65 + precip[i] * 0.35;
        if (score > r.flowThreshold) {
          const strength = Math.min(255, Math.floor((score - r.flowThreshold) * 400));
          river[i] = Math.max(1, strength);
          if (r.carveStrength > 0) {
            elev[i] -= river[i] * r.carveStrength * 0.8;
          }
        }
      }
    }

    // Tiny cleanup: drop isolated single pixels
    const copy = new Uint8Array(river);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (copy[i] === 0) continue;
        const xm = (x - 1 + width) % width;
        const xp = (x + 1) % width;
        const nCount =
          (copy[y * width + xm] > 0 ? 1 : 0) +
          (copy[y * width + xp] > 0 ? 1 : 0) +
          (copy[(y - 1) * width + x] > 0 ? 1 : 0) +
          (copy[(y + 1) * width + x] > 0 ? 1 : 0);
        if (nCount === 0) river[i] = 0;
      }
    }

    void n;
  },
};
