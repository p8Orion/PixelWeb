import type Phaser from 'phaser';
import { LANDCOVER } from '../../../../shared/maps/game';

export const ELEVATION_TEXTURE_KEY = 'sunlight-elevation';

/** Elevation range packed into R (meters). */
const ELEV_MIN = -500;
const ELEV_MAX = 4500;

export interface ElevationTexLayers {
  width: number;
  height: number;
  elevation: Int16Array;
  /** 1 = land, 0 = ocean. */
  landmask?: Uint8Array;
  landcover?: Uint8Array;
}

/**
 * R = normalized elevation.
 * G = 255 where sunlight applies (land, not ocean, not freshwater); else 0.
 */
export function buildElevationImageData(layers: ElevationTexLayers): ImageData {
  const { width, height, elevation, landmask, landcover } = layers;
  const n = width * height;
  const data = new Uint8ClampedArray(n * 4);
  const span = ELEV_MAX - ELEV_MIN;

  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(1, (elevation[i] - ELEV_MIN) / span));
    const v = Math.round(t * 255);
    const ocean = landmask ? landmask[i] === 0 : false;
    const fresh = landcover?.[i] === LANDCOVER.FRESHWATER;
    const lit = !ocean && !fresh ? 255 : 0;
    const o = i * 4;
    data[o] = v;
    data[o + 1] = lit;
    data[o + 2] = 0;
    data[o + 3] = 255;
  }

  return new ImageData(data, width, height);
}

export function uploadElevationTexture(
  scene: Phaser.Scene,
  layers: ElevationTexLayers,
  key = ELEVATION_TEXTURE_KEY,
): string {
  if (scene.textures.exists(key)) {
    scene.textures.remove(key);
  }
  const imageData = buildElevationImageData(layers);
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  scene.textures.addCanvas(key, canvas);
  return key;
}

export const ELEV_PACK = { min: ELEV_MIN, max: ELEV_MAX } as const;
