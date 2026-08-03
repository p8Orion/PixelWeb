import Phaser from 'phaser';
import {
  WATER_CAUSTICS_PIPELINE,
  WaterCausticsPipeline,
} from './WaterCausticsPipeline';
import { uploadWaterMask, type WaterMaskLayers } from './waterMask';

export type WaterFxHost =
  | Phaser.GameObjects.Image
  | Phaser.Cameras.Scene2D.Camera;

export interface WaterRegionLayers {
  originX: number;
  originY: number;
  width: number;
  height: number;
  landmask: Uint8Array;
  elevation?: Int16Array;
  landcover?: Uint8Array;
}

export interface WaterCausticsAttachOptions {
  mapWidth: number;
  mapHeight: number;
}

export interface WaterCausticsHandle {
  setTime(timeMs: number): void;
  setRegionLayers(region: WaterRegionLayers | null): void;
  destroy(): void;
}

const noopHandle: WaterCausticsHandle = {
  setTime() {},
  setRegionLayers() {},
  destroy() {},
};

function isWebGL(
  renderer: Phaser.Renderer.Canvas.CanvasRenderer | Phaser.Renderer.WebGL.WebGLRenderer,
): renderer is Phaser.Renderer.WebGL.WebGLRenderer {
  return renderer.type === Phaser.WEBGL;
}

function resolveMaskGl(
  scene: Phaser.Scene,
  maskKey: string,
): Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null {
  const maskTexture = scene.textures.get(maskKey);
  return maskTexture.source[0]?.glTexture ?? maskTexture.get()?.glTexture ?? null;
}

/**
 * Attach animated water caustics.
 * Prefer camera host when the map is many tile sprites.
 */
export function attachWaterCaustics(
  scene: Phaser.Scene,
  host: WaterFxHost,
  options: WaterCausticsAttachOptions,
  initialRegion?: WaterRegionLayers | null,
): WaterCausticsHandle {
  const { renderer } = scene.game;
  if (!isWebGL(renderer)) return noopHandle;

  renderer.pipelines.addPostPipeline(WATER_CAUSTICS_PIPELINE, WaterCausticsPipeline);

  const dummy: WaterRegionLayers = {
    originX: 0,
    originY: 0,
    width: 1,
    height: 1,
    landmask: new Uint8Array([0]),
    elevation: new Int16Array([0]),
  };
  let maskKey = uploadWaterMask(scene, {
    width: dummy.width,
    height: dummy.height,
    landmask: dummy.landmask,
    elevation: dummy.elevation,
  });
  let maskGl = resolveMaskGl(scene, maskKey);
  if (!maskGl) {
    console.warn('[water] mask GL texture missing — caustics skipped');
    return noopHandle;
  }

  host.setPostPipeline(WATER_CAUSTICS_PIPELINE);
  const pipe = host.getPostPipeline(WATER_CAUSTICS_PIPELINE) as
    | WaterCausticsPipeline
    | WaterCausticsPipeline[]
    | undefined;

  const instance = Array.isArray(pipe) ? pipe[0] : pipe;
  if (!instance) {
    console.warn('[water] PostFX instance missing — caustics skipped');
    return noopHandle;
  }

  instance.maskGlTexture = maskGl;
  instance.camera = scene.cameras.main;
  instance.scale = Math.max(28, Math.min(72, options.mapWidth / 55));
  instance.intensity = 0.12;
  instance.mapW = options.mapWidth;
  instance.mapH = options.mapHeight;
  instance.regionOriginX = 0;
  instance.regionOriginY = 0;
  instance.regionW = 1;
  instance.regionH = 1;

  let alive = true;

  const applyRegion = (region: WaterRegionLayers | null) => {
    if (!alive) return;
    const r = region && region.width > 0 && region.height > 0 ? region : dummy;
    maskKey = uploadWaterMask(scene, {
      width: r.width,
      height: r.height,
      landmask: r.landmask,
      elevation: r.elevation,
      landcover: r.landcover,
    } satisfies WaterMaskLayers);
    maskGl = resolveMaskGl(scene, maskKey);
    if (!maskGl) return;
    instance.maskGlTexture = maskGl;
    instance.regionOriginX = r.originX;
    instance.regionOriginY = r.originY;
    instance.regionW = r.width;
    instance.regionH = r.height;
  };

  if (initialRegion) applyRegion(initialRegion);

  return {
    setTime(timeMs: number) {
      if (!alive) return;
      instance.timeMs = timeMs;
    },
    setRegionLayers(region) {
      applyRegion(region);
    },
    destroy() {
      if (!alive) return;
      alive = false;
      instance.camera = null;
      host.removePostPipeline(WATER_CAUSTICS_PIPELINE);
      if (scene.textures.exists(maskKey)) {
        scene.textures.remove(maskKey);
      }
    },
  };
}
