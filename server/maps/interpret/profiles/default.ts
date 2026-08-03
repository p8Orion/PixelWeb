import { LANDCOVER, type LandcoverCode } from '../../../../shared/maps/game.js';
import { HYDRO, HYDRO_INTERPRET } from '../../../../shared/maps/hydro.js';
import type { InterpretProfile } from '../types.js';

/**
 * ESA CCI LCCS (300m) → game landcover.
 * @see https://maps.elie.ucl.ac.be/CCI/viewer/download/ESACCI-LC-Legend.csv
 */
export function cciLccsToGame(code: number): LandcoverCode {
  // Cropland family
  if (code >= 10 && code <= 40) return LANDCOVER.CROPLAND;

  // Tree cover (incl. flooded forest)
  if (
    (code >= 50 && code <= 90) ||
    code === 100 ||
    code === 160 ||
    code === 170
  ) {
    return LANDCOVER.TREE_COVER;
  }

  // Mosaic herbaceous / grassland / lichens
  if (code === 110 || code === 130 || code === 140) return LANDCOVER.GRASSLAND;

  // Shrubland
  if (code === 120 || code === 121 || code === 122) return LANDCOVER.SHRUBLAND;

  // Sparse → bare
  if (code >= 150 && code <= 153) return LANDCOVER.BARE;

  // Flooded shrub/herb → wetland
  if (code === 180) return LANDCOVER.WETLAND;

  if (code === 190) return LANDCOVER.BUILT_UP;
  if (code === 200 || code === 201 || code === 202) return LANDCOVER.BARE;
  // Inland / permanent water bodies → freshwater (ocean comes from landmask)
  if (code === 210) return LANDCOVER.FRESHWATER;
  if (code === 220) return LANDCOVER.SNOW_ICE;

  // 0 nodata / unknown
  return LANDCOVER.GRASSLAND;
}

/** Classify Natural Earth NE1-style RGB — fallback only. */
function classifyBasemapRgb(r: number, g: number, b: number): LandcoverCode {
  if (b > r + 25 && b > g + 15 && b > 70) return LANDCOVER.FRESHWATER;
  if (r > 200 && g > 200 && b > 200) return LANDCOVER.SNOW_ICE;
  if (r > 170 && g > 180 && b > 185 && Math.abs(r - b) < 25) return LANDCOVER.SNOW_ICE;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const lightness = (max + min) / 2;

  if (chroma < 28 && lightness > 70 && lightness < 160 && r > 90) return LANDCOVER.BUILT_UP;
  if (r > g && r > b && g > b + 10 && r > 140 && g > 100 && b < 140) return LANDCOVER.BARE;
  if (r > 160 && g > 130 && b < 110) return LANDCOVER.BARE;
  if (g > r && g > 90 && r > 100 && b < 100 && chroma > 20) return LANDCOVER.CROPLAND;
  if (g > r + 15 && g > b + 15 && g < 130 && r < 90) return LANDCOVER.TREE_COVER;
  if (g > r && g > b && g > 70) {
    if (g > 120 && r > 80) return LANDCOVER.GRASSLAND;
    if (lightness < 100) return LANDCOVER.TREE_COVER;
    return LANDCOVER.SHRUBLAND;
  }
  if (g > 80 && b > 80 && r < 90 && Math.abs(g - b) < 40) return LANDCOVER.WETLAND;
  if (g >= r && g >= 60) return LANDCOVER.GRASSLAND;
  if (lightness > 180) return LANDCOVER.SNOW_ICE;
  if (r > g && r > 100) return LANDCOVER.BARE;
  return LANDCOVER.GRASSLAND;
}

function isCciEncoding(source: string | undefined): boolean {
  return !!source && /cci|lccs/i.test(source);
}

/**
 * Default game interpretation:
 * - landmask from elevation > seaLevel
 * - landcover from cover_raw (CCI LCCS or WorldCover) else NE1 heuristics
 */
export const defaultProfile: InterpretProfile = {
  id: 'default',
  description:
    'Sea-level landmask; CCI/WorldCover landcover; Natural Earth hydro → freshwater',

  interpret(ingested, opts) {
    const { elevation, basemapRgba, coverRaw, hydroRaw, hydroWidth, meta } = ingested;
    const n = meta.width * meta.height;
    const seaLevel = 0;
    const coverSource = meta.channels.coverRaw?.source;
    const strokeScale = opts?.hydroStrokeScale ?? HYDRO_INTERPRET.strokeScale;

    const landmask = new Uint8Array(n);
    for (let i = 0; i < n; i++) landmask[i] = elevation[i] > seaLevel ? 1 : 0;

    const landcover = new Uint8Array(n);
    let landcoverNote: string;

    if (coverRaw && coverRaw.length === n) {
      const useCci = isCciEncoding(coverSource);
      for (let i = 0; i < n; i++) {
        if (landmask[i] === 0) {
          landcover[i] = LANDCOVER.WATER;
          continue;
        }
        const raw = coverRaw[i];
        if (useCci) {
          landcover[i] = cciLccsToGame(raw);
        } else {
          if (raw === 80) landcover[i] = LANDCOVER.FRESHWATER;
          else if (raw === 0) landcover[i] = LANDCOVER.GRASSLAND;
          else landcover[i] = raw as LandcoverCode;
        }
      }
      landcoverNote = useCci
        ? 'ESA CCI LCCS→game on land; ocean from landmask'
        : 'WorldCover-like on land; ocean from landmask';
    } else if (basemapRgba && basemapRgba.length === n * 4) {
      for (let i = 0; i < n; i++) {
        if (landmask[i] === 0) {
          landcover[i] = LANDCOVER.WATER;
          continue;
        }
        const o = i * 4;
        landcover[i] = classifyBasemapRgb(
          basemapRgba[o],
          basemapRgba[o + 1],
          basemapRgba[o + 2],
        );
      }
      landcoverNote = 'basemap RGBA heuristics (fallback)';
    } else {
      for (let i = 0; i < n; i++) {
        landcover[i] = landmask[i] === 0 ? LANDCOVER.WATER : LANDCOVER.GRASSLAND;
      }
      landcoverNote = 'no cover source — grassland/water stub';
    }

    // Hydro: lakes filled; rivers dilated by strokeweig * strokeScale (per-world)
    let hydroHits = 0;
    if (hydroRaw && hydroRaw.length === n) {
      const { width, height } = meta;
      const scale = strokeScale;
      const q = HYDRO_INTERPRET.widthQuantize;
      const minR = HYDRO_INTERPRET.minRadiusPx;

      for (let i = 0; i < n; i++) {
        if (landmask[i] === 0) continue;
        if (hydroRaw[i] === HYDRO.LAKE) {
          landcover[i] = LANDCOVER.FRESHWATER;
          hydroHits++;
        }
      }

      if (hydroWidth && hydroWidth.length === n) {
        for (let i = 0; i < n; i++) {
          if (hydroRaw[i] !== HYDRO.RIVER) continue;
          const strokeweig = hydroWidth[i] / q;
          const radius = Math.max(minR, Math.round(strokeweig * scale));
          const cx = i % width;
          const cy = Math.floor(i / width);
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              if (dx * dx + dy * dy > radius * radius) continue;
              const x = cx + dx;
              const y = cy + dy;
              if (x < 0 || y < 0 || x >= width || y >= height) continue;
              const j = y * width + x;
              if (landmask[j] === 0) continue;
              if (landcover[j] !== LANDCOVER.FRESHWATER) hydroHits++;
              landcover[j] = LANDCOVER.FRESHWATER;
            }
          }
        }
        landcoverNote += `; hydro rivers radius=strokeweig×${scale} (${hydroHits} px)`;
      } else {
        // Legacy: centerline-only without width channel
        for (let i = 0; i < n; i++) {
          if (landmask[i] === 0) continue;
          if (hydroRaw[i] === HYDRO.RIVER) {
            landcover[i] = LANDCOVER.FRESHWATER;
            hydroHits++;
          }
        }
        landcoverNote += `; hydro overlay legacy (${hydroHits} px)`;
      }
    }

    return {
      landmask,
      elevation,
      landcover,
      notes: {
        landmask: `elevation > ${seaLevel} m`,
        landcover: landcoverNote,
        elevation: 'passthrough from ingest (meters)',
      },
    };
  },
};
