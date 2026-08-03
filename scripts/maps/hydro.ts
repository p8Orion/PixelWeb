/**
 * Rasterize Natural Earth rivers + lakes into an equirectangular hydro mask.
 * Codes: 0 none, 1 river, 2 lake (see shared/maps/hydro.ts).
 */

import fs from 'fs/promises';
import path from 'path';
import shp from 'shpjs';
import { HYDRO, HYDRO_INTERPRET } from '../../shared/maps/hydro.js';
import { downloadFile, ensureDir, fileExists } from './util.js';

const RIVERS_URLS = [
  'https://naciscdn.org/naturalearth/10m/physical/ne_10m_rivers_lake_centerlines_scale_rank.zip',
  'https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_rivers_lake_centerlines_scale_rank.zip',
];

const LAKES_URLS = [
  'https://naciscdn.org/naturalearth/10m/physical/ne_10m_lakes.zip',
  'https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_lakes.zip',
];

type Position = [number, number]; // lon, lat

function lonLatToPixel(
  lon: number,
  lat: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const x = ((lon + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return { x, y };
}

function setClassPixel(
  buf: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  v: number,
) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) return;
  const i = iy * width + ix;
  if (v === HYDRO.LAKE || buf[i] !== HYDRO.LAKE) buf[i] = v;
}

function setRiverCenter(
  classBuf: Uint8Array,
  widthBuf: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  strokeQ: number,
) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) return;
  const i = iy * width + ix;
  if (classBuf[i] === HYDRO.LAKE) return;
  classBuf[i] = HYDRO.RIVER;
  if (strokeQ > widthBuf[i]) widthBuf[i] = strokeQ;
}

function paintDisk(
  buf: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  v: number,
) {
  const r = Math.max(0, Math.ceil(radius));
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r + r) {
        setClassPixel(buf, width, height, cx + dx, cy + dy, v);
      }
    }
  }
}

function drawLine(
  buf: Uint8Array,
  width: number,
  height: number,
  x0f: number,
  y0f: number,
  x1f: number,
  y1f: number,
  v: number,
  thickness: number,
) {
  let x0 = Math.round(x0f);
  let y0 = Math.round(y0f);
  const x1 = Math.round(x1f);
  const y1 = Math.round(y1f);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    paintDisk(buf, width, height, x0, y0, thickness, v);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function drawRiverCenterline(
  classBuf: Uint8Array,
  widthBuf: Uint8Array,
  width: number,
  height: number,
  x0f: number,
  y0f: number,
  x1f: number,
  y1f: number,
  strokeQ: number,
) {
  let x0 = Math.round(x0f);
  let y0 = Math.round(y0f);
  const x1 = Math.round(x1f);
  const y1 = Math.round(y1f);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    setRiverCenter(classBuf, widthBuf, width, height, x0, y0, strokeQ);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function drawPolyline(
  buf: Uint8Array,
  width: number,
  height: number,
  coords: Position[],
  v: number,
  thickness: number,
) {
  for (let i = 1; i < coords.length; i++) {
    const a = lonLatToPixel(coords[i - 1][0], coords[i - 1][1], width, height);
    const b = lonLatToPixel(coords[i][0], coords[i][1], width, height);
    drawLine(buf, width, height, a.x, a.y, b.x, b.y, v, thickness);
  }
}

function drawRiverPolyline(
  classBuf: Uint8Array,
  widthBuf: Uint8Array,
  width: number,
  height: number,
  coords: Position[],
  strokeQ: number,
) {
  for (let i = 1; i < coords.length; i++) {
    const a = lonLatToPixel(coords[i - 1][0], coords[i - 1][1], width, height);
    const b = lonLatToPixel(coords[i][0], coords[i][1], width, height);
    drawRiverCenterline(classBuf, widthBuf, width, height, a.x, a.y, b.x, b.y, strokeQ);
  }
}

/** Even-odd point in polygon (lon/lat ring). */
function pointInRing(lon: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function fillPolygon(
  buf: Uint8Array,
  width: number,
  height: number,
  rings: Position[][],
  v: number,
) {
  if (!rings.length || rings[0].length < 3) return;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of rings[0]) {
    minLon = Math.min(minLon, p[0]);
    maxLon = Math.max(maxLon, p[0]);
    minLat = Math.min(minLat, p[1]);
    maxLat = Math.max(maxLat, p[1]);
  }
  const p0 = lonLatToPixel(minLon, maxLat, width, height);
  const p1 = lonLatToPixel(maxLon, minLat, width, height);
  const x0 = Math.max(0, Math.floor(Math.min(p0.x, p1.x)));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(p0.x, p1.x)));
  const y0 = Math.max(0, Math.floor(Math.min(p0.y, p1.y)));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(p0.y, p1.y)));

  const outer = rings[0];
  const holes = rings.slice(1);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const lon = (x / width) * 360 - 180;
      const lat = 90 - (y / height) * 180;
      if (!pointInRing(lon, lat, outer)) continue;
      let inHole = false;
      for (const hole of holes) {
        if (pointInRing(lon, lat, hole)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) setClassPixel(buf, width, height, x, y, v);
    }
  }
}

async function downloadFirst(urls: string[], dest: string, label: string): Promise<void> {
  if (await fileExists(dest)) {
    console.log(`  cache hit: ${label}`);
    return;
  }
  let last: unknown;
  for (const url of urls) {
    try {
      await downloadFile(url, dest, label);
      return;
    } catch (err) {
      last = err;
      console.warn(`  mirror failed, trying next…`);
    }
  }
  throw last;
}

type FeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties?: Record<string, unknown> | null;
    geometry?: {
      type: string;
      coordinates: unknown;
    } | null;
  }>;
};

async function loadGeoJsonFromZip(zipPath: string): Promise<FeatureCollection> {
  const buf = await fs.readFile(zipPath);
  const geo = await shp(buf);
  if (Array.isArray(geo)) {
    const features = geo.flatMap((g) => (g as FeatureCollection).features ?? []);
    return { type: 'FeatureCollection', features };
  }
  return geo as FeatureCollection;
}

function strokeweigToQuantized(props: Record<string, unknown> | null | undefined): number {
  const raw = Number(props?.strokeweig ?? props?.StrokeWeig ?? 0.25);
  const w = Number.isFinite(raw) && raw > 0 ? raw : 0.25;
  return Math.max(
    1,
    Math.min(255, Math.round(w * HYDRO_INTERPRET.widthQuantize)),
  );
}

export interface HydroIngestResult {
  hydroRaw: Uint8Array;
  hydroWidth: Uint8Array;
}

/**
 * Lakes: filled polygons.
 * Rivers: 1px centerlines + parallel hydroWidth (quantized strokeweig).
 * Brush width is applied later in interpret: radius = strokeweig * strokeScale.
 */
export async function buildHydroLayer(
  width: number,
  height: number,
  rawDir: string,
): Promise<HydroIngestResult> {
  await ensureDir(rawDir);
  const riversZip = path.join(rawDir, 'ne_10m_rivers_lake_centerlines_scale_rank.zip');
  const lakesZip = path.join(rawDir, 'ne_10m_lakes.zip');

  await downloadFirst(RIVERS_URLS, riversZip, 'Natural Earth 10m rivers (scale_rank)');
  await downloadFirst(LAKES_URLS, lakesZip, 'Natural Earth 10m lakes');

  const hydroRaw = new Uint8Array(width * height);
  const hydroWidth = new Uint8Array(width * height);

  console.log('  rasterizing lakes…');
  const lakes = await loadGeoJsonFromZip(lakesZip);
  let lakeCount = 0;
  for (const f of lakes.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') {
      fillPolygon(hydroRaw, width, height, g.coordinates as Position[][], HYDRO.LAKE);
      lakeCount++;
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates as Position[][][]) {
        fillPolygon(hydroRaw, width, height, poly, HYDRO.LAKE);
      }
      lakeCount++;
    }
  }
  console.log(`  lakes features: ${lakeCount}`);

  console.log('  rasterizing river centerlines + strokeweig…');
  const rivers = await loadGeoJsonFromZip(riversZip);
  let riverCount = 0;
  for (const f of rivers.features) {
    const g = f.geometry;
    if (!g) continue;
    const strokeQ = strokeweigToQuantized(f.properties as Record<string, unknown>);
    if (g.type === 'LineString') {
      drawRiverPolyline(
        hydroRaw,
        hydroWidth,
        width,
        height,
        g.coordinates as Position[],
        strokeQ,
      );
      riverCount++;
    } else if (g.type === 'MultiLineString') {
      for (const line of g.coordinates as Position[][]) {
        drawRiverPolyline(hydroRaw, hydroWidth, width, height, line, strokeQ);
      }
      riverCount++;
    }
  }
  console.log(`  river features: ${riverCount}`);

  let riverPx = 0;
  let lakePx = 0;
  for (let i = 0; i < hydroRaw.length; i++) {
    if (hydroRaw[i] === HYDRO.RIVER) riverPx++;
    else if (hydroRaw[i] === HYDRO.LAKE) lakePx++;
  }
  console.log(
    `  hydro pixels: rivers=${riverPx} lakes=${lakePx} (${(
      (100 * (riverPx + lakePx)) /
      hydroRaw.length
    ).toFixed(2)}% of grid)`,
  );
  console.log(
    `  width brush happens in interpret: radiusPx = strokeweig * ${HYDRO_INTERPRET.strokeScale}`,
  );

  return { hydroRaw, hydroWidth };
}

export const HYDRO_SOURCE =
  'Natural Earth 10m rivers (scale_rank/strokeweig centerlines) + lakes';
export const HYDRO_WIDTH_SOURCE =
  'Natural Earth strokeweig × 100 (uint8); interpret dilates with HYDRO_INTERPRET.strokeScale';
