import { allocCoreBuffers, type BufferStore } from './buffers.js';
import { cloneParams, type ProceduralParams } from './params.js';

/** Legacy polyline (centerline only). */
export interface OrogenyTrace {
  era: number;
  points: Array<{ x: number; y: number }>;
}

/** One orogeny cordillera: a curve with local influence weight (px) per vertex. */
export interface CordilleraPoint {
  x: number;
  y: number;
  /** Half-width of influence at this vertex, in map pixels. */
  weight: number;
  /** Crest height factor along the axis (1 = full peakM at this t). */
  crest: number;
}

export interface Cordillera {
  /** 1-based era index. */
  era: number;
  points: CordilleraPoint[];
}

export interface ProceduralContext {
  width: number;
  height: number;
  seed: number;
  params: ProceduralParams;
  buffers: BufferStore;
  completedThrough: number;
  oceanElevShiftM?: number;
  onLog?: (message: string) => void;
  /** Optional live preview hook (e.g. after crust / each orogeny era). */
  onPreview?: () => void;
  orogenyTraces?: OrogenyTrace[];
  /** Per-era uplift meters for tint / elevation. */
  orogenyEraUplift?: Float32Array[];
  /** Geometric cordilleras (curve + weights) for orogeny view. */
  cordilleras?: Cordillera[];
}

export function createContext(params: ProceduralParams): ProceduralContext {
  const { width, height, seed } = params;
  return {
    width,
    height,
    seed,
    params: cloneParams(params),
    buffers: allocCoreBuffers(width, height),
    completedThrough: -1,
    orogenyTraces: [],
    cordilleras: [],
  };
}

export function idx(ctx: ProceduralContext, x: number, y: number): number {
  return y * ctx.width + x;
}

export function stageSeed(ctx: ProceduralContext, stageSalt: number): number {
  return (ctx.seed * 1664525 + stageSalt * 1013904223) >>> 0;
}
