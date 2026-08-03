import type Phaser from 'phaser';
import type { MapSettings } from '../../../shared/types';

export type Rgb = [number, number, number];

const EARTH_PALETTE: Rgb[] = [
  [18, 48, 92], // deep ocean
  [28, 78, 128], // ocean
  [52, 132, 168], // shallow
  [72, 168, 176], // coast water
  [212, 196, 140], // beach / arid
  [168, 148, 88], // scrub
  [92, 140, 72], // plains
  [56, 112, 56], // forest
  [40, 84, 48], // deep forest
  [120, 96, 64], // hills
  [96, 72, 48], // mountain
  [72, 64, 56], // rock
  [232, 236, 240], // snow
  [200, 208, 216], // ice
  [148, 168, 120], // tundra
];

const RETRO_PALETTE: Rgb[] = [
  [15, 56, 15],
  [48, 98, 48],
  [139, 172, 15],
  [155, 188, 15],
  [8, 24, 32],
  [48, 104, 80],
  [192, 160, 64],
  [224, 248, 208],
];

const MONO_PALETTE: Rgb[] = [
  [12, 16, 14],
  [36, 48, 42],
  [72, 92, 80],
  [120, 140, 124],
  [180, 196, 184],
  [232, 240, 234],
];

function paletteFor(name: MapSettings['palette']): Rgb[] {
  if (name === 'retro') return RETRO_PALETTE;
  if (name === 'mono') return MONO_PALETTE;
  return EARTH_PALETTE;
}

function dist2(a: Rgb, b: Rgb): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function nearest(color: Rgb, palette: Rgb[]): Rgb {
  let best = palette[0];
  let bestD = Infinity;
  for (const p of palette) {
    const d = dist2(color, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Hash noise 0..1 */
function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x: number, y: number, octaves = 5): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * smoothNoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Procedural equirectangular-ish Earth: ocean basins + continents via warped noise.
 * Generates at `genW`×`genH` then nearest-neighbor upscales to target size (faster).
 */
export function generateProceduralWorld(width: number, height: number): ImageData {
  const genW = Math.min(width, 2048);
  const genH = Math.min(height, 1024);
  const data = new Uint8ClampedArray(genW * genH * 4);

  for (let y = 0; y < genH; y++) {
    const lat = (y / (genH - 1)) * 2 - 1; // -1..1
    for (let x = 0; x < genW; x++) {
      const lon = x / genW;
      const n1 = fbm(lon * 3.2, lat * 2.4 + 10, 5);
      const n2 = fbm(lon * 6.1 + 20, lat * 4.2, 3);
      const ridge = 1 - Math.abs(2 * fbm(lon * 2.5, lat * 2.0 + 3, 4) - 1);
      let elev = n1 * 0.72 + n2 * 0.2 + ridge * 0.08;

      const polar = Math.pow(Math.abs(lat), 2.2);
      elev -= polar * 0.08;
      elev = elev * 1.15 - 0.42;

      let r: number;
      let g: number;
      let b: number;

      if (elev < -0.12) {
        const t = Math.max(0, Math.min(1, (elev + 0.45) / 0.33));
        r = 18 + t * 10;
        g = 48 + t * 30;
        b = 92 + t * 36;
      } else if (elev < 0) {
        r = 40 + elev * 40;
        g = 110 + elev * 80;
        b = 150;
      } else if (elev < 0.05) {
        r = 200;
        g = 186;
        b = 120;
      } else if (elev < 0.22) {
        const arid = fbm(lon * 8, lat * 6, 2);
        if (Math.abs(lat) < 0.35 && arid > 0.55) {
          r = 196;
          g = 168;
          b = 96;
        } else if (Math.abs(lat) > 0.55) {
          r = 150;
          g = 170;
          b = 130;
        } else {
          r = 70 + elev * 40;
          g = 130 + elev * 20;
          b = 60;
        }
      } else if (elev < 0.4) {
        r = 55;
        g = 100;
        b = 50;
      } else if (elev < 0.55) {
        r = 110;
        g = 90;
        b = 60;
      } else {
        r = 90;
        g = 80;
        b = 70;
      }

      if (polar > 0.72 || (elev > 0.48 && polar > 0.4)) {
        r = 220 + elev * 20;
        g = 228;
        b = 236;
      }

      const i = (y * genW + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }

  if (genW === width && genH === height) {
    return new ImageData(data, genW, genH);
  }

  // Nearest-neighbor upscale to target resolution
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(genH - 1, Math.floor((y * genH) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(genW - 1, Math.floor((x * genW) / width));
      const si = (sy * genW + sx) * 4;
      const di = (y * width + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = 255;
    }
  }
  return new ImageData(out, width, height);
}

async function loadImage(source: string | Blob | HTMLImageElement): Promise<HTMLImageElement> {
  if (source instanceof HTMLImageElement) {
    if (source.complete && source.naturalWidth) return source;
    await new Promise<void>((resolve, reject) => {
      source.onload = () => resolve();
      source.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    });
    return source;
  }

  const img = new Image();
  img.decoding = 'async';
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      img.src = url;
    });
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
  return img;
}

function drawSourceToSize(
  img: CanvasImageSource,
  width: number,
  height: number,
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Quantize + optional pixel-block upscale for crisp pixel art at high resolution.
 * `pixelScale` > 1 groups source samples into larger logical pixels then expands.
 */
export function toPixelArt(
  source: ImageData,
  settings: Pick<MapSettings, 'palette' | 'pixelScale'>,
): ImageData {
  const palette = paletteFor(settings.palette);
  const scale = Math.max(1, Math.floor(settings.pixelScale));
  const outW = source.width;
  const outH = source.height;
  const logicW = Math.max(1, Math.floor(outW / scale));
  const logicH = Math.max(1, Math.floor(outH / scale));
  const out = new Uint8ClampedArray(outW * outH * 4);

  // First pass: average each logical block → nearest palette color
  const colors: Rgb[] = new Array(logicW * logicH);

  for (let ly = 0; ly < logicH; ly++) {
    for (let lx = 0; lx < logicW; lx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const x0 = lx * scale;
      const y0 = ly * scale;
      const x1 = Math.min(outW, x0 + scale);
      const y1 = Math.min(outH, y0 + scale);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * outW + x) * 4;
          r += source.data[i];
          g += source.data[i + 1];
          b += source.data[i + 2];
          n++;
        }
      }
      const avg: Rgb = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
      colors[ly * logicW + lx] = nearest(avg, palette);
    }
  }

  // Expand logical pixels to full resolution (nearest neighbor)
  for (let y = 0; y < outH; y++) {
    const ly = Math.min(logicH - 1, Math.floor(y / scale));
    for (let x = 0; x < outW; x++) {
      const lx = Math.min(logicW - 1, Math.floor(x / scale));
      const c = colors[ly * logicW + lx];
      const i = (y * outW + x) * 4;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = 255;
    }
  }

  return new ImageData(out, outW, outH);
}

export interface PixelMapResult {
  imageData: ImageData;
  width: number;
  height: number;
  walkable: Uint8Array; // 1 = land, 0 = water (approx)
}

function buildWalkable(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData;
  const walk = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    // Heuristic: blues with low green relative → water
    const isWater = b > r + 20 && b > g + 10 && b > 80;
    walk[i] = isWater ? 0 : 1;
  }
  return walk;
}

export async function buildPixelMap(
  settings: MapSettings,
  source?: string | Blob | HTMLImageElement | null,
  onProgress?: (msg: string) => void,
): Promise<PixelMapResult> {
  const width = settings.width;
  const height = settings.height;

  onProgress?.('Generando / escalando mapa…');
  let raw: ImageData;
  if (source) {
    const img = await loadImage(source);
    raw = drawSourceToSize(img, width, height);
  } else {
    // Generate at logical size then we still quantize
    raw = generateProceduralWorld(width, height);
  }

  onProgress?.('Convirtiendo a pixel art…');
  // For uploaded maps, pixelScale 2–4 makes chunks chunkier while keeping canvas size huge
  const imageData = toPixelArt(raw, settings);
  const walkable = buildWalkable(imageData);

  return { imageData, width, height, walkable };
}

export function imageDataToTextureKey(
  scene: Phaser.Scene,
  key: string,
  imageData: ImageData,
): string {
  if (scene.textures.exists(key)) {
    scene.textures.remove(key);
  }
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  scene.textures.addCanvas(key, canvas);
  return key;
}
