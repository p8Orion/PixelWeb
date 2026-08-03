import type Phaser from 'phaser';
import { DEEP_OCEAN_DEPTH_M } from '../../../../shared/maps/game';

export const WATER_MASK_TEXTURE_KEY = 'water-mask';

/** Depth (m) over which G goes from shallow→deep for shore modulation. */
const SHORE_DEPTH_M = Math.max(DEEP_OCEAN_DEPTH_M, 80);

export interface WaterMaskLayers {
  width: number;
  height: number;
  landmask: Uint8Array;
  /** Ocean bathymetry (m). Negative below sea level. */
  elevation?: Int16Array;
  landcover?: Uint8Array;
}

/**
 * R = ocean (255) vs not (0). Freshwater excluded from water FX.
 * G = shallowness 0..255 (255 ≈ surface, 0 ≈ ≥ SHORE_DEPTH_M) for ocean cells.
 */
export function buildWaterMaskImageData(layers: WaterMaskLayers): ImageData {
  const { width, height, landmask, elevation } = layers;
  const n = width * height;
  const data = new Uint8ClampedArray(n * 4);

  for (let i = 0; i < n; i++) {
    const ocean = landmask[i] === 0;
    const o = i * 4;
    if (!ocean) {
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 255;
      continue;
    }

    let shallow = 1;
    if (elevation) {
      const depth = Math.max(0, -elevation[i]);
      shallow = 1 - Math.max(0, Math.min(1, depth / SHORE_DEPTH_M));
    }

    data[o] = 255;
    data[o + 1] = Math.round(shallow * 255);
    data[o + 2] = 0;
    data[o + 3] = 255;
  }

  return new ImageData(data, width, height);
}

export function uploadWaterMask(
  scene: Phaser.Scene,
  layers: WaterMaskLayers,
  key = WATER_MASK_TEXTURE_KEY,
): string {
  if (scene.textures.exists(key)) {
    scene.textures.remove(key);
  }
  const imageData = buildWaterMaskImageData(layers);
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  scene.textures.addCanvas(key, canvas);
  return key;
}
