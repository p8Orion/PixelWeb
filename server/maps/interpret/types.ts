import type { IngestedWorld } from '../../../shared/maps/ingest.js';
import type { GameWorldLayers } from '../../../shared/maps/game.js';

export interface InterpretNotes {
  landmask: string;
  landcover: string;
  elevation: string;
}

export interface InterpretOptions {
  /** Overrides HYDRO_INTERPRET.strokeScale for this run / world. */
  hydroStrokeScale?: number;
}

/** Swappable rules: ingested channels → game concepts. */
export interface InterpretProfile {
  id: string;
  description: string;
  interpret(
    ingested: IngestedWorld,
    opts?: InterpretOptions,
  ): {
    landmask: Uint8Array;
    elevation: Int16Array;
    landcover: Uint8Array;
    notes: InterpretNotes;
  };
}

export type InterpretedBundle = {
  layers: GameWorldLayers;
};
