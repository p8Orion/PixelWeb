import type { GameWorldLayers, GameWorldMeta } from '../../../shared/maps/game';
import { previewRgbForCell } from '../../../shared/maps/game';

export type WorldLayers = GameWorldLayers;

function layersBaseUrl(worldId: string): string {
  if (!worldId || worldId === 'default') return '/api/maps/world';
  return `/api/maps/worlds/${encodeURIComponent(worldId)}`;
}

/**
 * Legacy full-map download (debug / tools). Runtime gameplay uses TileStore
 * viewport streaming via `fetchWorldMeta` + `/tiles/:tx/:ty`.
 */
export async function loadWorldLayers(worldId = 'default'): Promise<WorldLayers> {
  const baseUrl = layersBaseUrl(worldId);
  const metaRes = await fetch(`${baseUrl}/meta`);
  if (!metaRes.ok) {
    const body = await metaRes.json().catch(() => ({}));
    throw new Error(
      (body as { hint?: string }).hint ||
        `Servidor sin mapa interpretado (${metaRes.status}). Corré maps:build -- --world=${worldId} y reiniciá el server.`,
    );
  }
  const meta = (await metaRes.json()) as GameWorldMeta;
  const { width, height } = meta;
  const n = width * height;

  const [maskBuf, elevBuf, coverBuf] = await Promise.all([
    fetch(`${baseUrl}/landmask.bin`).then((r) => {
      if (!r.ok) throw new Error('landmask.bin missing');
      return r.arrayBuffer();
    }),
    fetch(`${baseUrl}/elevation.bin`).then((r) => {
      if (!r.ok) throw new Error('elevation.bin missing');
      return r.arrayBuffer();
    }),
    fetch(`${baseUrl}/landcover.bin`).then((r) => {
      if (!r.ok) throw new Error('landcover.bin missing');
      return r.arrayBuffer();
    }),
  ]);

  const landmask = new Uint8Array(maskBuf);
  const elevation = new Int16Array(elevBuf);
  const landcover = new Uint8Array(coverBuf);

  if (landmask.length !== n || elevation.length !== n || landcover.length !== n) {
    throw new Error(
      `Layer size mismatch: expected ${n}, got mask=${landmask.length} elev=${elevation.length} cover=${landcover.length}`,
    );
  }

  return { meta, landmask, elevation, landcover };
}

/** Client-side presentation only (temporary). Swap later for pixel-art renderer. */
export function layersToPreviewImageData(layers: WorldLayers): ImageData {
  const { width, height } = layers.meta;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = previewRgbForCell(
      layers.landcover[i],
      layers.elevation[i],
      layers.landmask[i] === 1,
    );
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }

  return new ImageData(data, width, height);
}

export function walkableFromLayers(layers: WorldLayers): Uint8Array {
  return layers.landmask;
}
