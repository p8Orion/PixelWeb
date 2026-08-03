import type { GameWorldMeta } from '../../../shared/maps/game';
import { previewRgbForCell } from '../../../shared/maps/game';
import {
  MAP_TILE_SIZE,
  decodeMapTile,
  tileCount,
  tileKey,
  tilePixelBounds,
  worldToTile,
  type MapTileData,
} from '../../../shared/maps/tiles';

export type TileSample = {
  elevationM: number | null;
  landcoverCode: number | null;
  land: boolean | null;
};

export type RegionLayers = {
  originX: number;
  originY: number;
  width: number;
  height: number;
  landmask: Uint8Array;
  elevation: Int16Array;
  landcover: Uint8Array;
};

type CachedTile = MapTileData & { order: number };

function layersBaseUrl(worldId: string): string {
  if (!worldId || worldId === 'default') return '/api/maps/world';
  return `/api/maps/worlds/${encodeURIComponent(worldId)}`;
}

export async function fetchWorldMeta(worldId: string): Promise<GameWorldMeta> {
  const base = layersBaseUrl(worldId);
  const res = await fetch(`${base}/meta`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { hint?: string }).hint ||
        `Servidor sin mapa (${res.status}). Corré maps:build -- --world=${worldId}`,
    );
  }
  const meta = (await res.json()) as GameWorldMeta;
  if (!meta.tileSize) meta.tileSize = MAP_TILE_SIZE;
  return meta;
}

export function tilePreviewImageData(tile: MapTileData): ImageData {
  const { tw, th, landmask, elevation, landcover } = tile;
  const data = new Uint8ClampedArray(tw * th * 4);
  for (let i = 0; i < tw * th; i++) {
    const [r, g, b] = previewRgbForCell(landcover[i], elevation[i], landmask[i] === 1);
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }
  return new ImageData(data, tw, th);
}

const MAX_TILES = 64;
const MARGIN_TILES = 1;

export class TileStore {
  readonly worldId: string;
  readonly meta: GameWorldMeta;
  readonly tileSize: number;
  readonly baseUrl: string;

  private cache = new Map<string, CachedTile>();
  private inflight = new Map<string, Promise<CachedTile | null>>();
  private lru = 0;
  private wanted = new Set<string>();

  onTileReady?: (tile: MapTileData) => void;
  onTileEvicted?: (tx: number, ty: number) => void;
  onRegionChanged?: (region: RegionLayers | null) => void;

  private regionDirty = false;
  private regionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(worldId: string, meta: GameWorldMeta) {
    this.worldId = worldId;
    this.meta = meta;
    this.tileSize = meta.tileSize ?? MAP_TILE_SIZE;
    this.baseUrl = layersBaseUrl(worldId);
  }

  get mapWidth(): number {
    return this.meta.width;
  }

  get mapHeight(): number {
    return this.meta.height;
  }

  /** Sync wanted tiles to camera worldView (Phaser-style rect). */
  syncToView(view: { x: number; y: number; width: number; height: number }): void {
    const ts = this.tileSize;
    const maxTx = tileCount(this.mapWidth, ts) - 1;
    const maxTy = tileCount(this.mapHeight, ts) - 1;

    let tx0 = worldToTile(view.x, ts) - MARGIN_TILES;
    let ty0 = worldToTile(view.y, ts) - MARGIN_TILES;
    let tx1 = worldToTile(view.x + view.width, ts) + MARGIN_TILES;
    let ty1 = worldToTile(view.y + view.height, ts) + MARGIN_TILES;
    tx0 = Math.max(0, tx0);
    ty0 = Math.max(0, ty0);
    tx1 = Math.min(maxTx, tx1);
    ty1 = Math.min(maxTy, ty1);

    // Cap tile count: expand stride if viewport too large (zoomed out)
    let stride = 1;
    while (true) {
      const nx = Math.floor((tx1 - tx0) / stride) + 1;
      const ny = Math.floor((ty1 - ty0) / stride) + 1;
      if (nx * ny <= MAX_TILES || stride > 8) break;
      stride++;
    }

    const next = new Set<string>();
    for (let ty = ty0; ty <= ty1; ty += stride) {
      for (let tx = tx0; tx <= tx1; tx += stride) {
        next.add(tileKey(tx, ty));
      }
    }
    this.wanted = next;

    for (const key of next) {
      if (!this.cache.has(key) && !this.inflight.has(key)) {
        const [tx, ty] = key.split(',').map(Number);
        void this.fetchTile(tx, ty);
      } else if (this.cache.has(key)) {
        this.cache.get(key)!.order = ++this.lru;
      }
    }

    this.evict();
  }

  private async fetchTile(tx: number, ty: number): Promise<CachedTile | null> {
    const key = tileKey(tx, ty);
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const p = (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/tiles/${tx}/${ty}`);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        const tile = decodeMapTile(buf);
        const cached: CachedTile = { ...tile, order: ++this.lru };
        this.cache.set(key, cached);
        this.onTileReady?.(tile);
        this.scheduleRegionRebuild();
        return cached;
      } catch (err) {
        console.warn('[tiles] fetch failed', tx, ty, err);
        return null;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, p);
    return p;
  }

  private evict(): void {
    if (this.cache.size <= MAX_TILES) return;
    const entries = [...this.cache.entries()].sort((a, b) => a[1].order - b[1].order);
    while (this.cache.size > MAX_TILES && entries.length) {
      const [key, tile] = entries.shift()!;
      if (this.wanted.has(key)) continue;
      this.cache.delete(key);
      this.onTileEvicted?.(tile.tx, tile.ty);
      this.scheduleRegionRebuild();
    }
  }

  private scheduleRegionRebuild(): void {
    this.regionDirty = true;
    if (this.regionTimer) return;
    this.regionTimer = setTimeout(() => {
      this.regionTimer = null;
      if (!this.regionDirty) return;
      this.regionDirty = false;
      this.onRegionChanged?.(this.buildRegionLayers());
    }, 120);
  }

  sample(worldX: number, worldY: number): TileSample {
    const ts = this.tileSize;
    const tx = worldToTile(worldX, ts);
    const ty = worldToTile(worldY, ts);
    const tile = this.cache.get(tileKey(tx, ty));
    if (!tile) return { elevationM: null, landcoverCode: null, land: null };
    const lx = Math.floor(worldX) - tx * ts;
    const ly = Math.floor(worldY) - ty * ts;
    if (lx < 0 || ly < 0 || lx >= tile.tw || ly >= tile.th) {
      return { elevationM: null, landcoverCode: null, land: null };
    }
    const i = ly * tile.tw + lx;
    return {
      elevationM: tile.elevation[i],
      landcoverCode: tile.landcover[i],
      land: tile.landmask[i] === 1,
    };
  }

  /** AABB of cached tiles as contiguous buffers (for FX). */
  buildRegionLayers(): RegionLayers | null {
    if (this.cache.size === 0) return null;
    let minTx = Infinity;
    let minTy = Infinity;
    let maxTx = -Infinity;
    let maxTy = -Infinity;
    for (const t of this.cache.values()) {
      minTx = Math.min(minTx, t.tx);
      minTy = Math.min(minTy, t.ty);
      maxTx = Math.max(maxTx, t.tx);
      maxTy = Math.max(maxTy, t.ty);
    }
    const ts = this.tileSize;
    const { x0: originX, y0: originY } = tilePixelBounds(minTx, minTy, this.mapWidth, this.mapHeight, ts);
    const last = tilePixelBounds(maxTx, maxTy, this.mapWidth, this.mapHeight, ts);
    const width = last.x0 + last.tw - originX;
    const height = last.y0 + last.th - originY;
    if (width <= 0 || height <= 0) return null;

    const n = width * height;
    const landmask = new Uint8Array(n);
    const elevation = new Int16Array(n);
    const landcover = new Uint8Array(n);
    // default ocean / unknown
    landmask.fill(0);
    elevation.fill(-100);
    landcover.fill(0);

    for (const t of this.cache.values()) {
      const ox = t.tx * ts - originX;
      const oy = t.ty * ts - originY;
      for (let row = 0; row < t.th; row++) {
        const src = row * t.tw;
        const dst = (oy + row) * width + ox;
        landmask.set(t.landmask.subarray(src, src + t.tw), dst);
        landcover.set(t.landcover.subarray(src, src + t.tw), dst);
        elevation.set(t.elevation.subarray(src, src + t.tw), dst);
      }
    }

    return { originX, originY, width, height, landmask, elevation, landcover };
  }

  destroy(): void {
    if (this.regionTimer) clearTimeout(this.regionTimer);
    this.cache.clear();
    this.inflight.clear();
  }
}
