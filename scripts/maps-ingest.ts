/**
 * maps:ingest — download/resample only.
 * Writes neutral channels (no basemap). Use --world= to pick output tree.
 *
 *   npm run maps:ingest
 *   npm run maps:ingest -- --world=earth3x --force
 *   npm run maps:ingest -- --width=4096 --elev-zoom=4 --force
 *   npm run maps:ingest -- --only=hydro
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IngestedWorldMeta } from '../shared/maps/ingest.js';
import { getMapWorld, MAP_WORLD_DEFAULT } from '../shared/maps/worlds.js';
import { buildCciLandCover, CCI_COVER_SOURCE } from './maps/cciLandCover.js';
import { buildElevationLayer, writeElevationPreview } from './maps/elevation.js';
import { buildHydroLayer, HYDRO_SOURCE, HYDRO_WIDTH_SOURCE } from './maps/hydro.js';
import { writeBin } from './maps/paths.js';
import { ensureDir, parseArgs } from './maps/util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseWorld(argv: string[]): string {
  for (const a of argv) {
    if (a.startsWith('--world=')) return a.slice(8);
  }
  return process.env.MAP_WORLD || MAP_WORLD_DEFAULT.id;
}

async function main() {
  const argv = process.argv.slice(2);
  const worldId = parseWorld(argv);
  const world = getMapWorld(worldId);
  const parsed = parseArgs(argv);

  // World catalog supplies defaults unless CLI overrides width/zoom explicitly
  const widthExplicit = argv.some((a) => a.startsWith('--width='));
  const zoomExplicit = argv.some((a) => a.startsWith('--elev-zoom='));
  const width = widthExplicit ? parsed.width : world.width;
  const height = widthExplicit
    ? parsed.height
    : world.height || Math.round(world.width / 2);
  const elevZoom = zoomExplicit ? parsed.elevZoom : world.elevZoom;
  const { force, only } = parsed;

  const ingestedDir = path.join(root, world.ingestedRel);
  const rawDir = path.join(root, 'data', 'raw');

  console.log(
    `PixelWeb maps:ingest  world=${worldId}  ${width}×${height}  elev-zoom=${elevZoom}  only=${only}`,
  );
  console.log(`  → ${world.ingestedRel}`);

  await ensureDir(rawDir);
  await ensureDir(ingestedDir);

  const metaPath = path.join(ingestedDir, 'meta.json');

  if (only === 'hydro') {
    let meta: IngestedWorldMeta;
    try {
      meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as IngestedWorldMeta;
    } catch {
      throw new Error(`No ingest at ${ingestedDir} — run full maps:ingest first`);
    }
    if (meta.width !== width || meta.height !== height) {
      console.warn(
        `Note: using existing ingest size ${meta.width}×${meta.height} (ignore --width for --only=hydro)`,
      );
    }
    console.log('\n[hydro] Natural Earth rivers + lakes → hydro_raw + hydro_width');
    const { hydroRaw, hydroWidth } = await buildHydroLayer(
      meta.width,
      meta.height,
      rawDir,
    );
    await writeBin(path.join(ingestedDir, 'hydro_raw.bin'), hydroRaw);
    await writeBin(path.join(ingestedDir, 'hydro_width.bin'), hydroWidth);
    meta.channels.hydroRaw = {
      file: 'hydro_raw.bin',
      dtype: 'uint8',
      source: HYDRO_SOURCE,
      encoding: 'ne-hydro-v1',
    };
    meta.channels.hydroWidth = {
      file: 'hydro_width.bin',
      dtype: 'uint8',
      source: HYDRO_WIDTH_SOURCE,
      encoding: 'ne-strokeweig-x100',
    };
    meta.builtAt = new Date().toISOString();
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    console.log(`\nHydro ingest done. Next: npm run maps:interpret -- --world=${worldId} --force`);
    return;
  }

  if (!force) {
    try {
      const existing = JSON.parse(await fs.readFile(metaPath, 'utf8')) as IngestedWorldMeta;
      if (
        existing.width === width &&
        existing.height === height &&
        existing.channels.coverRaw?.encoding === 'esa-cci-lccs' &&
        existing.channels.hydroRaw
      ) {
        console.log('Ingest already present (CCI+hydro). Pass --force or --only=hydro.');
        return;
      }
    } catch {
      /* continue */
    }
  }

  console.log('\n[ingest 1/3] Elevation (Terrarium → equirectangular meters)');
  const elevation = await buildElevationLayer(
    width,
    height,
    elevZoom,
    path.join(rawDir, 'terrarium'),
  );

  console.log('\n[ingest 2/3] Land cover (ESA CCI 300m LCCS via Planetary Computer)');
  const coverRaw = await buildCciLandCover(width, height);

  console.log('\n[ingest 3/3] Hydrography (Natural Earth rivers + lakes)');
  const { hydroRaw, hydroWidth } = await buildHydroLayer(width, height, rawDir);

  console.log(`\nWriting ${world.ingestedRel} …`);
  await writeBin(path.join(ingestedDir, 'elevation.bin'), elevation);
  await writeBin(path.join(ingestedDir, 'cover_raw.bin'), coverRaw);
  await writeBin(path.join(ingestedDir, 'hydro_raw.bin'), hydroRaw);
  await writeBin(path.join(ingestedDir, 'hydro_width.bin'), hydroWidth);

  await writeElevationPreview(
    elevation,
    width,
    height,
    path.join(ingestedDir, 'preview_elevation.png'),
  );

  const meta: IngestedWorldMeta = {
    version: 1,
    kind: 'ingested',
    projection: 'equirectangular',
    width,
    height,
    lonRange: [-180, 180],
    latRange: [-90, 90],
    channels: {
      elevation: {
        file: 'elevation.bin',
        dtype: 'int16',
        unit: 'meters',
        source: `AWS Terrain Tiles terrarium z=${elevZoom}`,
      },
      coverRaw: {
        file: 'cover_raw.bin',
        dtype: 'uint8',
        source: CCI_COVER_SOURCE,
        encoding: 'esa-cci-lccs',
      },
      hydroRaw: {
        file: 'hydro_raw.bin',
        dtype: 'uint8',
        source: HYDRO_SOURCE,
        encoding: 'ne-hydro-v1',
      },
      hydroWidth: {
        file: 'hydro_width.bin',
        dtype: 'uint8',
        source: HYDRO_WIDTH_SOURCE,
        encoding: 'ne-strokeweig-x100',
      },
    },
    builtAt: new Date().toISOString(),
  };

  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  console.log(`\nIngest done → ${world.ingestedRel} (${width}×${height})`);
  console.log(`Next: npm run maps:interpret -- --world=${worldId} --force`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
