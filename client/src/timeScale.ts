/**
 * Time scale + walk speed derived from it.
 *
 * Knobs (boot sliders):
 * - `daySeconds`: real seconds for one game day (clock pace + walk packing).
 * - `daysPerMonth`: how many game days make one calendar month.
 *   1 → old “1 día = 1 mes”; 30 → ~1 game day = 1 calendar day.
 *
 * Walk budget per game day = MONTHLY_WALK_METERS / daysPerMonth.
 * Calendar advance per game day = AVERAGE_MONTH_DAYS / daysPerMonth.
 */

/** Fixed offset of the displayed clock from UTC (hours). GMT−3 → −3. */
export const CLOCK_CIVIL_OFFSET_HOURS = -3;

/** WGS84 approximate equatorial circumference (m). */
export const EARTH_CIRCUMFERENCE_M = 40_075_017;

/** Default real seconds for one game day (boot slider). */
export const DEFAULT_DAY_SECONDS = 30;

/** Boot slider bounds for day duration. */
export const DAY_SECONDS_MIN = 10;
export const DAY_SECONDS_MAX = 180;

/**
 * Game days that fill one calendar month.
 * 1 = one game day advances a whole month; 30 ≈ one game day = one calendar day.
 */
export const DEFAULT_DAYS_PER_MONTH = 1;

export const DAYS_PER_MONTH_MIN = 0.1;
export const DAYS_PER_MONTH_MAX = 30;

/** Nominal calendar days in a month (for day-of-year advance). */
export const AVERAGE_MONTH_DAYS = 30;

/** ~5 km/day × 30 — typical active monthly on-foot distance. */
export const MONTHLY_WALK_METERS = 150_000;

/**
 * Real seconds for a full game day. Sole clock-pace knob:
 * walk also packs its budget into this window.
 */
let dayRealSeconds = DEFAULT_DAY_SECONDS;

/** Game days per calendar month. */
let daysPerMonth = DEFAULT_DAYS_PER_MONTH;

export function getDaySeconds(): number {
  return dayRealSeconds;
}

export function setDaySeconds(seconds: number) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return;
  dayRealSeconds = Math.min(DAY_SECONDS_MAX, Math.max(DAY_SECONDS_MIN, n));
}

export function getDaysPerMonth(): number {
  return daysPerMonth;
}

export function setDaysPerMonth(days: number) {
  const n = Number(days);
  if (!Number.isFinite(n)) return;
  const clamped = Math.min(DAYS_PER_MONTH_MAX, Math.max(DAYS_PER_MONTH_MIN, n));
  // One decimal place (slider step 0.1).
  daysPerMonth = Math.round(clamped * 10) / 10;
}

export function realSecondsPerGameHour(): number {
  return dayRealSeconds / 24;
}

export function realSecondsPerGameDay(): number {
  return dayRealSeconds;
}

/** Calendar days advanced when one game day elapses. */
export function calendarDaysPerGameDay(): number {
  return AVERAGE_MONTH_DAYS / daysPerMonth;
}

/** On-foot meters packed into one game day. */
export function walkBudgetMeters(): number {
  return MONTHLY_WALK_METERS / daysPerMonth;
}

/** Ground meters per world pixel at latitude (equirectangular). */
export function metersPerWorldPixel(mapWidth: number, latDeg: number): number {
  const w = Math.max(1, mapWidth);
  const cos = Math.cos((latDeg * Math.PI) / 180);
  // Polar clamp — avoid zero / negative from cos noise near ±90°.
  return (EARTH_CIRCUMFERENCE_M * Math.max(0.05, Math.abs(cos))) / w;
}

/** Equator scale: km represented by one world pixel. */
export function kmPerEquatorPixel(mapWidth: number): number {
  return EARTH_CIRCUMFERENCE_M / Math.max(1, mapWidth) / 1000;
}

/**
 * In-game km/h from a world-px step over `dtSec` wall seconds.
 * Distance uses equator km/px; hours use the day-duration slider
 * (24 game hours per `daySeconds` of real time).
 */
export function ingameSpeedKmh(movedPx: number, mapWidth: number, dtSec: number): number {
  if (!(movedPx > 0) || !(dtSec > 0)) return 0;
  const km = movedPx * kmPerEquatorPixel(mapWidth);
  const gameHours = dtSec / realSecondsPerGameHour();
  return km / gameHours;
}

/**
 * World-px per real second while walking.
 * Walk budget ÷ real seconds in one game day
 * (scales with day length and days-per-month).
 */
export function walkSpeedPxPerSec(mapWidth: number, latDeg: number): number {
  const mPerPx = metersPerWorldPixel(mapWidth, latDeg);
  const metersPerRealSec = walkBudgetMeters() / realSecondsPerGameDay();
  return metersPerRealSec / mPerPx;
}
