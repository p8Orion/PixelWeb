/**
 * Solar helpers (CPU) — mirror of the equirectangular path in SunlightPipeline.
 * Map-agnostic: callers supply lat/lon. Shader does the per-pixel work.
 *
 * Civil clock is GMT−3; convert with {@link gmt3ToUtcHours}.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Game HUD hour (GMT−3) → UTC decimal hours [0, 24). */
export function gmt3ToUtcHours(hourGmt3: number): number {
  return ((hourGmt3 + 3) % 24 + 24) % 24;
}

/** Solar declination (degrees) from day-of-year 1..365. */
export function solarDeclinationDeg(dayOfYear: number): number {
  return 23.44 * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 365);
}

export interface SunSample {
  /** Radians; negative = below horizon. */
  elevation: number;
  /** Radians from north toward east. */
  azimuth: number;
  /** sin(elevation), handy for shading. */
  sinElevation: number;
}

/**
 * Sun position at a geographic point.
 * @param latDeg latitude −90..90
 * @param lonDeg longitude −180..180 (east positive)
 * @param utcHours UTC decimal hours
 * @param dayOfYear 1..365
 */
export function sunAt(
  latDeg: number,
  lonDeg: number,
  utcHours: number,
  dayOfYear: number,
): SunSample {
  const decl = solarDeclinationDeg(dayOfYear) * DEG;
  const phi = latDeg * DEG;
  const lst = utcHours + lonDeg / 15;
  const ha = (lst - 12) * 15 * DEG;

  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const clamped = Math.max(-1, Math.min(1, sinEl));
  const el = Math.asin(clamped);
  const cosEl = Math.max(Math.cos(el), 1e-5);

  let sinAz = (-Math.cos(decl) * Math.sin(ha)) / cosEl;
  let cosAz =
    (Math.sin(decl) - clamped * Math.sin(phi)) / (cosEl * Math.max(Math.cos(phi), 1e-5));
  const inv = 1 / Math.hypot(sinAz, cosAz);
  sinAz *= inv;
  cosAz *= inv;
  const az = Math.atan2(sinAz, cosAz);

  return { elevation: el, azimuth: az, sinElevation: clamped };
}

export function elevationDeg(sample: SunSample): number {
  return sample.elevation * RAD;
}
