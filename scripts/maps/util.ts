import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function downloadFile(url: string, dest: string, label: string): Promise<void> {
  if (await fileExists(dest)) {
    console.log(`  cache hit: ${label}`);
    return;
  }
  await ensureDir(path.dirname(dest));
  console.log(`  downloading ${label}…`);
  console.log(`    ${url}`);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'PixelWeb/0.1 (map build pipeline)' },
    redirect: 'follow',
  });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}) ${url}`);
  }

  const tmp = `${dest}.partial`;
  const fileStream = createWriteStream(tmp);
  // @ts-expect-error Node fetch body is web stream-compatible enough for pipeline in Node 20+
  await pipeline(Readable.fromWeb(res.body), fileStream);
  await fs.rename(tmp, dest);
  const stat = await fs.stat(dest);
  console.log(`  saved ${(stat.size / 1e6).toFixed(1)} MB → ${path.basename(dest)}`);
}

export function parseArgs(argv: string[]): {
  width: number;
  height: number;
  elevZoom: number;
  force: boolean;
  only: 'all' | 'hydro';
} {
  let width = 4096;
  let height: number | null = null;
  let elevZoom = 4;
  let force = false;
  let only: 'all' | 'hydro' = 'all';

  for (const a of argv) {
    if (a.startsWith('--width=')) width = Number(a.slice(8));
    else if (a.startsWith('--height=')) height = Number(a.slice(9));
    else if (a.startsWith('--elev-zoom=')) elevZoom = Number(a.slice(12));
    else if (a === '--force') force = true;
    else if (a === '--only=hydro') only = 'hydro';
  }

  if (!Number.isFinite(width) || width < 256) throw new Error('Invalid --width');
  const resolvedHeight =
    height != null && Number.isFinite(height) && height >= 128
      ? height
      : Math.round(width / 2);
  if (![3, 4, 5, 6].includes(elevZoom)) elevZoom = 4;

  return { width, height: resolvedHeight, elevZoom, force, only };
}

export function lonLatFromPixel(
  x: number,
  y: number,
  width: number,
  height: number,
): { lon: number; lat: number } {
  const lon = (x / width) * 360 - 180;
  const lat = 90 - (y / height) * 180;
  return { lon, lat };
}
