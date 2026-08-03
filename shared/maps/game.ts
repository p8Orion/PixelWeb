/**
 * Game-interpreted world layers — concepts the simulation cares about.
 * Produced from ingested data by a swappable interpret profile on the server.
 */

export const LANDCOVER = {
  /** Salt water / ocean (from landmask below sea level). */
  WATER: 0,
  /** Inland rivers, lakes — kept on land cells from cover sources. */
  FRESHWATER: 5,
  TREE_COVER: 10,
  SHRUBLAND: 20,
  GRASSLAND: 30,
  CROPLAND: 40,
  BUILT_UP: 50,
  BARE: 60,
  SNOW_ICE: 70,
  WETLAND: 90,
} as const;

export type LandcoverCode = (typeof LANDCOVER)[keyof typeof LANDCOVER];

export const LANDCOVER_LABELS: Record<number, string> = {
  [LANDCOVER.WATER]: 'water',
  [LANDCOVER.FRESHWATER]: 'freshwater',
  [LANDCOVER.TREE_COVER]: 'tree_cover',
  [LANDCOVER.SHRUBLAND]: 'shrubland',
  [LANDCOVER.GRASSLAND]: 'grassland',
  [LANDCOVER.CROPLAND]: 'cropland',
  [LANDCOVER.BUILT_UP]: 'built_up',
  [LANDCOVER.BARE]: 'bare_sparse',
  [LANDCOVER.SNOW_ICE]: 'snow_ice',
  [LANDCOVER.WETLAND]: 'wetland',
};

/** Debug/placeholder tint only — not the final art pipeline. */
export const LANDCOVER_PREVIEW_RGB: Record<number, [number, number, number]> = {
  [LANDCOVER.WATER]: [20, 58, 100],
  [LANDCOVER.FRESHWATER]: [26, 68, 112],
  [LANDCOVER.TREE_COVER]: [34, 96, 48],
  [LANDCOVER.SHRUBLAND]: [110, 130, 70],
  [LANDCOVER.GRASSLAND]: [92, 148, 72],
  [LANDCOVER.CROPLAND]: [168, 160, 72],
  [LANDCOVER.BUILT_UP]: [120, 110, 110],
  [LANDCOVER.BARE]: [186, 160, 110],
  [LANDCOVER.SNOW_ICE]: [230, 236, 240],
  [LANDCOVER.WETLAND]: [42, 88, 82],
};

/** Flat deep-ocean tint — no bathymetry banding below this depth (m). */
export const DEEP_OCEAN_DEPTH_M = 50;
export const DEEP_OCEAN_PREVIEW_RGB: [number, number, number] = [14, 42, 78];

/** Preview RGBA for one cell (shared by client + server debug PNG). */
export function previewRgbForCell(
  landcover: number,
  elevationM: number,
  isLand: boolean,
): [number, number, number] {
  if (!isLand) {
    // Deep ocean: uniform dark. Shelf (0 … −threshold m): ramp coastal → deep.
    if (elevationM <= -DEEP_OCEAN_DEPTH_M) return DEEP_OCEAN_PREVIEW_RGB;
    const shelf = LANDCOVER_PREVIEW_RGB[LANDCOVER.WATER];
    const t = Math.max(0, Math.min(1, -elevationM / DEEP_OCEAN_DEPTH_M));
    return [
      Math.round(shelf[0] + (DEEP_OCEAN_PREVIEW_RGB[0] - shelf[0]) * t),
      Math.round(shelf[1] + (DEEP_OCEAN_PREVIEW_RGB[1] - shelf[1]) * t),
      Math.round(shelf[2] + (DEEP_OCEAN_PREVIEW_RGB[2] - shelf[2]) * t),
    ];
  }

  const base =
    LANDCOVER_PREVIEW_RGB[landcover] ?? LANDCOVER_PREVIEW_RGB[LANDCOVER.GRASSLAND];
  return [base[0], base[1], base[2]];
}

export interface GameWorldMeta {
  version: 1;
  kind: 'interpreted';
  profile: string;
  /** Map world id (default | earth3x | …). */
  worldId?: string;
  projection: 'equirectangular';
  width: number;
  height: number;
  lonRange: [-180, 180];
  latRange: [-90, 90];
  /** Logical tile size for viewport streaming (px). */
  tileSize?: number;
  layers: {
    landmask: { file: string; dtype: 'uint8'; meaning: string };
    elevation: {
      file: string;
      dtype: 'int16';
      unit: 'meters';
      note: string;
    };
    landcover: {
      file: string;
      dtype: 'uint8';
      codes: typeof LANDCOVER_LABELS;
      meaning: string;
    };
  };
  ingestBuiltAt: string;
  interpretedAt: string;
}

export interface GameWorldLayers {
  meta: GameWorldMeta;
  landmask: Uint8Array;
  elevation: Int16Array;
  landcover: Uint8Array;
}
