import type { ProceduralContext } from '../context.js';
import type { ProceduralStage } from './types.js';

/** Elev threshold so ~oceanPercent% of cells are ≤ threshold (ocean). */
function thresholdForOceanPercent(elev: Float32Array, oceanPercent: number): number {
  const n = elev.length;
  const pct = Math.max(0, Math.min(100, oceanPercent));
  if (pct <= 0) {
    let lo = Infinity;
    for (let i = 0; i < n; i++) if (elev[i] < lo) lo = elev[i];
    return lo - 1;
  }
  if (pct >= 100) {
    let hi = -Infinity;
    for (let i = 0; i < n; i++) if (elev[i] > hi) hi = elev[i];
    return hi + 1;
  }
  const copy = Float32Array.from(elev);
  copy.sort();
  const idx = Math.max(0, Math.min(n - 1, Math.floor((pct / 100) * n) - 1));
  return copy[Math.max(0, idx)];
}

/**
 * Stage 2 — pick shoreline from ocean % (percentile), rebase so that height = 0 m,
 * then landmask + light coastal/shelf shaping.
 */
export const oceanStage: ProceduralStage = {
  id: 'ocean',
  label: '2 · Océano',
  description: 'Porcentaje de océano → rebase (costa = 0 m) + soften',
  paramsKey: 'ocean',
  run(ctx: ProceduralContext) {
    const { width, height, params } = ctx;
    const elev = ctx.buffers.elevation as Float32Array;
    const crustBuf = ctx.buffers.crust as Float32Array | undefined;
    const mask = ctx.buffers.landmask as Uint8Array;
    const oceanPct = Math.max(0, Math.min(100, params.ocean.oceanPercent));
    const shelf = Math.max(10, params.ocean.shelfDepthM);
    const soften = Math.max(0, Math.min(1, params.ocean.coastSoften));
    const n = width * height;

    const prev = ctx.oceanElevShiftM ?? 0;
    if (prev !== 0) {
      for (let i = 0; i < n; i++) {
        elev[i] += prev;
        if (crustBuf) crustBuf[i] += prev;
      }
      ctx.onLog?.(`  océano: deshice rebase previo (+${prev.toFixed(0)} m)`);
    }

    const sea = thresholdForOceanPercent(elev, oceanPct);
    ctx.onLog?.(
      `  océano: ${oceanPct}% océano → cota ${sea.toFixed(0)} m → rebase a 0`,
    );
    for (let i = 0; i < n; i++) {
      elev[i] -= sea;
      if (crustBuf) crustBuf[i] -= sea;
    }
    ctx.oceanElevShiftM = sea;

    for (let i = 0; i < n; i++) {
      mask[i] = elev[i] > 0 ? 1 : 0;
    }

    let land = 0;
    let eMin = Infinity;
    let eMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const e = elev[i];
      if (e < eMin) eMin = e;
      if (e > eMax) eMax = e;
      if (mask[i]) land++;
    }
    ctx.onLog?.(
      `  océano: ${((100 * (n - land)) / n).toFixed(1)}% agua · elev [${eMin.toFixed(0)} … ${eMax.toFixed(0)}] m`,
    );

    if (soften > 0 || shelf > 0) {
      const next = new Float32Array(elev);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          const xm = (x - 1 + width) % width;
          const xp = (x + 1) % width;
          const neighbors = [
            elev[y * width + xm],
            elev[y * width + xp],
            elev[(y - 1) * width + x],
            elev[(y + 1) * width + x],
          ];
          const landN = neighbors.filter((h) => h > 0).length;
          if (mask[i] === 0 && landN > 0) {
            const target = -shelf * (1 - landN / 4);
            next[i] = elev[i] * 0.5 + Math.max(elev[i], target) * 0.5;
          } else if (mask[i] === 1 && landN < 4 && soften > 0) {
            const avg = (neighbors.reduce((a, b) => a + b, 0) + elev[i]) / 5;
            next[i] = elev[i] * (1 - soften * 0.35) + avg * (soften * 0.35);
          }
        }
      }
      elev.set(next);
      for (let i = 0; i < n; i++) {
        mask[i] = elev[i] > 0 ? 1 : 0;
      }
    }
  },
};
