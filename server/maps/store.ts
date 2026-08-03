import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IngestedWorld, IngestedWorldMeta } from '../../shared/maps/ingest.js';
import type { GameWorldLayers } from '../../shared/maps/game.js';
import { getMapWorld, listMapWorlds, type MapWorldDef } from '../../shared/maps/worlds.js';
import { interpretWorld } from './interpret/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function worldIngestedDir(worldId: string): string {
  return path.join(root, getMapWorld(worldId).ingestedRel);
}

export function worldInterpretedDir(worldId: string, profile: string): string {
  return path.join(root, getMapWorld(worldId).interpretedRel, profile);
}

/** @deprecated use worldIngestedDir('default') */
export const DATA = {
  get ingested() {
    return worldIngestedDir('default');
  },
  get interpreted() {
    return path.join(root, getMapWorld('default').interpretedRel);
  },
};

async function readBin(file: string): Promise<Buffer> {
  return fs.readFile(file);
}

function asUint8(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function asInt16(buf: Buffer): Int16Array {
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Int16Array(copy);
}

export async function loadIngested(dirOrWorldId?: string): Promise<IngestedWorld> {
  const dir =
    dirOrWorldId && !dirOrWorldId.includes(path.sep) && !dirOrWorldId.includes('/')
      ? worldIngestedDir(dirOrWorldId)
      : dirOrWorldId || worldIngestedDir('default');

  const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')) as IngestedWorldMeta;
  if (meta.kind !== 'ingested') throw new Error('meta.json is not kind=ingested');

  const n = meta.width * meta.height;
  const elevBuf = await readBin(path.join(dir, meta.channels.elevation.file));
  const elevation = asInt16(elevBuf);
  if (elevation.length !== n) {
    throw new Error(`elevation length ${elevation.length} != ${n}`);
  }

  let basemapRgba: Uint8Array | null = null;
  if (meta.channels.basemap) {
    try {
      const buf = await readBin(path.join(dir, meta.channels.basemap.file));
      basemapRgba = asUint8(buf);
      if (basemapRgba.length !== n * 4) {
        console.warn(`basemap length mismatch — ignoring`);
        basemapRgba = null;
      }
    } catch {
      basemapRgba = null;
    }
  }

  let coverRaw: Uint8Array | null = null;
  if (meta.channels.coverRaw) {
    const buf = await readBin(path.join(dir, meta.channels.coverRaw.file));
    coverRaw = asUint8(buf);
    if (coverRaw.length !== n) {
      throw new Error(`coverRaw length ${coverRaw.length} != ${n}`);
    }
  }

  let hydroRaw: Uint8Array | null = null;
  if (meta.channels.hydroRaw) {
    const buf = await readBin(path.join(dir, meta.channels.hydroRaw.file));
    hydroRaw = asUint8(buf);
    if (hydroRaw.length !== n) {
      throw new Error(`hydroRaw length ${hydroRaw.length} != ${n}`);
    }
  }

  let hydroWidth: Uint8Array | null = null;
  if (meta.channels.hydroWidth) {
    const buf = await readBin(path.join(dir, meta.channels.hydroWidth.file));
    hydroWidth = asUint8(buf);
    if (hydroWidth.length !== n) {
      throw new Error(`hydroWidth length ${hydroWidth.length} != ${n}`);
    }
  }

  return { meta, elevation, basemapRgba, coverRaw, hydroRaw, hydroWidth };
}

async function writeBin(file: string, data: Uint8Array | Int16Array): Promise<void> {
  await fs.writeFile(file, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}

export async function persistInterpreted(
  layers: GameWorldLayers,
  worldId = layers.meta.worldId || 'default',
): Promise<string> {
  const dir = worldInterpretedDir(worldId, layers.meta.profile);
  await fs.mkdir(dir, { recursive: true });
  await writeBin(path.join(dir, 'landmask.bin'), layers.landmask);
  await writeBin(path.join(dir, 'elevation.bin'), layers.elevation);
  await writeBin(path.join(dir, 'landcover.bin'), layers.landcover);
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(layers.meta, null, 2));
  return dir;
}

export async function loadPersistedInterpreted(
  worldId: string,
  profile: string,
): Promise<GameWorldLayers | null> {
  const dir = worldInterpretedDir(worldId, profile);
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    if (meta.kind !== 'interpreted') return null;
    const n = meta.width * meta.height;
    const maskBuf = await readBin(path.join(dir, meta.layers.landmask.file));
    const elevBuf = await readBin(path.join(dir, meta.layers.elevation.file));
    const coverBuf = await readBin(path.join(dir, meta.layers.landcover.file));
    const landmask = asUint8(maskBuf);
    const elevation = asInt16(elevBuf);
    const landcover = asUint8(coverBuf);
    if (landmask.length !== n || elevation.length !== n || landcover.length !== n) return null;
    if (!meta.worldId) meta.worldId = worldId;
    return { meta, landmask, elevation, landcover };
  } catch {
    return null;
  }
}

const cache = new Map<string, GameWorldLayers>();
/** Last world touched — used for legacy /world routes + room size fallback. */
let activeWorldId: string | null = null;

export function getActiveWorld(): GameWorldLayers | null {
  if (!activeWorldId) return null;
  return cache.get(activeWorldId) ?? null;
}

export function getWorld(worldId: string): GameWorldLayers | null {
  return cache.get(worldId) ?? null;
}

export function setWorld(worldId: string, layers: GameWorldLayers): void {
  cache.set(worldId, layers);
  activeWorldId = worldId;
}

/** @deprecated */
export function setActiveWorld(layers: GameWorldLayers): void {
  const id = layers.meta.worldId || 'default';
  setWorld(id, layers);
}

export async function worldAvailability(): Promise<
  Array<
    Omit<MapWorldDef, 'width' | 'height'> & {
      ready: boolean;
      width: number | null;
      height: number | null;
      catalogWidth: number;
      catalogHeight: number;
    }
  >
> {
  const out = [];
  for (const def of listMapWorlds()) {
    const base = {
      id: def.id,
      label: def.label,
      hint: def.hint,
      ingestedRel: def.ingestedRel,
      interpretedRel: def.interpretedRel,
      hydroStrokeScale: def.hydroStrokeScale,
      elevZoom: def.elevZoom,
      catalogWidth: def.width,
      catalogHeight: def.height,
    };
    const cached = cache.get(def.id);
    if (cached) {
      out.push({
        ...base,
        ready: true,
        width: cached.meta.width,
        height: cached.meta.height,
      });
      continue;
    }
    const disk = await loadPersistedInterpreted(def.id, process.env.MAP_PROFILE || 'default');
    if (disk) {
      cache.set(def.id, disk);
      out.push({
        ...base,
        ready: true,
        width: disk.meta.width,
        height: disk.meta.height,
      });
    } else {
      out.push({ ...base, ready: false, width: null, height: null });
    }
  }
  return out;
}

/**
 * Ensure a map world is loaded:
 * 1) memory 2) disk cache 3) interpret from that world's ingest
 */
export async function ensureGameWorld(
  worldId = process.env.MAP_WORLD || 'default',
  profile = process.env.MAP_PROFILE || 'default',
): Promise<GameWorldLayers> {
  const hit = cache.get(worldId);
  if (hit && hit.meta.profile === profile) {
    activeWorldId = worldId;
    return hit;
  }

  const cached = await loadPersistedInterpreted(worldId, profile);
  if (cached) {
    setWorld(worldId, cached);
    console.log(
      `Maps: loaded world="${worldId}" profile="${profile}" ${cached.meta.width}×${cached.meta.height}`,
    );
    return cached;
  }

  const ingested = await loadIngested(worldId);
  const layers = interpretWorld(ingested, profile, { worldId });
  await persistInterpreted(layers, worldId);
  setWorld(worldId, layers);
  console.log(
    `Maps: interpreted world="${worldId}" profile="${profile}" → ${getMapWorld(worldId).interpretedRel}/${profile}`,
  );
  return layers;
}

/** Boot helper: load every world that already has interpreted data on disk. */
export async function ensureAllReadyWorlds(
  profile = process.env.MAP_PROFILE || 'default',
): Promise<void> {
  for (const def of listMapWorlds()) {
    try {
      await ensureGameWorld(def.id, profile);
    } catch (err) {
      console.warn(`Maps: world "${def.id}" not ready — ${String(err)}`);
    }
  }
}
