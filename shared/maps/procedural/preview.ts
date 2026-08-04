/**
 * Buffer → RGBA for the generator lab (no tiles).
 * Biomes not ready yet → generic WATER / GRASSLAND from mask/elev.
 */

import { LANDCOVER, previewRgbForCell } from '../game.js';
import type { ProceduralContext } from './context.js';
import { listStages } from './stages/index.js';

/**
 * Fixed elevation → color key (meters). Used by preview + legend UI.
 * Stops are absolute; values outside clamp to ends.
 */
export const ELEVATION_COLOR_KEY: Array<{
  meters: number;
  label: string;
  rgb: [number, number, number];
}> = [
  { meters: -5000, label: '−5000 m', rgb: [8, 20, 48] },
  { meters: -2000, label: '−2000 m', rgb: [14, 42, 78] },
  { meters: -200, label: '−200 m', rgb: [30, 90, 140] },
  { meters: -1, label: '−1 m', rgb: [45, 120, 160] },
  // 0 m = costa / tierra — never ocean-blue (that made land look like water)
  { meters: 0, label: '0 m costa', rgb: [210, 190, 130] },
  { meters: 80, label: '80 m', rgb: [140, 160, 85] },
  { meters: 300, label: '300 m', rgb: [90, 140, 70] },
  { meters: 1000, label: '1000 m', rgb: [70, 120, 55] },
  { meters: 2000, label: '2000 m', rgb: [110, 95, 70] },
  { meters: 3500, label: '3500 m', rgb: [140, 130, 120] },
  { meters: 5000, label: '5000 m', rgb: [230, 235, 240] },
];

/** Absolute °C stops for temperature preview + legend. */
export const TEMPERATURE_COLOR_KEY: Array<{
  celsius: number;
  label: string;
  rgb: [number, number, number];
}> = [
  { celsius: -40, label: '−40 °C', rgb: [20, 30, 120] },
  { celsius: -20, label: '−20 °C', rgb: [40, 80, 180] },
  { celsius: -5, label: '−5 °C', rgb: [100, 160, 220] },
  { celsius: 5, label: '5 °C', rgb: [160, 210, 200] },
  { celsius: 15, label: '15 °C', rgb: [180, 210, 100] },
  { celsius: 22, label: '22 °C', rgb: [220, 200, 70] },
  { celsius: 30, label: '30 °C', rgb: [220, 120, 40] },
  { celsius: 40, label: '40 °C', rgb: [180, 40, 30] },
];

/** Precipitation 0–1 stops for tint overlay + legend. */
export const PRECIPITATION_COLOR_KEY: Array<{
  amount: number;
  label: string;
  rgb: [number, number, number];
}> = [
  { amount: 0, label: 'seco', rgb: [180, 140, 70] },
  { amount: 0.25, label: 'bajo', rgb: [140, 160, 80] },
  { amount: 0.5, label: 'medio', rgb: [70, 140, 120] },
  { amount: 0.75, label: 'alto', rgb: [40, 100, 180] },
  { amount: 1, label: 'muy húmedo', rgb: [30, 60, 160] },
];

/** Grayscale height stops for climate overlay backgrounds (temp/precip). */
export const ELEVATION_GRAY_KEY: Array<{
  meters: number;
  label: string;
  gray: number;
}> = [
  { meters: -5000, label: '−5000 m', gray: 18 },
  { meters: -200, label: '−200 m', gray: 40 },
  { meters: -1, label: '−1 m', gray: 55 },
  { meters: 0, label: '0 m costa', gray: 95 },
  { meters: 300, label: '300 m', gray: 125 },
  { meters: 1000, label: '1000 m', gray: 155 },
  { meters: 2500, label: '2500 m', gray: 190 },
  { meters: 5000, label: '5000 m', gray: 235 },
];

function colorForElevationM(meters: number): [number, number, number] {
  const key = ELEVATION_COLOR_KEY;
  if (meters <= key[0].meters) return key[0].rgb;
  if (meters >= key[key.length - 1].meters) return key[key.length - 1].rgb;
  for (let i = 0; i < key.length - 1; i++) {
    const a = key[i];
    const b = key[i + 1];
    if (meters >= a.meters && meters <= b.meters) {
      const t = (meters - a.meters) / (b.meters - a.meters || 1);
      return [
        Math.round(lerp(a.rgb[0], b.rgb[0], t)),
        Math.round(lerp(a.rgb[1], b.rgb[1], t)),
        Math.round(lerp(a.rgb[2], b.rgb[2], t)),
      ];
    }
  }
  return key[key.length - 1].rgb;
}

function colorForElevationGrayM(meters: number): [number, number, number] {
  const key = ELEVATION_GRAY_KEY;
  let g = key[key.length - 1].gray;
  if (meters <= key[0].meters) g = key[0].gray;
  else if (meters < key[key.length - 1].meters) {
    for (let i = 0; i < key.length - 1; i++) {
      const a = key[i];
      const b = key[i + 1];
      if (meters >= a.meters && meters <= b.meters) {
        const t = (meters - a.meters) / (b.meters - a.meters || 1);
        g = Math.round(lerp(a.gray, b.gray, t));
        break;
      }
    }
  }
  return [g, g, g];
}

function colorForTempC(celsius: number): [number, number, number] {
  const key = TEMPERATURE_COLOR_KEY;
  if (celsius <= key[0].celsius) return key[0].rgb;
  if (celsius >= key[key.length - 1].celsius) return key[key.length - 1].rgb;
  for (let i = 0; i < key.length - 1; i++) {
    const a = key[i];
    const b = key[i + 1];
    if (celsius >= a.celsius && celsius <= b.celsius) {
      const t = (celsius - a.celsius) / (b.celsius - a.celsius || 1);
      return [
        Math.round(lerp(a.rgb[0], b.rgb[0], t)),
        Math.round(lerp(a.rgb[1], b.rgb[1], t)),
        Math.round(lerp(a.rgb[2], b.rgb[2], t)),
      ];
    }
  }
  return key[key.length - 1].rgb;
}

function colorForPrecip(amount: number): [number, number, number] {
  const key = PRECIPITATION_COLOR_KEY;
  const a0 = Math.max(0, Math.min(1, amount));
  if (a0 <= key[0].amount) return key[0].rgb;
  if (a0 >= key[key.length - 1].amount) return key[key.length - 1].rgb;
  for (let i = 0; i < key.length - 1; i++) {
    const a = key[i];
    const b = key[i + 1];
    if (a0 >= a.amount && a0 <= b.amount) {
      const t = (a0 - a.amount) / (b.amount - a.amount || 1);
      return [
        Math.round(lerp(a.rgb[0], b.rgb[0], t)),
        Math.round(lerp(a.rgb[1], b.rgb[1], t)),
        Math.round(lerp(a.rgb[2], b.rgb[2], t)),
      ];
    }
  }
  return key[key.length - 1].rgb;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function ramp(
  t: number,
  stops: Array<[number, number, number]>,
): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  if (stops.length === 1) return stops[0];
  const i = Math.min(stops.length - 2, Math.floor(x * (stops.length - 1)));
  const f = x * (stops.length - 1) - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(lerp(a[0], b[0], f)),
    Math.round(lerp(a[1], b[1], f)),
    Math.round(lerp(a[2], b[2], f)),
  ];
}

function minMax(data: Float32Array | Uint8Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  if (min === max) return { min, max: min + 1 };
  return { min, max };
}

function biomesDone(ctx: ProceduralContext): boolean {
  const biomesIdx = listStages().findIndex((s) => s.id === 'biomes');
  return biomesIdx >= 0 && ctx.completedThrough >= biomesIdx;
}

function oceanDone(ctx: ProceduralContext): boolean {
  const idx = listStages().findIndex((s) => s.id === 'ocean');
  return idx >= 0 && ctx.completedThrough >= idx;
}

/** Land/sea for preview before biomes exist. */
export function isLandCell(ctx: ProceduralContext, i: number): boolean {
  const mask = ctx.buffers.landmask as Uint8Array | undefined;
  const elev = ctx.buffers.elevation as Float32Array;
  if (oceanDone(ctx) && mask) return mask[i] === 1;
  return elev[i] > 0;
}

function coverForPreview(ctx: ProceduralContext, i: number): number {
  if (biomesDone(ctx)) {
    return (ctx.buffers.landcover as Uint8Array)[i];
  }
  return isLandCell(ctx, i) ? LANDCOVER.GRASSLAND : LANDCOVER.WATER;
}

export function defaultBufferForStage(stageId: string): string {
  switch (stageId) {
    case 'tectonics':
      return 'elevation';
    case 'ocean':
      return 'elevation';
    case 'climate':
      return 'wind';
    case 'rivers':
      return 'river';
    case 'biomes':
      return 'landcover';
    default:
      return 'elevation';
  }
}

export function renderBufferPreview(
  ctx: ProceduralContext,
  bufferId: string,
  out: Uint8ClampedArray,
): void {
  const { width, height, buffers } = ctx;
  const n = width * height;
  if (out.length < n * 4) throw new Error('preview buffer too small');

  // Vector views: true elevation under arrows (landmask / elev>0 for land).
  // Do NOT remap elev−sea through the elev key — 0 m in that key is ocean-blue and
  // makes lowlands look like water basins.
  if (bufferId === 'wind' || bufferId === 'currents') {
    const elev = buffers.elevation as Float32Array;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = colorForElevationM(elev[i]);
      const o = i * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
    return;
  }

  if (bufferId === 'landcover') {
    const elev = buffers.elevation as Float32Array;
    for (let i = 0; i < n; i++) {
      const cover = coverForPreview(ctx, i);
      const [r, g, b] = previewRgbForCell(cover, elev[i] | 0, isLandCell(ctx, i));
      const o = i * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
    return;
  }

  if (bufferId === 'landmask') {
    // Same language as elev key: blue = water, green = land
    for (let i = 0; i < n; i++) {
      const land = isLandCell(ctx, i);
      const o = i * 4;
      out[o] = land ? 110 : 30;
      out[o + 1] = land ? 150 : 90;
      out[o + 2] = land ? 75 : 150;
      out[o + 3] = 255;
    }
    return;
  }

  if (bufferId === 'river') {
    const river = buffers.river as Uint8Array;
    const elev = buffers.elevation as Float32Array;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (!isLandCell(ctx, i)) {
        const [r, g, b] = previewRgbForCell(LANDCOVER.WATER, elev[i] | 0, false);
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
      } else if (river[i] > 0) {
        const t = Math.min(1, river[i] / 180);
        out[o] = Math.round(40 + t * 20);
        out[o + 1] = Math.round(90 + t * 60);
        out[o + 2] = Math.round(160 + t * 60);
      } else {
        const [r, g, b] = previewRgbForCell(LANDCOVER.GRASSLAND, elev[i] | 0, true);
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
      }
      out[o + 3] = 255;
    }
    return;
  }

  const data = buffers[bufferId];
  if (!data) {
    out.fill(0);
    return;
  }

  if (bufferId === 'elevation' || bufferId === 'crust') {
    for (let i = 0; i < n; i++) {
      const [r, g, b] = colorForElevationM(data[i]);
      const o = i * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
    return;
  }

  // Grayscale height base for climate overlays (temp / precip)
  if (bufferId === 'elevationGray') {
    const elev = buffers.elevation as Float32Array;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = colorForElevationGrayM(elev[i]);
      const o = i * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
    return;
  }

  if (bufferId === 'temp') {
    const alpha = 150;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = colorForTempC(data[i]);
      const o = i * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = alpha;
    }
    return;
  }

  if (bufferId === 'precip') {
    const alpha = 150;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = colorForPrecip(data[i]);
      const o = i * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = alpha;
    }
    return;
  }

  const { min, max } = minMax(data);
  const ageStops: Array<[number, number, number]> = [
    [40, 40, 50],
    [180, 100, 60],
    [240, 220, 120],
  ];

  for (let i = 0; i < n; i++) {
    const t = (data[i] - min) / (max - min || 1);
    const [r, g, b] = ramp(t, ageStops);
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
}

export type VectorField = 'wind' | 'currents';

/** Distinct colors per orogeny era (lab views). */
export const OROGENY_LINE_COLORS: string[] = [
  '#ff6b35',
  '#f7c948',
  '#7bdff2',
  '#c77dff',
  '#ff8fab',
  '#06d6a0',
  '#ef476f',
  '#4cc9f0',
];

/** Parse #rrggbb → RGB. */
function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Orogeny lab view: grayscale crust + influence areas from each cordillera curve
 * (falloff by per-vertex weight) + centerlines drawn separately on overlay.
 */
export function renderOrogenyPreview(ctx: ProceduralContext, out: Uint8ClampedArray): void {
  const { width, height, buffers } = ctx;
  const n = width * height;
  const crust = buffers.crust as Float32Array;
  const cords = ctx.cordilleras ?? [];
  if (out.length < n * 4) throw new Error('preview buffer too small');

  // Start from gray crust
  for (let i = 0; i < n; i++) {
    const [r, g, b] = colorForElevationGrayM(crust[i]);
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }

  const wrapDxLocal = (ax: number, bx: number) => {
    let dx = bx - ax;
    if (dx > width / 2) dx -= width;
    if (dx < -width / 2) dx += width;
    return dx;
  };
  const wrapXLocal = (x: number) => ((x % width) + width) % width;

  // Paint influence via polyline distance (same body as elev stamp)
  for (const cord of cords) {
    const [er, eg, eb] = hexRgb(OROGENY_LINE_COLORS[(cord.era - 1) % OROGENY_LINE_COLORS.length]);
    const pts = cord.points;
    const nSeg = pts.length - 1;
    const best = new Float32Array(n);
    best.fill(1e9);
    const alphaArr = new Float32Array(n);

    for (let s = 0; s < nSeg; s++) {
      const a = pts[s];
      const b = pts[s + 1];
      const dx = wrapDxLocal(a.x, b.x);
      const dy = b.y - a.y;
      const segLen2 = dx * dx + dy * dy;
      if (segLen2 < 1e-6) continue;
      const maxW = Math.max(a.weight, b.weight);
      const pad = Math.ceil(maxW) + 1;
      const x0 = Math.floor(Math.min(a.x, a.x + dx) - pad);
      const x1 = Math.ceil(Math.max(a.x, a.x + dx) + pad);
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - pad));
      const y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + pad));

      for (let y = y0; y <= y1; y++) {
        for (let xi = x0; xi <= x1; xi++) {
          const x = wrapXLocal(xi);
          const qx = a.x + wrapDxLocal(a.x, x);
          const qy = y;
          const t = Math.max(
            0,
            Math.min(1, ((qx - a.x) * dx + (qy - a.y) * dy) / segLen2),
          );
          const cx = a.x + dx * t;
          const cy = a.y + dy * t;
          const dist = Math.hypot(qx - cx, qy - cy);
          const w = a.weight + (b.weight - a.weight) * t;
          if (dist >= w || w < 1e-3) continue;
          const i = y * width + x;
          if (dist >= best[i]) continue;
          best[i] = dist;
          const fall = 1 - dist / w;
          alphaArr[i] = 0.12 + 0.5 * fall * fall;
        }
      }
    }

    for (let i = 0; i < n; i++) {
      const alpha = alphaArr[i];
      if (alpha < 1e-4) continue;
      const o = i * 4;
      out[o] = Math.round(out[o] * (1 - alpha) + er * alpha);
      out[o + 1] = Math.round(out[o + 1] * (1 - alpha) + eg * alpha);
      out[o + 2] = Math.round(out[o + 2] * (1 - alpha) + eb * alpha);
    }
  }
}

/** Draw cordillera centerlines (and soft weight halo) onto overlay canvas. */
export function drawCordilleraOverlay(
  ctx: ProceduralContext,
  g: CanvasRenderingContext2D,
): void {
  const cords = ctx.cordilleras;
  if (!cords?.length) return;
  const width = ctx.width;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  for (const cord of cords) {
    const pts = cord.points;
    if (pts.length < 2) continue;
    const color = OROGENY_LINE_COLORS[(cord.era - 1) % OROGENY_LINE_COLORS.length];

    // Influence outline: variable-width stroke ≈ 2× weight
    g.strokeStyle = color;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      let dx = b.x - a.x;
      if (Math.abs(dx) > width / 2) continue; // seam break
      g.globalAlpha = 0.22;
      g.lineWidth = Math.max(2, (a.weight + b.weight));
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }

    // Centerline
    g.globalAlpha = 0.95;
    g.lineWidth = Math.max(2, Math.min(ctx.width, ctx.height) * 0.0035);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (Math.abs(b.x - a.x) > width / 2) {
        g.stroke();
        g.beginPath();
        g.moveTo(b.x, b.y);
        continue;
      }
      g.lineTo(b.x, b.y);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** @deprecated legacy name — centerline traces only. */
export function drawOrogenyOverlay(
  ctx: ProceduralContext,
  g: CanvasRenderingContext2D,
): void {
  drawCordilleraOverlay(ctx, g);
}

/** Draw sampled arrows for wind or ocean currents onto a 2d context (map pixel space). */
export function drawVectorOverlay(
  ctx: ProceduralContext,
  field: VectorField,
  g: CanvasRenderingContext2D,
): void {
  const { width, height, buffers } = ctx;
  const uBuf = (field === 'wind' ? buffers.windU : buffers.currentU) as Float32Array;
  const vBuf = (field === 'wind' ? buffers.windV : buffers.currentV) as Float32Array;
  if (!uBuf || !vBuf) return;

  const step = Math.max(24, Math.floor(Math.min(width, height) / 32));
  let maxMag = 0.001;
  for (let y = step / 2; y < height; y += step) {
    for (let x = step / 2; x < width; x += step) {
      const i = (y | 0) * width + (x | 0);
      if (field === 'currents' && isLandCell(ctx, i)) continue;
      const mag = Math.hypot(uBuf[i], vBuf[i]);
      if (mag > maxMag) maxMag = mag;
    }
  }

  g.clearRect(0, 0, width, height);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  for (let y = step / 2; y < height; y += step) {
    for (let x = step / 2; x < width; x += step) {
      const ix = x | 0;
      const iy = y | 0;
      const i = iy * width + ix;
      if (field === 'currents' && isLandCell(ctx, i)) continue;
      const u = uBuf[i];
      const v = vBuf[i];
      const mag = Math.hypot(u, v);
      if (mag < 0.02) continue;

      const len = (0.35 + 0.65 * (mag / maxMag)) * step * 0.85;
      const ang = Math.atan2(v, u);
      const x1 = ix;
      const y1 = iy;
      const x2 = ix + Math.cos(ang) * len;
      const y2 = iy + Math.sin(ang) * len;

      g.strokeStyle =
        field === 'wind' ? 'rgba(240, 245, 255, 0.85)' : 'rgba(120, 210, 255, 0.9)';
      g.fillStyle = g.strokeStyle;
      g.lineWidth = Math.max(1, step * 0.06);

      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();

      const head = Math.max(4, len * 0.28);
      const a1 = ang + Math.PI * 0.8;
      const a2 = ang - Math.PI * 0.8;
      g.beginPath();
      g.moveTo(x2, y2);
      g.lineTo(x2 + Math.cos(a1) * head, y2 + Math.sin(a1) * head);
      g.lineTo(x2 + Math.cos(a2) * head, y2 + Math.sin(a2) * head);
      g.closePath();
      g.fill();
    }
  }
}
