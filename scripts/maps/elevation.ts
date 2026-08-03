import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { downloadFile, ensureDir, fileExists, lonLatFromPixel } from './util.js';

const TERRARIUM_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

function lonLatToTileXY(lon: number, lat: number, z: number): { tx: number; ty: number; px: number; py: number } {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = ((lon + 180) / 360) * n;
  const latRad = (clampedLat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tx = Math.min(n - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(n - 1, Math.max(0, Math.floor(y)));
  const px = Math.min(255, Math.max(0, Math.floor((x - tx) * 256)));
  const py = Math.min(255, Math.max(0, Math.floor((y - ty) * 256)));
  return { tx, ty, px, py };
}

function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

type TilePixels = { data: Buffer; width: number; height: number };

/**
 * Build equirectangular Int16 elevation (meters) by sampling Mapzen/AWS Terrarium tiles.
 * Source: https://github.com/tilezen/joerd/blob/master/docs/formats.md
 */
export async function buildElevationLayer(
  width: number,
  height: number,
  zoom: number,
  cacheDir: string,
): Promise<Int16Array> {
  await ensureDir(cacheDir);
  const tileCache = new Map<string, TilePixels>();
  const maxCachedTiles = zoom >= 6 ? 320 : zoom >= 5 ? 256 : 512;
  const n = 2 ** zoom;

  async function loadTile(tx: number, ty: number): Promise<TilePixels> {
    const key = `${zoom}/${tx}/${ty}`;
    const hit = tileCache.get(key);
    if (hit) {
      // refresh LRU order
      tileCache.delete(key);
      tileCache.set(key, hit);
      return hit;
    }

    const file = path.join(cacheDir, `${zoom}_${tx}_${ty}.png`);
    if (!(await fileExists(file))) {
      const url = `${TERRARIUM_BASE}/${zoom}/${tx}/${ty}.png`;
      await downloadFile(url, file, `terrarium ${key}`);
    }

    const { data, info } = await sharp(file)
      .ensureAlpha(0)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const tile: TilePixels = { data, width: info.width, height: info.height };
    tileCache.set(key, tile);
    while (tileCache.size > maxCachedTiles) {
      const oldest = tileCache.keys().next().value;
      if (oldest == null) break;
      tileCache.delete(oldest);
    }
    return tile;
  }

  // Prefetch: download PNGs to disk only (do not decode all into RAM — z6 = 4096 tiles)
  console.log(`  prefetching terrarium z=${zoom} (${n}×${n} tiles)…`);
  const coords: { tx: number; ty: number }[] = [];
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) coords.push({ tx, ty });
  }
  const concurrency = zoom >= 6 ? 12 : 8;
  let done = 0;
  for (let i = 0; i < coords.length; i += concurrency) {
    const batch = coords.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async ({ tx, ty }) => {
        const file = path.join(cacheDir, `${zoom}_${tx}_${ty}.png`);
        if (await fileExists(file)) {
          done++;
          return;
        }
        const url = `${TERRARIUM_BASE}/${zoom}/${tx}/${ty}.png`;
        let lastErr: unknown;
        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            const res = await fetch(url, {
              headers: { 'User-Agent': 'PixelWeb/0.1 (map build pipeline)' },
            });
            if (!res.ok) throw new Error(`Tile ${zoom}/${tx}/${ty} → ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            await fs.writeFile(file, buf);
            lastErr = undefined;
            break;
          } catch (err) {
            lastErr = err;
            const wait = 500 * attempt * attempt;
            console.warn(`\n  retry ${attempt}/5 tile ${zoom}/${tx}/${ty} in ${wait}ms`);
            await new Promise((r) => setTimeout(r, wait));
          }
        }
        if (lastErr) throw lastErr;
        done++;
      }),
    );
    process.stdout.write(`\r  tiles ${done}/${coords.length}`);
  }
  process.stdout.write('\n');

  const out = new Int16Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { lon, lat } = lonLatFromPixel(x + 0.5, y + 0.5, width, height);
      const { tx, ty, px, py } = lonLatToTileXY(lon, lat, zoom);
      const key = `${zoom}/${tx}/${ty}`;
      let tile = tileCache.get(key);
      if (!tile) {
        tile = await loadTile(tx, ty);
      }
      const i = (py * tile.width + px) * 4;
      const elev = decodeTerrarium(tile.data[i], tile.data[i + 1], tile.data[i + 2]);
      out[y * width + x] = Math.round(Math.max(-32768, Math.min(32767, elev)));
    }
    if (y % 64 === 0) process.stdout.write(`\r  sampling elevation ${y}/${height}`);
  }
  process.stdout.write(`\r  sampling elevation ${height}/${height}\n`);
  return out;
}

export async function writeElevationPreview(
  elev: Int16Array,
  width: number,
  height: number,
  dest: string,
): Promise<void> {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const e = elev[i];
    let r: number, g: number, b: number;
    if (e < 0) {
      const t = Math.max(0, Math.min(1, (e + 6000) / 6000));
      r = 10 + t * 20;
      g = 30 + t * 50;
      b = 80 + t * 100;
    } else {
      const t = Math.max(0, Math.min(1, e / 4000));
      r = 40 + t * 180;
      g = 90 + t * 100;
      b = 50 + (1 - t) * 40;
      if (e > 3500) {
        r = 230;
        g = 235;
        b = 240;
      }
    }
    const o = i * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  }
  await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(dest);
}
