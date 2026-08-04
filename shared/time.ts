/**
 * Shared game-time scale constants + pure room sim-time math.
 * Server is authoritative for multiplayer rooms; client uses this for solo + apply sync.
 */

export const CLOCK_CIVIL_OFFSET_HOURS = -3;

export const DEFAULT_DAY_SECONDS = 30;
export const DAY_SECONDS_MIN = 10;
export const DAY_SECONDS_MAX = 180;

export const DEFAULT_DAYS_PER_MONTH = 1;
export const DAYS_PER_MONTH_MIN = 0.1;
export const DAYS_PER_MONTH_MAX = 30;

export const AVERAGE_MONTH_DAYS = 30;

export const DEFAULT_LUNAR_QUARTER_DAYS = 1;
export const LUNAR_QUARTER_DAYS_MIN = 0.25;
export const LUNAR_QUARTER_DAYS_MAX = 14;

/** Default civil hour on room create. */
export const DEFAULT_SIM_HOUR = 10;
/** ~3 Aug — invierno austral / verano boreal. */
export const DEFAULT_DAY_OF_YEAR = 215;
/** Start near full moon. */
export const DEFAULT_LUNAR_AGE = 0.5;

export interface RoomTimeScale {
  daySeconds: number;
  daysPerMonth: number;
  lunarQuarterDays: number;
}

export interface RoomSimTime {
  hour: number;
  dayOfYear: number;
  lunarAge: number;
  calendarDayCarry: number;
  scale: RoomTimeScale;
  /** Wall-clock ms of last advance (for sync / extrapolation). */
  updatedAt: number;
}

export interface TimeSyncPayload {
  hour: number;
  dayOfYear: number;
  lunarAge: number;
  daySeconds: number;
  daysPerMonth: number;
  lunarQuarterDays: number;
  serverTimeMs: number;
}

export function clampDaySeconds(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_DAY_SECONDS;
  return Math.min(DAY_SECONDS_MAX, Math.max(DAY_SECONDS_MIN, n));
}

export function clampDaysPerMonth(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_DAYS_PER_MONTH;
  const clamped = Math.min(DAYS_PER_MONTH_MAX, Math.max(DAYS_PER_MONTH_MIN, n));
  return Math.round(clamped * 10) / 10;
}

export function clampLunarQuarterDays(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_LUNAR_QUARTER_DAYS;
  const clamped = Math.min(LUNAR_QUARTER_DAYS_MAX, Math.max(LUNAR_QUARTER_DAYS_MIN, n));
  return Math.round(clamped * 100) / 100;
}

export function normalizeTimeScale(partial?: Partial<RoomTimeScale>): RoomTimeScale {
  return {
    daySeconds: clampDaySeconds(partial?.daySeconds ?? DEFAULT_DAY_SECONDS),
    daysPerMonth: clampDaysPerMonth(partial?.daysPerMonth ?? DEFAULT_DAYS_PER_MONTH),
    lunarQuarterDays: clampLunarQuarterDays(
      partial?.lunarQuarterDays ?? DEFAULT_LUNAR_QUARTER_DAYS,
    ),
  };
}

function wrapHour(h: number): number {
  return ((h % 24) + 24) % 24;
}

function wrapDayOfYear(d: number): number {
  const x = ((Math.floor(d) - 1) % 365 + 365) % 365;
  return x + 1;
}

function wrap01(x: number): number {
  return ((x % 1) + 1) % 1;
}

function calendarDaysPerGameDay(daysPerMonth: number): number {
  return AVERAGE_MONTH_DAYS / Math.max(DAYS_PER_MONTH_MIN, daysPerMonth);
}

function lunarCycleGameHours(quarterDays: number): number {
  return Math.max(LUNAR_QUARTER_DAYS_MIN, quarterDays) * 4 * 24;
}

export function createRoomSimTime(scalePartial?: Partial<RoomTimeScale>): RoomSimTime {
  return {
    hour: DEFAULT_SIM_HOUR,
    dayOfYear: DEFAULT_DAY_OF_YEAR,
    lunarAge: DEFAULT_LUNAR_AGE,
    calendarDayCarry: 0,
    scale: normalizeTimeScale(scalePartial),
    updatedAt: Date.now(),
  };
}

function applyHourDelta(sim: RoomSimTime, deltaHours: number): void {
  if (!Number.isFinite(deltaHours) || deltaHours === 0) return;
  const sum = sim.hour + deltaHours;
  const crossed = Math.floor(sum / 24);
  sim.hour = wrapHour(sum);
  if (crossed !== 0) {
    sim.calendarDayCarry += crossed * calendarDaysPerGameDay(sim.scale.daysPerMonth);
    const whole = Math.trunc(sim.calendarDayCarry);
    if (whole !== 0) {
      sim.calendarDayCarry -= whole;
      sim.dayOfYear = wrapDayOfYear(sim.dayOfYear + whole);
    }
  }
  sim.lunarAge = wrap01(
    sim.lunarAge + deltaHours / lunarCycleGameHours(sim.scale.lunarQuarterDays),
  );
}

/** Advance by wall-clock milliseconds. */
export function tickRoomSimTime(sim: RoomSimTime, dtMs: number, now = Date.now()): void {
  if (!(dtMs > 0) || dtMs > 5000) {
    sim.updatedAt = now;
    return;
  }
  const secPerHour = sim.scale.daySeconds / 24;
  applyHourDelta(sim, dtMs / 1000 / secPerHour);
  sim.updatedAt = now;
}

export function nudgeRoomSimHours(sim: RoomSimTime, deltaHours: number, now = Date.now()): void {
  applyHourDelta(sim, deltaHours);
  sim.updatedAt = now;
}

/**
 * Calendar-only nudge (V/B keys): shift day-of-year without changing clock hour.
 * Advances lunar by the equivalent wall of game hours.
 */
export function nudgeRoomSimCalendarDays(
  sim: RoomSimTime,
  deltaDays: number,
  now = Date.now(),
): void {
  if (!Number.isFinite(deltaDays) || deltaDays === 0) return;
  sim.dayOfYear = wrapDayOfYear(sim.dayOfYear + deltaDays);
  sim.lunarAge = wrap01(
    sim.lunarAge + (deltaDays * 24) / lunarCycleGameHours(sim.scale.lunarQuarterDays),
  );
  sim.updatedAt = now;
}

export function timeSyncFromSim(sim: RoomSimTime, serverTimeMs = Date.now()): TimeSyncPayload {
  return {
    hour: sim.hour,
    dayOfYear: sim.dayOfYear,
    lunarAge: sim.lunarAge,
    daySeconds: sim.scale.daySeconds,
    daysPerMonth: sim.scale.daysPerMonth,
    lunarQuarterDays: sim.scale.lunarQuarterDays,
    serverTimeMs,
  };
}

export function minuteBucket(hour: number): number {
  return Math.floor(wrapHour(hour) * 60);
}
