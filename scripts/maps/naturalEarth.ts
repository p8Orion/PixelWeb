import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { downloadFile, ensureDir, fileExists } from './util.js';

const NE_CANDIDATES = [
  'https://naciscdn.org/naturalearth/50m/raster/NE1_50M_SR_W.zip',
  'https://naturalearth.s3.amazonaws.com/50m_raster/NE1_50M_SR_W.zip',
];

async function findTiffInZip(zipPath: string, extractDir: string): Promise<string> {
  await ensureDir(extractDir);
  const marker = path.join(extractDir, '.extracted');
  if (!(await fileExists(marker))) {
    console.log('  extracting Natural Earth raster…');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);
    await fs.writeFile(marker, 'ok');
  }

  async function walk(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) files.push(...(await walk(p)));
      else files.push(p);
    }
    return files;
  }

  const files = await walk(extractDir);
  const tif =
    files.find((f) => /\.tif$/i.test(f) && /NE1/i.test(path.basename(f))) ||
    files.find((f) => /\.tif$/i.test(f));
  if (!tif) throw new Error('No GeoTIFF found inside Natural Earth zip');
  return tif;
}

/** Download NE1 shaded-relief+water and resize to equirect RGBA buffer. */
export async function loadNaturalEarthRgb(
  width: number,
  height: number,
  rawDir: string,
): Promise<Buffer> {
  const zipPath = path.join(rawDir, 'NE1_50M_SR_W.zip');
  const extractDir = path.join(rawDir, 'ne1_extract');

  let lastErr: unknown;
  for (const url of NE_CANDIDATES) {
    try {
      await downloadFile(url, zipPath, 'Natural Earth NE1 50m');
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`  NE download failed, trying mirror…`);
    }
  }
  if (lastErr) throw lastErr;

  const tif = await findTiffInZip(zipPath, extractDir);
  console.log(`  resampling ${path.basename(tif)} → ${width}×${height}`);

  const { data } = await sharp(tif)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return data;
}

/**
 * Optional override: drop a WorldCover (or any classified) GeoTIFF at
 * data/raw/worldcover.tif — single band uint8 with ESA codes.
 * Returns null if not present.
 */
export async function tryLoadWorldCoverOverride(
  width: number,
  height: number,
  rawDir: string,
): Promise<Uint8Array | null> {
  const candidates = ['worldcover.tif', 'worldcover.tiff', 'ESA_WorldCover.tif'];
  let found: string | null = null;
  for (const name of candidates) {
    const p = path.join(rawDir, name);
    if (await fileExists(p)) {
      found = p;
      break;
    }
  }
  if (!found) return null;

  console.log(`  using WorldCover override: ${path.basename(found)}`);
  // geotiff for single-band; sharp also reads many GeoTIFFs
  const { data, info } = await sharp(found)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest })
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels === 1) {
    return new Uint8Array(data.buffer, data.byteOffset, width * height);
  }

  // If RGB slipped in, take R channel
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    out[i] = data[i * info.channels];
  }
  return out;
}
