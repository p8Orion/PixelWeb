import type { ProceduralContext } from '../context.js';
import type { ProceduralParams } from '../params.js';

export interface ProceduralStage {
  id: string;
  label: string;
  description: string;
  /** Param group key on ProceduralParams (tectonics | ocean | …). */
  paramsKey: keyof Omit<ProceduralParams, 'seed' | 'width' | 'height'>;
  run(ctx: ProceduralContext): void | Promise<void>;
}
