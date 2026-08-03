/**
 * ESA CCI / C3S Land Cover 300m (LCCS class codes) via Planetary Computer COGs.
 * Tiles are 45°×45°; we window-read each into the equirectangular game grid.
 */

import { fromUrl, type GeoTIFFImage } from 'geotiff';
import { lonLatFromPixel } from './util.js';

const YEAR = 2020;
const VERSION = 'v2.1.1';
const PC_SIGN = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign';
const BLOB = 'https://landcoverdata.blob.core.windows.net/esa-cci-lc/cog';

const LAT0S = [-90, -45, 0, 45] as const;
const LON0S = [-180, -135, -90, -45, 0, 45, 90, 135] as const;

function tileKey(lat0: number, lon0: number): string {
  const latStr =
    lat0 < 0 ? `S${String(Math.abs(lat0)).padStart(2, '0')}` : `N${String(lat0).padStart(2, '0')}`;
  const lonStr =
    lon0 < 0 ? `W${String(Math.abs(lon0)).padStart(3, '0')}` : `E${String(lon0).padStart(3, '0')}`;
  return `${latStr}${lonStr}`;
}

function tileUrl(key: string): string {
  return `${BLOB}/${VERSION}/${key}/${YEAR}/C3S-LC-L4-LCCS-Map-300m-P1Y-${YEAR}-${VERSION}-${key}-lccs_class.tif`;
}

async function signHref(href: string): Promise<string> {
  const url = `${PC_SIGN}?href=${encodeURIComponent(href)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PC SAS sign failed ${res.status} for ${href}`);
  const json = (await res.json()) as { href: string };
  return json.href;
}

async function readTileWindow(
  signedUrl: string,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const tiff = await fromUrl(signedUrl);
  // Prefer a coarse overview if available (much faster for our ~512² reads)
  const count = await tiff.getImageCount();
  let image: GeoTIFFImage = await tiff.getImage(0);
  for (let i = count - 1; i >= 0; i--) {
    const cand = await tiff.getImage(i);
    if (cand.getWidth() >= width && cand.getHeight() >= height) {
      image = cand;
      break;
    }
  }

  const rasters = await image.readRasters({
    width,
    height,
    resampleMethod: 'nearest',
    fillValue: 0,
  });
  const band = rasters[0] as ArrayLike<number>;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = Number(band[i]) & 0xff;
  return out;
}

/**
 * Build global equirectangular cover_raw with ESA CCI LCCS class codes (uint8).
 */
export async function buildCciLandCover(
  width: number,
  height: number,
): Promise<Uint8Array> {
  const out = new Uint8Array(width * height);
  const tiles: { lat0: number; lon0: number; key: string }[] = [];
  for (const lat0 of LAT0S) {
    for (const lon0 of LON0S) {
      tiles.push({ lat0, lon0, key: tileKey(lat0, lon0) });
    }
  }

  console.log(`  ESA CCI LC 300m (${YEAR}): ${tiles.length} tiles → ${width}×${height}`);

  let done = 0;
  const concurrency = 4;
  for (let i = 0; i < tiles.length; i += concurrency) {
    const batch = tiles.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async ({ lat0, lon0, key }) => {
        const lon1 = lon0 + 45;
        const lat1 = lat0 + 45;

        // Pixel ranges in output (equirect: y=0 at north)
        const x0 = Math.round(((lon0 + 180) / 360) * width);
        const x1 = Math.round(((lon1 + 180) / 360) * width);
        const y0 = Math.round(((90 - lat1) / 180) * height);
        const y1 = Math.round(((90 - lat0) / 180) * height);
        const tw = Math.max(1, x1 - x0);
        const th = Math.max(1, y1 - y0);

        const href = tileUrl(key);
        const signed = await signHref(href);
        let tileData: Uint8Array;
        try {
          tileData = await readTileWindow(signed, tw, th);
        } catch (err) {
          console.warn(`\n  warn: tile ${key} failed (${String(err)}), filling 0`);
          tileData = new Uint8Array(tw * th);
        }

        for (let ty = 0; ty < th; ty++) {
          const dy = y0 + ty;
          if (dy < 0 || dy >= height) continue;
          for (let tx = 0; tx < tw; tx++) {
            const dx = x0 + tx;
            if (dx < 0 || dx >= width) continue;
            out[dy * width + dx] = tileData[ty * tw + tx];
          }
        }

        done++;
        process.stdout.write(`\r  cci tiles ${done}/${tiles.length}`);
      }),
    );
  }
  process.stdout.write('\n');

  // Sanity: sample a few pixels
  const sample = lonLatFromPixel(width * 0.5, height * 0.4, width, height);
  void sample;
  return out;
}

export const CCI_COVER_SOURCE =
  `ESA CCI/C3S Land Cover 300m LCCS ${YEAR} ${VERSION} (Planetary Computer COGs)`;
