/**
 * Extensible buffer registry for the procedural pipeline.
 * Stages declare reads/writes by name; lab lists whatever is registered.
 */

export type BufferDtype = 'uint8' | 'float32';

export interface BufferDef {
  id: string;
  label: string;
  dtype: BufferDtype;
  /** Stage id that typically owns/writes this buffer (documentation + invalidation hints). */
  ownerStage: string;
  /** Shown in generator lab by default. */
  previewable?: boolean;
}

/** Built-in buffers — add more with registerBuffer() without breaking the runner. */
export const CORE_BUFFERS: BufferDef[] = [
  { id: 'elevation', label: 'Elevación', dtype: 'float32', ownerStage: 'tectonics', previewable: true },
  { id: 'crust', label: 'Corteza (sin orogenia)', dtype: 'float32', ownerStage: 'tectonics', previewable: true },
  { id: 'mountainAge', label: 'Edad montañas', dtype: 'float32', ownerStage: 'tectonics', previewable: true },
  { id: 'landmask', label: 'Tierra/mar', dtype: 'uint8', ownerStage: 'ocean', previewable: true },
  { id: 'windU', label: 'Viento U', dtype: 'float32', ownerStage: 'climate', previewable: false },
  { id: 'windV', label: 'Viento V', dtype: 'float32', ownerStage: 'climate', previewable: false },
  { id: 'currentU', label: 'Corriente U', dtype: 'float32', ownerStage: 'climate', previewable: false },
  { id: 'currentV', label: 'Corriente V', dtype: 'float32', ownerStage: 'climate', previewable: false },
  { id: 'temp', label: 'Temperatura', dtype: 'float32', ownerStage: 'climate', previewable: true },
  { id: 'precip', label: 'Precipitación', dtype: 'float32', ownerStage: 'climate', previewable: true },
  { id: 'river', label: 'Ríos', dtype: 'uint8', ownerStage: 'rivers', previewable: true },
  { id: 'landcover', label: 'Biomas', dtype: 'uint8', ownerStage: 'biomes', previewable: true },
];

const registry = new Map<string, BufferDef>(CORE_BUFFERS.map((b) => [b.id, b]));

export function registerBuffer(def: BufferDef): void {
  registry.set(def.id, def);
}

export function getBufferDef(id: string): BufferDef | undefined {
  return registry.get(id);
}

export function listBuffers(): BufferDef[] {
  return [...registry.values()];
}

export type BufferStore = Record<string, Float32Array | Uint8Array>;

export function allocBuffer(def: BufferDef, n: number): Float32Array | Uint8Array {
  return def.dtype === 'uint8' ? new Uint8Array(n) : new Float32Array(n);
}

export function allocCoreBuffers(width: number, height: number): BufferStore {
  const n = width * height;
  const out: BufferStore = {};
  for (const def of listBuffers()) {
    out[def.id] = allocBuffer(def, n);
  }
  return out;
}
