import { biomesStage } from './biomes.js';
import { climateStage } from './climate.js';
import { oceanStage } from './ocean.js';
import { riversStage } from './rivers.js';
import { tectonicsStage } from './tectonics.js';
import type { ProceduralStage } from './types.js';

const stages: ProceduralStage[] = [
  tectonicsStage,
  oceanStage,
  climateStage,
  riversStage,
  biomesStage,
];

export function listStages(): ProceduralStage[] {
  return stages.slice();
}

export function getStage(id: string): ProceduralStage | undefined {
  return stages.find((s) => s.id === id);
}

export function registerStage(stage: ProceduralStage, index?: number): void {
  const existing = stages.findIndex((s) => s.id === stage.id);
  if (existing >= 0) stages.splice(existing, 1);
  if (index == null || index < 0 || index > stages.length) stages.push(stage);
  else stages.splice(index, 0, stage);
}

export type { ProceduralStage } from './types.js';
