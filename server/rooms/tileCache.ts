import { tileKey } from '../../shared/maps/tiles.js';

const DEFAULT_MAX = 256;

/** LRU cache of merged (base ⊕ overlay) tile buffers keyed by roomId:tx,ty. */
export class MergedTileCache {
  private cache = new Map<string, { buf: Buffer; order: number }>();
  private order = 0;
  private readonly maxEntries: number;

  constructor(maxEntries = DEFAULT_MAX) {
    this.maxEntries = maxEntries;
  }

  private key(roomId: string, tx: number, ty: number): string {
    return `${roomId}:${tileKey(tx, ty)}`;
  }

  get(roomId: string, tx: number, ty: number): Buffer | null {
    const k = this.key(roomId, tx, ty);
    const hit = this.cache.get(k);
    if (!hit) return null;
    hit.order = ++this.order;
    return hit.buf;
  }

  set(roomId: string, tx: number, ty: number, buf: Buffer): void {
    const k = this.key(roomId, tx, ty);
    this.cache.set(k, { buf, order: ++this.order });
    this.evict();
  }

  invalidate(roomId: string, tiles?: Array<{ tx: number; ty: number }>): void {
    if (!tiles) {
      const prefix = `${roomId}:`;
      for (const k of [...this.cache.keys()]) {
        if (k.startsWith(prefix)) this.cache.delete(k);
      }
      return;
    }
    for (const { tx, ty } of tiles) {
      this.cache.delete(this.key(roomId, tx, ty));
    }
  }

  private evict(): void {
    if (this.cache.size <= this.maxEntries) return;
    const entries = [...this.cache.entries()].sort((a, b) => a[1].order - b[1].order);
    while (this.cache.size > this.maxEntries && entries.length) {
      const [k] = entries.shift()!;
      this.cache.delete(k);
    }
  }
}

export const mergedTileCache = new MergedTileCache();
