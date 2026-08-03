/** Logical map tile streaming — shared by server crop + client store. */

export const MAP_TILE_SIZE = 256 as const;

export const TILE_MAGIC = 0x4c545750; // 'PWTL' LE

export interface TileHeader {
  tx: number;
  ty: number;
  tw: number;
  th: number;
  tileSize: number;
}

export interface MapTileData extends TileHeader {
  landmask: Uint8Array;
  elevation: Int16Array;
  landcover: Uint8Array;
}

export function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

export function worldToTile(px: number, tileSize = MAP_TILE_SIZE): number {
  return Math.floor(px / tileSize);
}

export function tileCount(mapSize: number, tileSize = MAP_TILE_SIZE): number {
  return Math.ceil(mapSize / tileSize);
}

export function tilePixelBounds(
  tx: number,
  ty: number,
  mapW: number,
  mapH: number,
  tileSize = MAP_TILE_SIZE,
): { x0: number; y0: number; tw: number; th: number } {
  const x0 = tx * tileSize;
  const y0 = ty * tileSize;
  const tw = Math.max(0, Math.min(tileSize, mapW - x0));
  const th = Math.max(0, Math.min(tileSize, mapH - y0));
  return { x0, y0, tw, th };
}

/** Pack tile for HTTP body (little-endian). */
export function encodeMapTile(tile: MapTileData): Buffer {
  const { tx, ty, tw, th, tileSize, landmask, elevation, landcover } = tile;
  const n = tw * th;
  const headerBytes = 20;
  const buf = Buffer.alloc(headerBytes + n + n * 2 + n);
  buf.writeUInt32LE(TILE_MAGIC, 0);
  buf.writeUInt16LE(1, 4); // version
  buf.writeUInt16LE(tileSize, 6);
  buf.writeInt32LE(tx, 8);
  buf.writeInt32LE(ty, 12);
  buf.writeUInt16LE(tw, 16);
  buf.writeUInt16LE(th, 18);
  let o = headerBytes;
  Buffer.from(landmask.buffer, landmask.byteOffset, n).copy(buf, o);
  o += n;
  Buffer.from(elevation.buffer, elevation.byteOffset, n * 2).copy(buf, o);
  o += n * 2;
  Buffer.from(landcover.buffer, landcover.byteOffset, n).copy(buf, o);
  return buf;
}

export function decodeMapTile(buf: ArrayBuffer | ArrayBufferView | Buffer): MapTileData {
  const u8 =
    buf instanceof ArrayBuffer
      ? new Uint8Array(buf)
      : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== TILE_MAGIC) throw new Error(`Bad tile magic ${magic}`);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`Unsupported tile version ${version}`);
  const tileSize = view.getUint16(6, true);
  const tx = view.getInt32(8, true);
  const ty = view.getInt32(12, true);
  const tw = view.getUint16(16, true);
  const th = view.getUint16(18, true);
  const n = tw * th;
  let o = 20;
  const landmask = new Uint8Array(n);
  landmask.set(u8.subarray(o, o + n));
  o += n;
  const elevBytes = new Uint8Array(n * 2);
  elevBytes.set(u8.subarray(o, o + n * 2));
  const elevation = new Int16Array(elevBytes.buffer);
  o += n * 2;
  const landcover = new Uint8Array(n);
  landcover.set(u8.subarray(o, o + n));
  return { tx, ty, tw, th, tileSize, landmask, elevation, landcover };
}

export function cropWorldTile(
  mapW: number,
  mapH: number,
  landmask: Uint8Array,
  elevation: Int16Array,
  landcover: Uint8Array,
  tx: number,
  ty: number,
  tileSize = MAP_TILE_SIZE,
): MapTileData | null {
  const { x0, y0, tw, th } = tilePixelBounds(tx, ty, mapW, mapH, tileSize);
  if (tw <= 0 || th <= 0) return null;
  const n = tw * th;
  const lm = new Uint8Array(n);
  const el = new Int16Array(n);
  const lc = new Uint8Array(n);
  for (let row = 0; row < th; row++) {
    const src = (y0 + row) * mapW + x0;
    const dst = row * tw;
    lm.set(landmask.subarray(src, src + tw), dst);
    lc.set(landcover.subarray(src, src + tw), dst);
    el.set(elevation.subarray(src, src + tw), dst);
  }
  return { tx, ty, tw, th, tileSize, landmask: lm, elevation: el, landcover: lc };
}
