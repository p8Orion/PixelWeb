/**
 * Lunar cycle driven by game-time hours.
 *
 * `quarterDays` = real length of one phase quarter (nueva→creciente, etc.)
 * in game days. Full cycle = 4 × quarterDays (default 4 game days).
 *
 * Illumination 0..1 (new→full→new via cosine).
 * Shader moon intensity maps that to [MOON_SHADER_MIN, 1].
 */

export type LunarPhaseKind = 'nueva' | 'creciente' | 'llena' | 'menguante';

export const DEFAULT_LUNAR_QUARTER_DAYS = 1;
export const LUNAR_QUARTER_DAYS_MIN = 0.25;
export const LUNAR_QUARTER_DAYS_MAX = 14;

/** Shader floor under new moon (user range 0.2 … 1). */
export const MOON_SHADER_MIN = 0.2;

const PHASE_ICONS: Record<LunarPhaseKind, string> = {
  nueva: '🌑',
  creciente: '🌓',
  llena: '🌕',
  menguante: '🌗',
};

const PHASE_LABELS: Record<LunarPhaseKind, string> = {
  nueva: 'nueva',
  creciente: 'creciente',
  llena: 'llena',
  menguante: 'menguante',
};

/** Cycle position in [0, 1). 0 = new, 0.5 = full. */
let age = 0.5; // start near full so nights aren't pitch-black on boot
let quarterDays = DEFAULT_LUNAR_QUARTER_DAYS;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function wrap01(x: number): number {
  return ((x % 1) + 1) % 1;
}

function cycleGameHours(): number {
  return Math.max(LUNAR_QUARTER_DAYS_MIN, quarterDays) * 4 * 24;
}

export function getLunarQuarterDays(): number {
  return quarterDays;
}

export function setLunarQuarterDays(days: number) {
  const n = Number(days);
  if (!Number.isFinite(n)) return;
  const clamped = Math.min(LUNAR_QUARTER_DAYS_MAX, Math.max(LUNAR_QUARTER_DAYS_MIN, n));
  quarterDays = Math.round(clamped * 100) / 100;
}

/** Fraction of lit lunar disk 0..1 (new → full → new). */
export function lunarIllumination(a = age): number {
  return (1 - Math.cos(a * Math.PI * 2)) / 2;
}

/** Value pushed to the sunlight shader [0.2, 1]. */
export function lunarShaderIntensity(a = age): number {
  return MOON_SHADER_MIN + (1 - MOON_SHADER_MIN) * lunarIllumination(a);
}

export function lunarPhaseKind(a = age): LunarPhaseKind {
  // Quarters centered on 0 / 0.25 / 0.5 / 0.75
  if (a < 0.125 || a >= 0.875) return 'nueva';
  if (a < 0.375) return 'creciente';
  if (a < 0.625) return 'llena';
  return 'menguante';
}

export function lunarPhaseIcon(kind = lunarPhaseKind()): string {
  return PHASE_ICONS[kind];
}

export function lunarPhaseLabel(kind = lunarPhaseKind()): string {
  return PHASE_LABELS[kind];
}

export const GameLunar = {
  get age(): number {
    return age;
  },

  get illumination(): number {
    return lunarIllumination();
  },

  get shaderIntensity(): number {
    return lunarShaderIntensity();
  },

  get kind(): LunarPhaseKind {
    return lunarPhaseKind();
  },

  get icon(): string {
    return lunarPhaseIcon();
  },

  get label(): string {
    return lunarPhaseLabel();
  },

  /** Advance by game-time hours (from GameClock tick/nudge). */
  advanceHours(deltaHours: number) {
    if (!Number.isFinite(deltaHours) || deltaHours === 0) return;
    const prevKind = lunarPhaseKind();
    const prevIllumBucket = Math.floor(lunarIllumination() * 100);
    age = wrap01(age + deltaHours / cycleGameHours());
    const kind = lunarPhaseKind();
    const illumBucket = Math.floor(lunarIllumination() * 100);
    if (kind !== prevKind || illumBucket !== prevIllumBucket) emit();
  },

  setAge(next: number) {
    age = wrap01(next);
    emit();
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    fn();
    return () => listeners.delete(fn);
  },
};
