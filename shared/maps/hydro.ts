/** Neutral hydro channel codes (ingest). Game meaning comes from interpret. */
export const HYDRO = {
  NONE: 0,
  RIVER: 1,
  LAKE: 2,
} as const;

export type HydroCode = (typeof HYDRO)[keyof typeof HYDRO];

/**
 * Interpret-time river brush:
 *   radiusPx = round(strokeweig * strokeScale)
 * strokeweig comes from Natural Earth (typically ~0.15–2).
 *
 * Default strokeScale is for the 4096×2048 grid. Per-world overrides live in
 * shared/maps/worlds.ts (e.g. earth3x uses ×3 so geographic width matches).
 */
export const HYDRO_INTERPRET = {
  strokeScale: 1.25,
  /** Ensure major rivers still leave at least this radius (px). */
  minRadiusPx: 0,
  /** Lakes stay filled from hydro_raw; this is only for river dilation. */
  widthQuantize: 100, // stored uint8 = round(strokeweig * widthQuantize)
} as const;
