/**
 * Named map worlds — separate ingest/interpret trees, shared game rules.
 * Solar FX uses equirectangular lat/lon from pixel UV; works for any W×H.
 */

import { HYDRO_INTERPRET } from './hydro.js';

export interface MapWorldDef {
  id: string;
  /** Boot UI label */
  label: string;
  /** Short hint under the selector */
  hint: string;
  /** Paths relative to repo root */
  ingestedRel: string;
  /** Interpreted profiles live under `${interpretedRel}/<profile>/` */
  interpretedRel: string;
  /**
   * River dilation: radiusPx = round(strokeweig * hydroStrokeScale).
   * Scale with grid so geographic river width stays stable (×3 grid → ×3 scale).
   */
  hydroStrokeScale: number;
  /** Suggested ingest size / elev zoom (scripts use these with --world=). */
  width: number;
  height: number;
  elevZoom: number;
}

/** Legacy 4k world — existing data/ingested + data/interpreted. */
export const MAP_WORLD_DEFAULT: MapWorldDef = {
  id: 'default',
  label: 'Tierra 4k (actual)',
  hint: '4096×2048 · elev z4 · ríos ×1',
  ingestedRel: 'data/ingested',
  interpretedRel: 'data/interpreted',
  hydroStrokeScale: HYDRO_INTERPRET.strokeScale,
  width: 4096,
  height: 2048,
  elevZoom: 4,
};

/** 3× linear grid, elev z6, river brush strokeScale 1.5. */
export const MAP_WORLD_EARTH3X: MapWorldDef = {
  id: 'earth3x',
  label: 'Tierra 12k (×3)',
  hint: '12288×6144 · elev z6 · ríos stroke 2',
  ingestedRel: 'data/worlds/earth3x/ingested',
  interpretedRel: 'data/worlds/earth3x/interpreted',
  hydroStrokeScale: 2,
  width: 12288,
  height: 6144,
  elevZoom: 6,
};

export const MAP_WORLDS: Record<string, MapWorldDef> = {
  [MAP_WORLD_DEFAULT.id]: MAP_WORLD_DEFAULT,
  [MAP_WORLD_EARTH3X.id]: MAP_WORLD_EARTH3X,
};

export const MAP_WORLD_IDS = Object.keys(MAP_WORLDS) as string[];

export function getMapWorld(id: string): MapWorldDef {
  const w = MAP_WORLDS[id];
  if (!w) {
    throw new Error(`Unknown map world "${id}". Known: ${MAP_WORLD_IDS.join(', ')}`);
  }
  return w;
}

export function listMapWorlds(): MapWorldDef[] {
  return Object.values(MAP_WORLDS);
}
