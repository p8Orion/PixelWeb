import { createContext, type ProceduralContext } from './context.js';
import { cloneParams, type ProceduralParams } from './params.js';
import { listStages } from './stages/index.js';

export type StageProgress = {
  phase: 'start' | 'done' | 'alloc';
  stageIndex?: number;
  stageId?: string;
  stageLabel?: string;
  ms?: number;
  message: string;
};

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      // Double-rAF so the browser can paint status/log before a heavy stage.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      return;
    }
    setTimeout(resolve, 0);
  });
}

/**
 * Run stages from `fromIndex` through the end (partial rerun).
 * Stages before `fromIndex` are assumed valid in ctx.buffers.
 */
export async function runFrom(ctx: ProceduralContext, fromIndex: number): Promise<void> {
  await runFromAsync(ctx, fromIndex);
}

/** Same as runFrom, but yields between stages and reports progress (for the lab UI). */
export async function runFromAsync(
  ctx: ProceduralContext,
  fromIndex: number,
  onProgress?: (p: StageProgress) => void,
): Promise<void> {
  const stages = listStages();
  const start = Math.max(0, Math.min(fromIndex, stages.length));
  for (let i = start; i < stages.length; i++) {
    const stage = stages[i];
    onProgress?.({
      phase: 'start',
      stageIndex: i,
      stageId: stage.id,
      stageLabel: stage.label,
      message: `▶ ${stage.label}`,
    });
    await yieldToUi();
    const t0 = performance.now();
    await Promise.resolve(stage.run(ctx));
    ctx.completedThrough = i;
    const ms = performance.now() - t0;
    onProgress?.({
      phase: 'done',
      stageIndex: i,
      stageId: stage.id,
      stageLabel: stage.label,
      ms,
      message: `✓ ${stage.label} · ${ms.toFixed(0)} ms`,
    });
  }
}

export async function runAll(ctx: ProceduralContext): Promise<void> {
  ctx.completedThrough = -1;
  await runFrom(ctx, 0);
}

export async function runAllAsync(
  ctx: ProceduralContext,
  onProgress?: (p: StageProgress) => void,
): Promise<void> {
  ctx.completedThrough = -1;
  await runFromAsync(ctx, 0, onProgress);
}

/** Map a params-group key to the stage index that owns it. */
export function stageIndexForParamsKey(
  key: keyof Omit<ProceduralParams, 'seed' | 'width' | 'height'>,
): number {
  const stages = listStages();
  const idx = stages.findIndex((s) => s.paramsKey === key);
  return idx < 0 ? 0 : idx;
}

/**
 * Apply new params and rerun from the earliest affected stage.
 * Changing seed/width/height forces a full rebuild (new context).
 */
export async function applyParams(
  ctx: ProceduralContext,
  next: ProceduralParams,
  changed: {
    seed?: boolean;
    size?: boolean;
    groups?: Array<keyof Omit<ProceduralParams, 'seed' | 'width' | 'height'>>;
  } = {},
): Promise<ProceduralContext> {
  return applyParamsAsync(ctx, next, changed);
}

export async function applyParamsAsync(
  ctx: ProceduralContext,
  next: ProceduralParams,
  changed: {
    seed?: boolean;
    size?: boolean;
    groups?: Array<keyof Omit<ProceduralParams, 'seed' | 'width' | 'height'>>;
  } = {},
  onProgress?: (p: StageProgress) => void,
): Promise<ProceduralContext> {
  if (
    changed.size ||
    next.width !== ctx.width ||
    next.height !== ctx.height
  ) {
    onProgress?.({
      phase: 'alloc',
      message: `Alloc ${next.width}×${next.height} buffers…`,
    });
    await yieldToUi();
    const fresh = createContext(next);
    if (onProgress) {
      fresh.onLog = (message) => onProgress({ phase: 'start', message });
    }
    await runAllAsync(fresh, onProgress);
    return fresh;
  }

  if (changed.seed || next.seed !== ctx.seed) {
    ctx.seed = next.seed;
    ctx.params = cloneParams(next);
    if (onProgress) {
      ctx.onLog = (message) => onProgress({ phase: 'start', message });
    }
    await runAllAsync(ctx, onProgress);
    return ctx;
  }

  ctx.params = cloneParams(next);
  let from = listStages().length;
  for (const g of changed.groups ?? []) {
    from = Math.min(from, stageIndexForParamsKey(g));
  }
  if (!changed.groups || changed.groups.length === 0) {
    from = 0;
  }
  if (onProgress) {
    ctx.onLog = (message) => onProgress({ phase: 'start', message });
  }
  await runFromAsync(ctx, from, onProgress);
  return ctx;
}

export async function createAndRun(params: ProceduralParams): Promise<ProceduralContext> {
  return createAndRunAsync(params);
}

export async function createAndRunAsync(
  params: ProceduralParams,
  onProgress?: (p: StageProgress) => void,
): Promise<ProceduralContext> {
  onProgress?.({
    phase: 'alloc',
    message: `Alloc ${params.width}×${params.height} buffers…`,
  });
  await yieldToUi();
  const ctx = createContext(params);
  if (onProgress) {
    ctx.onLog = (message) => onProgress({ phase: 'start', message });
  }
  await runAllAsync(ctx, onProgress);
  return ctx;
}
