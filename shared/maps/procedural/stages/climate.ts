import { fbm } from '../noise.js';
import { stageSeed, type ProceduralContext } from '../context.js';
import type { ProceduralStage } from './types.js';

function wrap(x: number, w: number): number {
  return ((x % w) + w) % w;
}

function wrapf(x: number, w: number): number {
  return ((x % w) + w) % w;
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

/** Bilinear sample on coarse grid; X wraps, Y clamped (no polar extrapolation). */
function sampleCoarse(
  arr: Float32Array,
  fx: number,
  fy: number,
  gw: number,
  gh: number,
): number {
  // Clamp Y first so ty stays in [0,1] — polar overshoot was inventing hot blobs.
  const fyc = clamp(fy, 0, gh - 1 - 1e-6);
  const fxc = wrapf(fx, gw);
  const x0 = Math.floor(fxc);
  const y0 = Math.floor(fyc);
  const x1 = wrap(x0 + 1, gw);
  const y1 = Math.min(gh - 1, y0 + 1);
  const tx = fxc - x0;
  const ty = fyc - y0;
  const x0w = wrap(x0, gw);
  const a = arr[y0 * gw + x0w];
  const b = arr[y0 * gw + x1];
  const c0 = arr[y1 * gw + x0w];
  const d = arr[y1 * gw + x1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c0 * (1 - tx) * ty + d * tx * ty;
}

/**
 * Semi-Lagrangian advection: carry scalar with velocity field.
 * dt in "cells per step"; X wraps. Optional landMask skips / freezes land cells for SST.
 */
function advectScalar(
  field: Float32Array,
  out: Float32Array,
  u: Float32Array,
  v: Float32Array,
  gw: number,
  gh: number,
  dt: number,
  land: Float32Array | null,
  landThreshold: number,
  relax: Float32Array | null,
  relaxAmt: number,
): void {
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const gi = gy * gw + gx;
      if (land && land[gi] > landThreshold) {
        // Land: no ocean SST advection — keep / relax
        out[gi] = relax ? field[gi] * (1 - relaxAmt) + relax[gi] * relaxAmt : field[gi];
        continue;
      }
      const sx = gx - u[gi] * dt;
      const sy = gy - v[gi] * dt;
      let t = sampleCoarse(field, sx, sy, gw, gh);
      if (relax) t = t * (1 - relaxAmt) + relax[gi] * relaxAmt;
      out[gi] = t;
    }
  }
}

/**
 * Stage 3 — wind + ocean currents on a coarse cell grid, then
 * temperature advected by wind (air) and currents (SST).
 */
export const climateStage: ProceduralStage = {
  id: 'climate',
  label: '3 · Clima',
  description: 'Viento/corrientes por celdas · temp advectada',
  paramsKey: 'climate',
  run(ctx: ProceduralContext) {
    const { width, height, params } = ctx;
    const elev = ctx.buffers.elevation as Float32Array;
    const mask = ctx.buffers.landmask as Uint8Array;
    const age = ctx.buffers.mountainAge as Float32Array;
    const windU = ctx.buffers.windU as Float32Array;
    const windV = ctx.buffers.windV as Float32Array;
    const currentU = ctx.buffers.currentU as Float32Array;
    const currentV = ctx.buffers.currentV as Float32Array;
    const temp = ctx.buffers.temp as Float32Array;
    const precip = ctx.buffers.precip as Float32Array;
    const c = params.climate;
    const sea = 0; // elev is shoreline-relative after ocean stage
    const seed = stageSeed(ctx, 300);

    const cell = Math.max(8, Math.min(256, Math.round(c.cellSize) || 32));
    const gw = Math.ceil(width / cell);
    const gh = Math.ceil(height / cell);
    const gn = gw * gh;

    const gElev = new Float32Array(gn);
    const gLand = new Float32Array(gn);
    const gBaseAir = new Float32Array(gn); // equilibrium atmosphere
    const gBaseSst = new Float32Array(gn); // equilibrium ocean
    const gAir = new Float32Array(gn);
    const gSst = new Float32Array(gn);
    const gPress = new Float32Array(gn);
    const gWu = new Float32Array(gn);
    const gWv = new Float32Array(gn);
    const gCu = new Float32Array(gn);
    const gCv = new Float32Array(gn);
    const nWu = new Float32Array(gn);
    const nWv = new Float32Array(gn);
    const nCu = new Float32Array(gn);
    const nCv = new Float32Array(gn);
    const nAir = new Float32Array(gn);
    const nSst = new Float32Array(gn);

    // --- downsample + base temps ---
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const x0 = gx * cell;
        const y0 = gy * cell;
        const x1 = Math.min(width, x0 + cell);
        const y1 = Math.min(height, y0 + cell);
        let eSum = 0;
        let land = 0;
        let n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = y * width + x;
            eSum += elev[i];
            land += mask[i];
            n++;
          }
        }
        const gi = gy * gw + gx;
        const e = eSum / n;
        gElev[gi] = e;
        gLand[gi] = land / n;
        const latN = height <= 1 ? 0 : ((y0 + y1) * 0.5) / (height - 1) * 2 - 1;
        const absLat = Math.abs(latN);
        const latTemp = c.equatorTempC + (c.poleTempC - c.equatorTempC) * absLat;
        const elevM = Math.max(0, e - sea);
        const air = latTemp - (elevM / 1000) * c.lapseRate;
        // SST: lat only, slightly warmer than air at equator, no lapse
        const sst = latTemp + (1 - absLat) * 2.5;
        gBaseAir[gi] = air;
        gBaseSst[gi] = sst;
        gAir[gi] = air;
        gSst[gi] = gLand[gi] > 0.55 ? air : sst;
        gPress[gi] = -air;
      }
    }

    // Seed wind from lat bands
    for (let gy = 0; gy < gh; gy++) {
      const latN = height <= 1 ? 0 : ((gy + 0.5) * cell) / (height - 1) * 2 - 1;
      const absLat = Math.abs(latN);
      const baseU =
        absLat < 0.3 ? -0.55 : absLat < 0.6 ? 0.8 : absLat < 0.8 ? -0.35 : 0.15;
      const baseV = latN * -0.12;
      for (let gx = 0; gx < gw; gx++) {
        const gi = gy * gw + gx;
        gWu[gi] = baseU * c.windStrength;
        gWv[gi] = baseV * c.windStrength;
      }
    }

    const windSteps = Math.max(1, Math.min(120, Math.round(c.windSteps) || 28));
    const cor = c.coriolis;
    const oro = c.orographicStrength;

    ctx.onLog?.(`  clima: grilla ${gw}×${gh} (celda ${cell}px) · viento ${windSteps} steps`);

    for (let step = 0; step < windSteps; step++) {
      for (let gy = 0; gy < gh; gy++) {
        const latN = height <= 1 ? 0 : ((gy + 0.5) * cell) / (height - 1) * 2 - 1;
        const f = Math.sin(latN * Math.PI * 0.5) * cor;
        for (let gx = 0; gx < gw; gx++) {
          const gi = gy * gw + gx;
          const gxL = wrap(gx - 1, gw);
          const gxR = wrap(gx + 1, gw);
          const gyD = Math.max(0, gy - 1);
          const gyU = Math.min(gh - 1, gy + 1);

          // Pressure from current air temp (coupled lightly)
          gPress[gi] = -gAir[gi];

          const dPx = (gPress[gy * gw + gxR] - gPress[gy * gw + gxL]) * 0.5;
          const dPy = (gPress[gyU * gw + gx] - gPress[gyD * gw + gx]) * 0.5;

          let u = gWu[gi] + (-dPx) * 0.08 * c.windStrength;
          let v = gWv[gi] + (-dPy) * 0.08 * c.windStrength;

          const cu = u;
          const cv = v;
          u += -f * cv * 0.15;
          v += f * cu * 0.15;

          const dEx = (gElev[gy * gw + gxR] - gElev[gy * gw + gxL]) * 0.5;
          const dEy = (gElev[gyU * gw + gx] - gElev[gyD * gw + gx]) * 0.5;
          // Normalize ~800 m neighbor rise → unit slope; block uphill flow, divert cross-slope
          const slopeScale = 1 / 800;
          const sx = dEx * slopeScale;
          const sy = dEy * slopeScale;
          const flowUp = Math.max(0, u * sx + v * sy);
          const block = Math.min(0.75, flowUp * (0.55 + 0.45 * oro));
          u = u * (1 - block) - sx * block * 1.1 * oro;
          v = v * (1 - block) - sy * block * 1.1 * oro;

          const uAvg =
            (gWu[gy * gw + gxL] + gWu[gy * gw + gxR] + gWu[gyD * gw + gx] + gWu[gyU * gw + gx]) *
            0.25;
          const vAvg =
            (gWv[gy * gw + gxL] + gWv[gy * gw + gxR] + gWv[gyD * gw + gx] + gWv[gyU * gw + gx]) *
            0.25;
          u = u * 0.82 + uAvg * 0.18;
          v = v * 0.82 + vAvg * 0.18;

          nWu[gi] = clamp(u, -3, 3);
          nWv[gi] = clamp(v, -3, 3);
        }
      }
      gWu.set(nWu);
      gWv.set(nWv);
    }

    // --- ocean currents ---
    const curSteps = Math.max(1, Math.min(120, Math.round(c.currentSteps) || 36));
    ctx.onLog?.(`  clima: corrientes ${curSteps} steps`);

    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const gi = gy * gw + gx;
        if (gLand[gi] > 0.55) {
          gCu[gi] = 0;
          gCv[gi] = 0;
        } else {
          gCu[gi] = gWu[gi] * 0.35 * c.oceanCurrentStrength;
          gCv[gi] = gWv[gi] * 0.25 * c.oceanCurrentStrength;
        }
      }
    }

    for (let step = 0; step < curSteps; step++) {
      for (let gy = 0; gy < gh; gy++) {
        const latN = height <= 1 ? 0 : ((gy + 0.5) * cell) / (height - 1) * 2 - 1;
        const f = Math.sin(latN * Math.PI * 0.5) * cor * 0.7;
        for (let gx = 0; gx < gw; gx++) {
          const gi = gy * gw + gx;
          if (gLand[gi] > 0.55) {
            nCu[gi] = 0;
            nCv[gi] = 0;
            continue;
          }

          const gxL = wrap(gx - 1, gw);
          const gxR = wrap(gx + 1, gw);
          const gyD = Math.max(0, gy - 1);
          const gyU = Math.min(gh - 1, gy + 1);

          let u = gCu[gi];
          let v = gCv[gi];
          u += gWu[gi] * 0.04 * c.oceanCurrentStrength;
          v += gWv[gi] * 0.03 * c.oceanCurrentStrength;

          const cu = u;
          const cv = v;
          u += -f * cv * 0.12;
          v += f * cu * 0.12;

          if (gLand[gy * gw + gxL] > 0.55 && u < 0) u *= -0.4;
          if (gLand[gy * gw + gxR] > 0.55 && u > 0) u *= -0.4;
          if (gLand[gyD * gw + gx] > 0.55 && v < 0) v *= -0.4;
          if (gLand[gyU * gw + gx] > 0.55 && v > 0) v *= -0.4;

          let uSum = 0;
          let vSum = 0;
          let cnt = 0;
          for (const ni of [gy * gw + gxL, gy * gw + gxR, gyD * gw + gx, gyU * gw + gx]) {
            if (gLand[ni] > 0.55) continue;
            uSum += gCu[ni];
            vSum += gCv[ni];
            cnt++;
          }
          if (cnt > 0) {
            u = u * 0.75 + (uSum / cnt) * 0.25;
            v = v * 0.75 + (vSum / cnt) * 0.25;
          }

          nCu[gi] = clamp(u, -2.5, 2.5);
          nCv[gi] = clamp(v, -2.5, 2.5);
        }
      }
      gCu.set(nCu);
      gCv.set(nCv);
    }

    // --- temperature advection ---
    const advSteps = Math.max(0, Math.min(80, Math.round(c.advectionSteps ?? 20)));
    const advStr = Math.max(0, Math.min(2, c.advectionStrength ?? 1));
    // dt in cells/step — scaled so typical |wind|~1 moves ~advStr * 0.35 cell
    const dtAir = 0.35 * advStr;
    const dtSea = 0.28 * advStr;
    const relaxAir = 0.08; // pull toward radiative equilibrium
    const relaxSst = 0.06;

    ctx.onLog?.(`  clima: advección temp ${advSteps} steps (air+SST)`);

    for (let step = 0; step < advSteps; step++) {
      advectScalar(gAir, nAir, gWu, gWv, gw, gh, dtAir, null, 1, gBaseAir, relaxAir);
      gAir.set(nAir);

      // Coastal air feels SST a bit each step
      for (let gi = 0; gi < gn; gi++) {
        if (gLand[gi] < 0.85 && gLand[gi] > 0.15) {
          gAir[gi] = gAir[gi] * 0.85 + gSst[gi] * 0.15;
        } else if (gLand[gi] <= 0.15) {
          gAir[gi] = gAir[gi] * 0.9 + gSst[gi] * 0.1;
        }
      }

      advectScalar(gSst, nSst, gCu, gCv, gw, gh, dtSea, gLand, 0.55, gBaseSst, relaxSst);
      gSst.set(nSst);
      // Land SST tracks air (no ocean)
      for (let gi = 0; gi < gn; gi++) {
        if (gLand[gi] > 0.55) gSst[gi] = gAir[gi];
      }
    }

    // --- upsample ---
    for (let y = 0; y < height; y++) {
      const latN = height <= 1 ? 0 : (y / (height - 1)) * 2 - 1;
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const lon01 = x / width;
        const wu = sampleCoarse(gWu, (x + 0.5) / cell, (y + 0.5) / cell, gw, gh);
        const wv = sampleCoarse(gWv, (x + 0.5) / cell, (y + 0.5) / cell, gw, gh);
        windU[i] = wu;
        windV[i] = wv;
        currentU[i] = sampleCoarse(gCu, (x + 0.5) / cell, (y + 0.5) / cell, gw, gh);
        currentV[i] = sampleCoarse(gCv, (x + 0.5) / cell, (y + 0.5) / cell, gw, gh);

        const airT = sampleCoarse(gAir, (x + 0.5) / cell, (y + 0.5) / cell, gw, gh);
        const sstT = sampleCoarse(gSst, (x + 0.5) / cell, (y + 0.5) / cell, gw, gh);
        // Surface temp: land uses air; ocean blends air+SST (marine layer)
        temp[i] = mask[i] === 1 ? airT : airT * 0.35 + sstT * 0.65;

        const gxL = wrap(x - 1, width);
        const gxR = wrap(x + 1, width);
        const gradX = elev[y * width + gxR] - elev[y * width + gxL];
        const gradY =
          y > 0 && y < height - 1
            ? elev[(y + 1) * width + x] - elev[(y - 1) * width + x]
            : 0;

        const upslope = Math.max(0, -(wu * gradX + wv * gradY) * 0.0002);
        const orog = upslope * (0.5 + age[i]) * c.orographicStrength;
        const marine = mask[i] === 0 ? 0.75 : 0.2;
        const noise = fbm(lon01 * 4, latN * 3, 2, seed) * 0.15;
        let p = (marine + orog + noise) * c.moistureCapacity;
        if (mask[i] === 1 && age[i] > 0.4 && upslope < 0.01) {
          p *= 0.55;
        }
        precip[i] = Math.max(0, Math.min(1, p));
      }
    }
  },
};
