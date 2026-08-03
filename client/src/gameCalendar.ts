/**
 * Global game calendar — day of year for seasons / solar declination.
 * Independent of map projection; sunlight FX opts in when the map has geo.
 */

let dayOfYear = 215; // ~3 Aug — invierno austral / verano boreal
const listeners = new Set<(d: number) => void>();

function wrapDay(d: number): number {
  const x = ((Math.floor(d) - 1) % 365 + 365) % 365;
  return x + 1; // 1..365
}

function emit() {
  for (const fn of listeners) fn(dayOfYear);
}

/** Approximate month index 0–11 from day-of-year (non-leap). */
export function monthIndexFromDay(d: number): number {
  const ends = [31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
  for (let i = 0; i < 12; i++) if (d <= ends[i]) return i;
  return 11;
}

const MONTH_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

export const GameCalendar = {
  get dayOfYear(): number {
    return dayOfYear;
  },

  setDayOfYear(d: number) {
    dayOfYear = wrapDay(d);
    emit();
  },

  /** Shift by whole days (wraps over the year). */
  nudgeDays(delta: number) {
    dayOfYear = wrapDay(dayOfYear + delta);
    emit();
  },

  subscribe(fn: (d: number) => void): () => void {
    listeners.add(fn);
    fn(dayOfYear);
    return () => listeners.delete(fn);
  },

  /** e.g. "3 ago" */
  format(d = dayOfYear): string {
    const m = monthIndexFromDay(d);
    const starts = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
    const dom = d - starts[m] + 1;
    return `${dom} ${MONTH_SHORT[m]}`;
  },

  /**
   * Estación astronómica en hemisferio sur (reloj GMT−3).
   * Equinoccios/solsticios ≈ días 80 / 172 / 265 / 355.
   */
  season(d = dayOfYear): 'verano' | 'otoño' | 'invierno' | 'primavera' {
    if (d >= 355 || d < 80) return 'verano';
    if (d < 172) return 'otoño';
    if (d < 265) return 'invierno';
    return 'primavera';
  },
};
