/**
 * Ingested world data — grid-aligned, physically/cartographically neutral.
 * No game rules (no landmask policy, no biome taxonomy, no walkability).
 */

export interface IngestedWorldMeta {
  version: 1;
  kind: 'ingested';
  projection: 'equirectangular';
  width: number;
  height: number;
  lonRange: [-180, 180];
  latRange: [-90, 90];
  channels: {
    elevation: {
      file: string;
      dtype: 'int16';
      unit: 'meters';
      source: string;
    };
    /** Optional RGB basemap (e.g. Natural Earth NE1) — imagery only. */
    basemap?: {
      file: string;
      dtype: 'rgba8';
      source: string;
    };
    /** Optional raw classified cover (CCI LCCS or WorldCover as published). */
    coverRaw?: {
      file: string;
      dtype: 'uint8';
      source: string;
      encoding?: 'esa-cci-lccs' | 'esa-worldcover';
    };
    /**
     * Optional hydrography mask from vector rivers/lakes.
     * 0=none, 1=river (centerline), 2=lake (see shared/maps/hydro.ts).
     */
    hydroRaw?: {
      file: string;
      dtype: 'uint8';
      source: string;
      encoding: 'ne-hydro-v1';
    };
    /**
     * Parallel to hydroRaw: quantized Natural Earth strokeweig on river pixels
     * (uint8 ≈ strokeweig * 100). Lakes unused (0). Dilated in interpret.
     */
    hydroWidth?: {
      file: string;
      dtype: 'uint8';
      source: string;
      encoding: 'ne-strokeweig-x100';
    };
  };
  builtAt: string;
}

export interface IngestedWorld {
  meta: IngestedWorldMeta;
  elevation: Int16Array;
  basemapRgba: Uint8Array | null;
  coverRaw: Uint8Array | null;
  hydroRaw: Uint8Array | null;
  hydroWidth: Uint8Array | null;
}
