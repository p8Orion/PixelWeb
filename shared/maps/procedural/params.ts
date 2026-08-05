/** Tunable knobs per pipeline stage — generator lab edits these live. */

export interface TectonicsParams {
  /** Number of orogeny eras (each era stamps several cordilleras). */
  orogenyCount: number;
  /** Noise frequency for continental platform — higher = finer granularity. */
  continentalScale: number;
  upliftStrength: number;
  /** Geological wear between eras (0..1): cuts height ∝ prominence vs surroundings. */
  erosionWear: number;
  /** Extra height bias before ocean stage (higher → more land). */
  heightBias: number;
  /** Cordillera length as fraction of map diagonal. */
  cordilleraLength: number;
  /** Base influence half-width as fraction of min(mapW, mapH). */
  cordilleraWidth: number;
  /** Internal width pinches/bulges along each cordillera (0..1). */
  cordilleraWidthVariability: number;
  /** Crest height ups/downs along the centerline (0=plano, 1=picos y collados fuertes). */
  cordilleraCrestVariability: number;
  /** How irregular the spacing between curve samples is (0=paso fijo, 1=muy irregular). */
  cordilleraNodeSpacingVar: number;
  /** How much cordillera lengths differ from the base length (0..1). */
  cordilleraLengthVariability: number;
  /** How many cordillera curves to spawn each orogeny era. */
  cordillerasPerEra: number;
  /** Expected eventual curvature flips (inflections); irregular, not periodic. */
  cordilleraMeander: number;
  /** Transverse falloff shape: 0 = suave/redondeado, 1 = afilado. Varies along t. */
  cordilleraFalloffShape: number;
  /** Jagged = how many / how strong off-axis sub-cordilleras (0..1). */
  cordilleraFalloffJagged: number;
  /** How much sub-cordillera pattern varies along t (0=uniforme, 1=tramos distintos). */
  cordilleraJaggedVariability: number;
}

export interface OceanParams {
  /** Target fraction of the map that should be ocean (0–100). */
  oceanPercent: number;
  shelfDepthM: number;
  coastSoften: number;
}

export interface ClimateParams {
  windStrength: number;
  orographicStrength: number;
  oceanCurrentStrength: number;
  lapseRate: number;
  equatorTempC: number;
  poleTempC: number;
  moistureCapacity: number;
  /** Coarse simulation cell size in map pixels (X wraps). */
  cellSize: number;
  /** Jacobi-ish iterations for wind field. */
  windSteps: number;
  /** Iterations for ocean currents. */
  currentSteps: number;
  /** Coriolis strength (0 = off). */
  coriolis: number;
  /** Advection iterations for air temp (wind) and SST (currents). */
  advectionSteps: number;
  /** How strongly flow carries temperature (0..2). */
  advectionStrength: number;
}

export interface RiversParams {
  flowThreshold: number;
  carveStrength: number;
}

export interface BiomesParams {
  /** Unused hooks for later thresholds — kept for extendibility. */
  snowTempC: number;
}

export interface ProceduralParams {
  seed: number;
  width: number;
  height: number;
  tectonics: TectonicsParams;
  ocean: OceanParams;
  climate: ClimateParams;
  rivers: RiversParams;
  biomes: BiomesParams;
}

export const DEFAULT_PROCEDURAL_PARAMS: ProceduralParams = {
  seed: 42,
  width: 2048,
  height: 1024,
  tectonics: {
    orogenyCount: 5,
    continentalScale: 8.3,
    upliftStrength: 2,
    erosionWear: 0.35,
    heightBias: 0,
    cordilleraLength: 0.4,
    cordilleraWidth: 0.18,
    cordilleraWidthVariability: 0.9,
    cordilleraCrestVariability: 0.9,
    cordilleraNodeSpacingVar: 0.65,
    cordilleraLengthVariability: 0.9,
    cordillerasPerEra: 3,
    cordilleraMeander: 4,
    cordilleraFalloffShape: 1,
    cordilleraFalloffJagged: 0.65,
    cordilleraJaggedVariability: 0.85,
  },
  ocean: {
    oceanPercent: 68,
    shelfDepthM: 120,
    coastSoften: 0.4,
  },
  climate: {
    windStrength: 1,
    orographicStrength: 1,
    oceanCurrentStrength: 0.7,
    lapseRate: 6.5,
    equatorTempC: 28,
    poleTempC: -28,
    moistureCapacity: 1,
    cellSize: 32,
    windSteps: 28,
    currentSteps: 36,
    coriolis: 0.45,
    advectionSteps: 20,
    advectionStrength: 1,
  },
  rivers: {
    flowThreshold: 0.55,
    carveStrength: 0.15,
  },
  biomes: {
    snowTempC: -5,
  },
};

export function cloneParams(p: ProceduralParams): ProceduralParams {
  return structuredClone(p);
}
