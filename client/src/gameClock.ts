/**
 * Global game clock — civil hours in [0, 24) as **GMT−3** (UTC−3).
 * Advanced by the WorldScene each frame; sunlight converts to UTC + lon for solar.
 */

/** Real-time seconds for one in-game hour (24 min ≈ full day). */
const REAL_SECONDS_PER_GAME_HOUR = 60;

/** Fixed offset of the displayed clock from UTC (hours). GMT−3 → −3. */
export const CLOCK_UTC_OFFSET_HOURS = -3;

let hour = 10;
const listeners = new Set<(h: number) => void>();

function wrap(h: number): number {
  return ((h % 24) + 24) % 24;
}

function emit() {
  for (const fn of listeners) fn(hour);
}

export const GameClock = {
  get hour(): number {
    return hour;
  },

  /** Civil hour as UTC (for solar / debug). */
  get utcHour(): number {
    return wrap(hour - CLOCK_UTC_OFFSET_HOURS);
  },

  setHour(h: number) {
    hour = wrap(h);
    emit();
  },

  /** Shift by ±hours (e.g. +1 / −1). */
  nudge(deltaHours: number) {
    hour = wrap(hour + deltaHours);
    emit();
  },

  /**
   * Advance naturally. `dtMs` = frame delta in milliseconds.
   * UI listeners fire when the displayed minute changes.
   */
  tick(dtMs: number) {
    if (dtMs <= 0 || dtMs > 5000) return;
    const prevMin = Math.floor(hour * 60);
    hour = wrap(hour + dtMs / 1000 / REAL_SECONDS_PER_GAME_HOUR);
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
