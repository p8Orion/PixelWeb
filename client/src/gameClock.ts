/**
 * Global game clock — civil hours in [0, 24) as **GMT−3** (UTC−3).
 * Solo: advanced by the WorldScene each frame.
 * Multiplayer rooms: server is authoritative; client snaps via `applyServerSync`
 * and still ticks locally between syncs for smooth display.
 *
 * Day length and calendar scale live in `timeScale.ts` (`daySeconds`, `daysPerMonth`).
 * Midnight advances the calendar by `AVERAGE_MONTH_DAYS / daysPerMonth` days.
 * Hour deltas also advance `GameLunar`.
 */

import { GameCalendar } from './gameCalendar';
import { GameLunar, setLunarQuarterDays } from './gameLunar';
import {
  CLOCK_CIVIL_OFFSET_HOURS,
  calendarDaysPerGameDay,
  realSecondsPerGameHour,
  setDaySeconds,
  setDaysPerMonth,
} from './timeScale';
import type { TimeSyncPayload } from '../../shared/time';

/** Re-export so existing imports of CLOCK_UTC_OFFSET_HOURS keep working. */
export const CLOCK_UTC_OFFSET_HOURS = CLOCK_CIVIL_OFFSET_HOURS;

let hour = 10;
/** Fractional calendar-day carry from non-integer days-per-month ratios. */
let calendarDayCarry = 0;
const listeners = new Set<(h: number) => void>();

function wrap(h: number): number {
  return ((h % 24) + 24) % 24;
}

function emit() {
  for (const fn of listeners) fn(hour);
}

function advanceCalendar(crossedGameDays: number) {
  if (crossedGameDays === 0) return;
  calendarDayCarry += crossedGameDays * calendarDaysPerGameDay();
  const whole = Math.trunc(calendarDayCarry);
  if (whole === 0) return;
  calendarDayCarry -= whole;
  GameCalendar.nudgeDays(whole);
}

export const GameClock = {
  get hour(): number {
    return hour;
  },

  /** Civil hour as UTC (for solar / debug). */
  get utcHour(): number {
    return wrap(hour - CLOCK_CIVIL_OFFSET_HOURS);
  },

  setHour(h: number) {
    hour = wrap(h);
    emit();
  },

  /**
   * Snap local clock/calendar/lunar + scale from server room authority.
   * Does not locally tick past `serverTimeMs` (caller may extrapolate).
   */
  applyServerSync(sync: TimeSyncPayload) {
    setDaySeconds(sync.daySeconds);
    setDaysPerMonth(sync.daysPerMonth);
    setLunarQuarterDays(sync.lunarQuarterDays);
    hour = wrap(sync.hour);
    calendarDayCarry = 0;
    GameCalendar.setDayOfYear(sync.dayOfYear);
    GameLunar.setAge(sync.lunarAge);
    emit();
  },

  /** Shift by ±hours (e.g. +1 / −1). */
  nudge(deltaHours: number) {
    if (deltaHours === 0) return;
    const sum = hour + deltaHours;
    const crossed = Math.floor(sum / 24);
    hour = wrap(sum);
    advanceCalendar(crossed);
    GameLunar.advanceHours(deltaHours);
    emit();
  },

  /**
   * Advance naturally. `dtMs` = frame delta in milliseconds.
   * UI listeners fire when the displayed minute changes.
   */
  tick(dtMs: number) {
    if (dtMs <= 0 || dtMs > 5000) return;
    const prevMin = Math.floor(hour * 60);
    const secPerHour = realSecondsPerGameHour();
    const deltaHours = dtMs / 1000 / secPerHour;
    const sum = hour + deltaHours;
    const crossed = Math.floor(sum / 24);
    hour = wrap(sum);
    advanceCalendar(crossed);
    GameLunar.advanceHours(deltaHours);
    if (Math.floor(hour * 60) !== prevMin) emit();
  },

  subscribe(fn: (h: number) => void): () => void {
    listeners.add(fn);
    fn(hour);
    return () => listeners.delete(fn);
  },

  format(h = hour): string {
    const hh = Math.floor(h) % 24;
    const mm = Math.floor((h - Math.floor(h)) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  },

  /** Rough label for HUD (civil GMT−3, not local solar). */
  phase(h = hour): string {
    if (h >= 5 && h < 7) return 'amanecer';
    if (h >= 7 && h < 11) return 'mañana';
    if (h >= 11 && h < 14) return 'mediodía';
    if (h >= 14 && h < 17) return 'tarde';
    if (h >= 17 && h < 19.5) return 'atardecer';
    if (h >= 19.5 || h < 5) return 'noche';
    return '';
  },
};
