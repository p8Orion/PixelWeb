import { fbm } from '../noise.js';
import {
  stageSeed,
  type Cordillera,
  type CordilleraPoint,
  type ProceduralContext,
} from '../context.js';
import type { ProceduralStage } from './types.js';

function yieldFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((r) => requestAnimationFrame(() => r()));
  }
  return new Promise((r) => setTimeout(r, 0));
}

function wrapX(x: number, width: number): number {
  return ((x % width) + width) % width;
}

function wrapDx(ax: number, bx: number, width: number): number {
  let dx = bx - ax;
  if (dx > width / 2) dx -= width;
  if (dx < -width / 2) dx += width;
  return dx;
}

function sampleCylinder(
  lon01: number,
  latN: number,
  scale: number,
  octaves: number,
  seed: number,
): number {
  const ang = lon01 * Math.PI * 2;
  const cx = Math.cos(ang) * scale;
  const cz = Math.sin(ang) * scale;
  const cy = latN * scale * 0.75;
  return (
    fbm(cx + 10, cy + cz * 0.35, octaves, seed) * 0.55 +
    fbm(cz + 20, cy + cx * 0.35, Math.max(2, octaves - 1), seed + 5) * 0.45
  );
}

function smooth01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Continuous crust: abyss → shelf → plains. */
function crustNoiseToMeters(h: number): number {
  const keys: Array<[number, number]> = [
    [-0.75, -5000],
    [-0.4, -3200],
    [-0.18, -400],
    [-0.06, -80],
    [0.02, 40],
    [0.12, 140],
    [0.25, 260],
  ];
  if (h <= keys[0][0]) return keys[0][1];
  if (h >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [a0, am] = keys[i];
    const [b0, bm] = keys[i + 1];
    if (h >= a0 && h <= b0) {
      return am + (bm - am) * smooth01((h - a0) / (b0 - a0 || 1));
    }
  }
  return keys[keys.length - 1][1];
}

function rand01(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Width profile along curve parameter t ∈ [0,1].
 * - Envelope sin(πt) → 0 at both ends
 * - Internal variability: multi-frequency modulation along t (still × envelope)
 */
function curveProfile(t: number, variability: number, seed: number): number {
  const tt = Math.max(0, Math.min(1, t));
  const envelope = Math.sin(Math.PI * tt);
  if (envelope <= 1e-6) return 0;

  const varN = Math.max(0, Math.min(1, variability));
  if (varN < 1e-6) return envelope;

  // Internal width variation along the cordillera (pinches / bulges), ends stay 0
  const phase = rand01(seed, 50) * Math.PI * 2;
  const low =
    0.5 + 0.5 * Math.sin(tt * Math.PI * (2 + varN * 3) + phase);
  const mid =
    0.5 +
    0.5 * Math.sin(tt * Math.PI * (5 + varN * 8) + phase * 1.7 + 1.1);
  const high = sampleCylinder(tt * (4 + varN * 6), 0.15, 4.5, 2, seed + 61);
  const internal = 0.4 * low + 0.35 * mid + 0.25 * high;

  // varN=0 → flat envelope; varN=1 → strong pinches (still never negative)
  const mod = 1 - varN * 0.75 + varN * 0.75 * (0.15 + 0.85 * internal);
  return envelope * Math.max(0.02, mod);
}

/**
 * Crest height multiplier along t (independent of width).
 * Low-frequency peaks/cols — high-freq crest×disk falloff caused scalloped “capas”.
 */
function crestHeightProfile(t: number, variability: number, seed: number): number {
  const tt = Math.max(0, Math.min(1, t));
  const varN = Math.max(0, Math.min(1, variability));
  if (varN < 1e-6) return 1;

  const phase = rand01(seed, 80) * Math.PI * 2;
  // Prefer long wavelengths along the ridge (summits & passes, not beads)
  const lo = sampleCylinder(tt * (1.1 + varN * 1.8), 0.1, 2.6, 2, seed + 81);
  const mid = sampleCylinder(tt * (2.2 + varN * 3.2), 0.22, 4.0, 2, seed + 82);
  const wave = 0.5 + 0.5 * Math.sin(tt * Math.PI * (1.4 + varN * 3.5) + phase);
  const mix = 0.5 * lo + 0.3 * mid + 0.2 * wave;
  return Math.max(0.28, 1 - varN * 0.58 + varN * 0.95 * mix);
}

/**
 * One cordillera = one open curve (avoids tight self-loops).
 * widthVar → pinches along t; lengthScale → this instance's length multiplier.
 * elev/crust → sense already-stamped ranges and deflect (bend along / away).
 */
function reliefAboveCrust(
  x: number,
  y: number,
  elev: Float32Array,
  crust: Float32Array,
  width: number,
  height: number,
): number {
  const xi = Math.floor(wrapX(x, width));
  const yi = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const i = yi * width + xi;
  return elev[i] - crust[i];
}

/** Turn (rad/px) to avoid / skim existing orogeny relief ahead. */
function collisionTurn(
  x: number,
  y: number,
  heading: number,
  elev: Float32Array,
  crust: Float32Array,
  width: number,
  height: number,
  senseDist: number,
  preferSide: number,
): number {
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  const lx = -hy;
  const ly = hx;
  const look = senseDist;
  const thresh = 100;

  const ahead = reliefAboveCrust(x + hx * look, y + hy * look, elev, crust, width, height);
  const near = reliefAboveCrust(
    x + hx * look * 0.4,
    y + hy * look * 0.4,
    elev,
    crust,
    width,
    height,
  );
  const left = reliefAboveCrust(
    x + hx * look * 0.55 + lx * look * 0.85,
    y + hy * look * 0.55 + ly * look * 0.85,
    elev,
    crust,
    width,
    height,
  );
  const right = reliefAboveCrust(
    x + hx * look * 0.55 - lx * look * 0.85,
    y + hy * look * 0.55 - ly * look * 0.85,
    elev,
    crust,
    width,
    height,
  );

  const hit = Math.max(0, Math.max(ahead, near) - thresh);
  const flankL = Math.max(0, left - thresh);
  const flankR = Math.max(0, right - thresh);
  if (hit < 1 && flankL < 1 && flankR < 1) return 0;

  // Turn toward the clearer flank; if tied, use preferSide
  let side = left - right;
  if (Math.abs(side) < 40) side = preferSide;
  const away = side >= 0 ? 1 : -1; // positive sideBias → left higher → turn right (−)

  // Head-on: stronger dodge; flank contact: gentler skim along the range
  const headOn = Math.min(1.4, hit / 550);
  const skim = Math.min(1, Math.max(flankL, flankR) / 450);
  const strength = (0.018 + 0.04 * headOn + 0.022 * skim) * Math.min(1.2, (hit + flankL + flankR) / 400);
  return -away * strength;
}

function generateCordilleraCurve(
  width: number,
  height: number,
  era: number,
  seed: number,
  lengthFrac: number,
  lengthScale: number,
  widthFrac: number,
  widthVar: number,
  crestVar: number,
  spacingVar: number,
  meanderAvg: number,
  elev: Float32Array | null,
  crust: Float32Array | null,
): Cordillera {
  const span = Math.hypot(width, height);
  const targetLen = Math.max(
    span * 0.06,
    lengthFrac * span * Math.max(0.3, Math.min(1.8, lengthScale)),
  );
  const baseW = Math.max(4, widthFrac * Math.min(width, height));
  const stepBase = Math.max(3, Math.min(10, baseW * 0.28));
  const wVar = Math.max(0, Math.min(1, widthVar));
  const cVar = Math.max(0, Math.min(1, crestVar));
  const sVar = Math.max(0, Math.min(1, spacingVar));
  const senseDist = Math.max(stepBase * 3, baseW * 1.8);
  const preferSide = rand01(seed, 11) > 0.5 ? 1 : -1;

  // Eventual inflections: irregular flips of curvature sign (not a driven sine).
  // meanderAvg ≈ expected count; per-curve count & spacing vary a lot.
  const nInflect = Math.max(
    0,
    Math.round(meanderAvg * (0.25 + 1.1 * rand01(seed, 5))),
  );
  const flipAt: number[] = [];
  {
    const nSeg = nInflect + 1;
    const weights: number[] = [];
    let wSum = 0;
    for (let k = 0; k < nSeg; k++) {
      // Squared u → long quiet arcs and occasional closer flips
      const u = 0.15 + rand01(seed, 40 + k);
      const w = u * u;
      weights.push(w);
      wSum += w;
    }
    let acc = 0;
    for (let k = 0; k < nInflect; k++) {
      acc += weights[k] / wSum;
      flipAt.push(acc * targetLen);
    }
  }
  // Steady arc between flips; magnitude varies per curve
  const kappaSteady =
    ((0.55 + 0.9 * rand01(seed, 6)) * Math.PI * 0.45) / Math.max(span * 0.2, targetLen);
  let kappa = (rand01(seed, 7) > 0.5 ? 1 : -1) * kappaSteady;
  let kappaFrom = kappa;
  let kappaTo = kappa;
  let flipIdx = 0;
  let flipStart = -1;
  const flipBlend = Math.max(stepBase * 4, targetLen * (0.03 + 0.05 * rand01(seed, 8)));

  let x = rand01(seed, 1) * width;
  let y = 0.12 * height + rand01(seed, 2) * height * 0.76;
  const heading0 = rand01(seed, 3) * Math.PI * 2;
  let heading = heading0;
  let headingUnwrapped = heading0;
  const startX = x;
  const startY = y;
  const maxBend = Math.PI * 1.5; // 270° from original bearing

  const raw: Array<{ x: number; y: number }> = [];
  let walked = 0;
  let i = 0;

  while (walked < targetLen && i < 4000) {
    // Irregular node spacing along the curve
    const spacingN = sampleCylinder(
      (x / width) * 3 + i * 0.02,
      (y / height) * 2 - 1,
      3.5,
      2,
      seed + 33 + i,
    );
    const step =
      stepBase *
      (1 - sVar * 0.55 + sVar * (0.35 + 1.3 * spacingN));
    const stepUse = Math.max(stepBase * 0.3, Math.min(stepBase * 2.4, step));

    if (flipIdx < flipAt.length && flipStart < 0 && walked >= flipAt[flipIdx]) {
      flipStart = walked;
      kappaFrom = kappa;
      // Reverse side; new arc strength not identical to previous
      const mag =
        kappaSteady * (0.65 + 0.7 * rand01(seed, 90 + flipIdx));
      kappaTo = (kappaFrom >= 0 ? -1 : 1) * mag;
      flipIdx++;
    }
    if (flipStart >= 0) {
      const u = Math.min(1, (walked - flipStart) / flipBlend);
      const s = u * u * (3 - 2 * u);
      kappa = kappaFrom + (kappaTo - kappaFrom) * s;
      if (u >= 1) flipStart = -1;
    }

    const noise =
      (sampleCylinder(x / width, (y / height) * 2 - 1, 2.4, 2, seed + 9) - 0.5) *
      kappaSteady *
      0.2;
    let dHeading = (kappa + noise) * stepUse;

    // Feel already-drawn ranges: deflect / skim instead of crossing straight through
    if (elev && crust && walked > stepBase * 2) {
      const turnPerPx = collisionTurn(
        x,
        y,
        heading,
        elev,
        crust,
        width,
        height,
        senseDist,
        preferSide,
      );
      dHeading += turnPerPx * stepUse;
      // Soften planned curvature when strongly colliding so dodge dominates
      if (Math.abs(turnPerPx) > 0.02) {
        dHeading -= kappa * stepUse * Math.min(0.7, Math.abs(turnPerPx) * 12);
      }
    }

    let nextUnwrapped = headingUnwrapped + dHeading;
    const bend = nextUnwrapped - heading0;
    if (bend > maxBend) {
      kappa = -Math.abs(kappa);
      kappaTo = kappa;
      kappaFrom = kappa;
      flipStart = -1;
      nextUnwrapped = heading0 + maxBend;
    } else if (bend < -maxBend) {
      kappa = Math.abs(kappa);
      kappaTo = kappa;
      kappaFrom = kappa;
      flipStart = -1;
      nextUnwrapped = heading0 - maxBend;
    }
    headingUnwrapped = nextUnwrapped;
    heading = headingUnwrapped;

    raw.push({ x: wrapX(x, width), y });
    x += Math.cos(heading) * stepUse;
    y += Math.sin(heading) * stepUse;
    if (y < 2) {
      y = 2;
      headingUnwrapped = heading0;
      heading = heading0;
      kappa = Math.abs(kappa);
    } else if (y > height - 3) {
      y = height - 3;
      headingUnwrapped = heading0;
      heading = heading0;
      kappa = -Math.abs(kappa);
    }
    x = wrapX(x, width);
    walked += stepUse;
    i++;

    if (walked > targetLen * 0.5) {
      const back = Math.hypot(wrapDx(startX, x, width), y - startY);
      if (back < stepUse * 2.5) break;
    }
  }

  const nPts = raw.length;
  const points: CordilleraPoint[] = raw.map((p, idx) => {
    const t = nPts <= 1 ? 0.5 : idx / (nPts - 1);
    const profile = curveProfile(t, wVar, seed);
    return {
      x: p.x,
      y: p.y,
      weight: baseW * profile,
      crest: crestHeightProfile(t, cVar, seed),
    };
  });
  if (points.length > 0) {
    points[0].weight = 0;
    points[points.length - 1].weight = 0;
    points[0].crest = 0;
    points[points.length - 1].crest = 0;
  }

  return { era, points };
}

/** Short off-axis secondary ridge (sub-cordillera) along curve parameter t. */
interface FalloffSpur {
  tC: number;
  halfLen: number;
  uCrest: number;
  uHalf: number;
  side: number;
  height: number;
}

/** Sub-cordilleras: `jagged` ≈ count/strength, `jaggedVar` ≈ placement/size diversity along t. */
function buildFalloffSpurs(
  seed: number,
  jagged: number,
  jaggedVar: number,
): FalloffSpur[] {
  const j = Math.max(0, Math.min(1, jagged));
  if (j < 0.03) return [];
  const varN = Math.max(0, Math.min(1, jaggedVar));
  // Count from jagged; variability spreads lengths/offsets, not the count itself
  const n = Math.max(1, Math.round(1 + j * 12));
  const spurs: FalloffSpur[] = [];
  for (let k = 0; k < n; k++) {
    // Low var → similar, evenly-ish; high var → wild lengths / uCrest / sides
    const evenT = (k + 0.5) / n;
    const tJitter = (rand01(seed, 200 + k * 3) - 0.5) * varN * 0.9;
    spurs.push({
      tC: Math.max(0.05, Math.min(0.95, evenT * 0.9 + 0.05 + tJitter)),
      halfLen:
        (0.035 + 0.02 * (1 - varN) + 0.1 * varN * rand01(seed, 201 + k * 3)) *
        (0.7 + 0.3 * j),
      uCrest:
        0.28 +
        (1 - varN) * 0.12 +
        varN * 0.48 * rand01(seed, 202 + k * 3),
      uHalf: 0.1 + (1 - varN) * 0.04 + varN * 0.14 * rand01(seed, 203 + k * 3),
      side: rand01(seed, 204 + k * 3) > 0.5 ? 1 : -1,
      height: (0.5 + 0.45 * j) * (0.85 + 0.3 * (1 - varN) + varN * 0.5 * rand01(seed, 205 + k * 3)),
    });
  }
  return spurs;
}

/**
 * Order: base → subcordilleras (jagged nº + var) → light transversal fuzzy that drifts with t.
 */
function transverseFalloff(
  u: number,
  tAlong: number,
  shape: number,
  jagged: number,
  jaggedVar: number,
  seed: number,
  side: number,
  spurs: FalloffSpur[],
): number {
  if (u <= 0) return 1;
  if (u >= 1) return 0;

  const shapeT = Math.max(
    0,
    Math.min(1, shape + 0.25 * (sampleCylinder(tAlong * 2.2, 0.2, 2.4, 2, seed + 3) - 0.5)),
  );
  const j = Math.max(0, Math.min(1, jagged));
  const varN = Math.max(0, Math.min(1, jaggedVar));

  const soft = Math.cos(u * Math.PI * 0.5);
  const power = 1.15 + shapeT * 3.6;
  const sharp = Math.pow(1 - u, power);
  let f = soft * (1 - shapeT) + sharp * shapeT;

  // 1) Subcordilleras (jagged = how many; var = how diverse along t)
  if (spurs.length > 0 && j > 0.02) {
    const mid = Math.sin(u * Math.PI);
    f *= Math.max(0.4, 1 - j * 0.25 * mid);

    let spurF = 0;
    for (let k = 0; k < spurs.length; k++) {
      const sp = spurs[k];
      if (sp.side !== side) continue;
      const dt = (tAlong - sp.tC) / Math.max(1e-4, sp.halfLen);
      if (dt * dt > 5) continue;
      const du = (u - sp.uCrest) / Math.max(1e-4, sp.uHalf);
      const wT = Math.exp(-dt * dt);
      const wU = Math.exp(-du * du);
      const separate = Math.min(1, u / 0.08) * Math.min(1, (1 - u) / 0.07);
      spurF = Math.max(spurF, sp.height * wT * wU * separate);
    }
    f = Math.max(f, spurF);
  }

  // 2) Fuzzy: light random amplitude on flanks; character drifts along t (not rotating ribs)
  if (j > 0.02) {
    const mid = Math.sin(u * Math.PI);
    const sideOff = side >= 0 ? 0 : 19.7;
    // Slow drift of “grain” along t + fine noise in u (transversal)
    const grainT = sampleCylinder(tAlong * (1.5 + varN * 3) + sideOff, 0.3, 3.2, 2, seed + 15);
    const fuzzU = sampleCylinder(
      tAlong * 2.2 + grainT * 2 + sideOff,
      u * (2.0 + grainT),
      5.0,
      2,
      seed + 17,
    );
    f *= 1 + j * mid * (fuzzU - 0.5) * 0.18;
    f = Math.max(0, Math.min(1, f));
  }

  return Math.max(0, Math.min(1, f));
}

/** Scratch for polyline stamp (reused across cordilleras). */
let stampBlendW: Float32Array | null = null;
let stampLocalAdd: Float32Array | null = null;

function ensureStampScratch(n: number): void {
  if (!stampLocalAdd || stampLocalAdd.length !== n) {
    stampLocalAdd = new Float32Array(n);
    stampBlendW = new Float32Array(n);
  }
}

/**
 * Stamp cordillera: soft blend of all covering segments (not hard nearest).
 * Hard nearest caused straight Voronoi “cortes” between joints.
 */
function stampCordillera(
  cord: Cordillera,
  elev: Float32Array,
  eraField: Float32Array,
  age: Float32Array,
  width: number,
  height: number,
  peakM: number,
  baseW: number,
  ageFactor: number,
  falloffShape: number,
  falloffJagged: number,
  jaggedVariability: number,
  seed: number,
): void {
  const pts = cord.points;
  if (pts.length < 2) return;
  const invBase = 1 / Math.max(1e-3, baseW);
  const nSeg = pts.length - 1;
  const n = width * height;
  ensureStampScratch(n);
  const blendW = stampBlendW!;
  const localAdd = stampLocalAdd!;

  let maxW = 0;
  let yMin = height;
  let yMax = 0;
  for (const p of pts) {
    if (p.weight > maxW) maxW = p.weight;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  if (maxW < 0.5) return;
  const pad = Math.ceil(maxW) + 1;
  const y0 = Math.max(0, Math.floor(yMin - pad));
  const y1 = Math.min(height - 1, Math.ceil(yMax + pad));
  const spurs = buildFalloffSpurs(seed, falloffJagged, jaggedVariability);

  for (let y = y0; y <= y1; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      blendW[row + x] = 0;
      localAdd[row + x] = 0;
    }
  }

  for (let s = 0; s < nSeg; s++) {
    const a = pts[s];
    const b = pts[s + 1];
    const dx = wrapDx(a.x, b.x, width);
    const dy = b.y - a.y;
    const segLen2 = dx * dx + dy * dy;
    if (segLen2 < 1e-6) continue;
    const segMaxW = Math.max(a.weight, b.weight);
    if (segMaxW < 0.5) continue;
    const sPad = Math.ceil(segMaxW) + 1;
    const t0 = s / nSeg;

    const x0 = Math.floor(Math.min(a.x, a.x + dx) - sPad);
    const x1 = Math.ceil(Math.max(a.x, a.x + dx) + sPad);
    const sy0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - sPad));
    const sy1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + sPad));

    for (let y = sy0; y <= sy1; y++) {
      for (let xi = x0; xi <= x1; xi++) {
        const x = wrapX(xi, width);
        const qx = a.x + wrapDx(a.x, x, width);
        const qy = y;
        const rx = qx - a.x;
        const ry = qy - a.y;
        const u = Math.max(0, Math.min(1, (rx * dx + ry * dy) / segLen2));
        const cx = a.x + dx * u;
        const cy = a.y + dy * u;
        const dist = Math.hypot(qx - cx, qy - cy);
        const w = a.weight + (b.weight - a.weight) * u;
        if (w < 0.5 || dist >= w) continue;

        const uRad = dist / w;
        const tAlong = t0 + u / nSeg;
        const side = rx * dy - ry * dx >= 0 ? 1 : -1;
        const transverse = transverseFalloff(
          uRad,
          tAlong,
          falloffShape,
          falloffJagged,
          jaggedVariability,
          seed,
          side,
          spurs,
        );
        const crest = a.crest + (b.crest - a.crest) * u;
        const crestAxis = 1 + (crest - 1) * Math.pow(Math.max(0, 1 - uRad), 1.6);
        const addM = peakM * w * invBase * crestAxis * transverse;
        if (addM < 0.25) continue;

        // Soft coverage weight — overlaps blend across segment Voronoi edges
        const bw = (1 - uRad) * (1 - uRad);
        const i = y * width + x;
        localAdd[i] += addM * bw;
        blendW[i] += bw;
      }
    }
  }

  for (let y = y0; y <= y1; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const bw = blendW[i];
      if (bw < 1e-6) continue;
      const addM = localAdd[i] / bw;
      if (addM < 0.25) continue;
      const prev = eraField[i];
      if (addM <= prev) continue;
      eraField[i] = addM;
      elev[i] = Math.min(5500, elev[i] + (addM - prev));
      age[i] = Math.max(age[i], ageFactor * Math.min(1, addM / 1800));
    }
  }
}

/**
 * Erode relief proportional to how much higher a cell sits vs its surroundings.
 * Ring samples (8 dirs × 2 radii) — O(n), cheap even at 2k×1k.
 */
function erodeByProminence(
  elev: Float32Array,
  crust: Float32Array,
  age: Float32Array,
  eraUplifts: Float32Array[],
  width: number,
  height: number,
  wear: number,
): void {
  if (wear <= 1e-6) return;
  const n = width * height;
  const cut = new Float32Array(n);
  const rNear = 6;
  const rFar = 16;
  const k = wear * 0.55;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const e = elev[i];
      const c = crust[i];
      if (e <= c + 40) continue;

      let env = 0;
      let samples = 0;
      for (let a = 0; a < 8; a++) {
        const ang = (a * Math.PI) / 4;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        for (const r of [rNear, rFar]) {
          const xi = Math.floor(wrapX(x + ca * r, width));
          const yi = Math.max(0, Math.min(height - 1, Math.floor(y + sa * r)));
          env += elev[yi * width + xi];
          samples++;
        }
      }
      env /= samples;
      const prom = e - env;
      if (prom <= 0) continue;
      // Peaks / jagged spurs lose more; floors of valleys relative to ring keep more
      cut[i] = Math.min(e - c, prom * k);
    }
  }

  for (let i = 0; i < n; i++) {
    const d = cut[i];
    if (d < 0.05) continue;
    const before = elev[i];
    const after = before - d;
    elev[i] = after;
    const reliefBefore = before - crust[i];
    if (reliefBefore > 1e-3) {
      const scale = Math.max(0, (after - crust[i]) / reliefBefore);
      age[i] *= 0.85 + 0.15 * scale;
      for (const prev of eraUplifts) prev[i] *= scale;
    }
  }
}

/**
 * Stage 1 — crust platform + one cordillera curve per orogeny era.
 */
export const tectonicsStage: ProceduralStage = {
  id: 'tectonics',
  label: '1 · Tectónica',
  description: 'Plataforma cortical + cordilleras (curvas) por era',
  paramsKey: 'tectonics',
  async run(ctx: ProceduralContext) {
    const { width, height, params } = ctx;
    const elev = ctx.buffers.elevation as Float32Array;
    const crust = ctx.buffers.crust as Float32Array;
    const age = ctx.buffers.mountainAge as Float32Array;
    const t = params.tectonics;
    const n = width * height;
    elev.fill(0);
    crust.fill(0);
    age.fill(0);
    ctx.orogenyTraces = [];
    ctx.orogenyEraUplift = [];
    ctx.cordilleras = [];
    ctx.oceanElevShiftM = 0;

    const crustSeed = stageSeed(ctx, 50);
    const scale = Math.max(1.2, t.continentalScale);

    ctx.onLog?.('  tectónica: plataforma cortical…');
    if (ctx.onLog) await yieldFrame();

    for (let y = 0; y < height; y++) {
      const latN = height <= 1 ? 0 : (y / (height - 1)) * 2 - 1;
      const polar = Math.pow(Math.abs(latN), 2.2) * 0.05;
      for (let x = 0; x < width; x++) {
        const lon01 = x / width;
        const i = y * width + x;
        const n1 = sampleCylinder(lon01, latN, scale * 0.55, 3, crustSeed);
        const n2 = sampleCylinder(lon01, latN, scale * 1.05, 2, crustSeed + 3);
        const crustH = n1 * 0.75 + n2 * 0.25 - 0.46 + t.heightBias - polar;
        const m = crustNoiseToMeters(crustH);
        crust[i] = m;
        elev[i] = m;
      }
    }

    ctx.onLog?.('  plataforma lista');
    ctx.onPreview?.();
    if (ctx.onPreview) await yieldFrame();

    const count = Math.max(1, Math.min(12, Math.round(t.orogenyCount)));
    const uplift = Math.max(0.2, t.upliftStrength);
    const lengthFrac = Math.max(0.05, Math.min(1.2, t.cordilleraLength ?? 0.5));
    const widthFrac = Math.max(0.005, Math.min(0.25, t.cordilleraWidth ?? 0.18));
    const widthVar = Math.max(0, Math.min(1, t.cordilleraWidthVariability ?? 0.9));
    const crestVar = Math.max(0, Math.min(1, t.cordilleraCrestVariability ?? 0.9));
    const spacingVar = Math.max(0, Math.min(1, t.cordilleraNodeSpacingVar ?? 0.65));
    const lengthVar = Math.max(0, Math.min(1, t.cordilleraLengthVariability ?? 0.9));
    const fallShape = Math.max(0, Math.min(1, t.cordilleraFalloffShape ?? 0.95));
    const fallJagged = Math.max(0, Math.min(1, t.cordilleraFalloffJagged ?? 0.65));
    const jagVar = Math.max(0, Math.min(1, t.cordilleraJaggedVariability ?? 0.85));
    const meanderAvg = Math.max(0, Math.min(12, t.cordilleraMeander ?? 4));
    const perEra = Math.max(1, Math.min(8, Math.round(t.cordillerasPerEra ?? 1)));
    const eraUplifts: Float32Array[] = [];
    const cords: Cordillera[] = [];

    for (let era = 0; era < count; era++) {
      ctx.onLog?.(`  tectónica era ${era + 1}/${count} · ${perEra} cordillera(s)…`);
      if (ctx.onLog) await yieldFrame();

      const eraSeed = stageSeed(ctx, 100 + era * 17);
      const ageFactor = (era + 1) / count;
      const baseW = Math.max(4, widthFrac * Math.min(width, height));
      const eraField = new Float32Array(n);

      if (era > 0 && t.erosionWear > 0) {
        const wear = t.erosionWear * (0.35 + 0.2 / era);
        erodeByProminence(elev, crust, age, eraUplifts, width, height, wear);
      }

      for (let c = 0; c < perEra; c++) {
        const cSeed = eraSeed + c * 97;
        const lengthScale = 1 + (rand01(cSeed, 8) * 2 - 1) * lengthVar;
        // Peak varies a lot: weak stamps on deep crust stay submarine ridges
        const peakScale = 0.18 + Math.pow(rand01(cSeed, 12), 0.75) * 0.92;
        const peakM = uplift * 2000 * peakScale;
        const cord = generateCordilleraCurve(
          width,
          height,
          era + 1,
          cSeed,
          lengthFrac,
          lengthScale,
          widthFrac,
          widthVar,
          crestVar,
          spacingVar,
          meanderAvg,
          elev,
          crust,
        );
        stampCordillera(
          cord,
          elev,
          eraField,
          age,
          width,
          height,
          peakM,
          baseW,
          ageFactor,
          fallShape,
          fallJagged,
          jagVar,
          cSeed,
        );
        cords.push(cord);
      }
      eraUplifts.push(eraField);
      ctx.cordilleras = cords.slice();
      ctx.orogenyEraUplift = eraUplifts.slice();
      ctx.orogenyTraces = cords.map((c) => ({
        era: c.era,
        points: c.points.map((p) => ({ x: p.x, y: p.y })),
      }));
      ctx.onLog?.(`  era ${era + 1}: ${perEra} cordilleras stampadas`);
      ctx.onPreview?.();
      if (ctx.onPreview) await yieldFrame();
    }

    ctx.cordilleras = cords;
    ctx.orogenyEraUplift = eraUplifts;
    // Legacy traces = centerlines (no weights) for any old overlay code
    ctx.orogenyTraces = cords.map((c) => ({
      era: c.era,
      points: c.points.map((p) => ({ x: p.x, y: p.y })),
    }));

    let eMin = Infinity;
    let eMax = -Infinity;
    let land = 0;
    for (let i = 0; i < n; i++) {
      const e = elev[i];
      if (e < eMin) eMin = e;
      if (e > eMax) eMax = e;
      if (e > 0) land++;
    }
    ctx.onLog?.(
      `  tectónica lista · ${cords.length} cordilleras (${count}×${perEra}) · ${(100 * land) / n}% tierra · elev [${eMin.toFixed(0)} … ${eMax.toFixed(0)}] m`,
    );
  },
};
