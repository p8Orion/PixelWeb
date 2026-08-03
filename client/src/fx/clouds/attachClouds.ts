import Phaser from 'phaser';
import { CLOUDS_PIPELINE, CloudsPipeline } from './CloudsPipeline';

export type CloudsFxHost =
  | Phaser.GameObjects.Image
  | Phaser.Cameras.Scene2D.Camera;

export interface CloudsHandle {
  setTime(timeMs: number): void;
  destroy(): void;
}

export interface CloudsAttachOptions {
  mapWidth: number;
  mapHeight: number;
  opacity?: number;
  coverage?: number;
  scale?: number;
  speed?: number;
}

const noopHandle: CloudsHandle = {
  setTime() {},
  destroy() {},
};

function isWebGL(
  renderer: Phaser.Renderer.Canvas.CanvasRenderer | Phaser.Renderer.WebGL.WebGLRenderer,
): renderer is Phaser.Renderer.WebGL.WebGLRenderer {
  return renderer.type === Phaser.WEBGL;
}

/**
 * Attach drifting semi-transparent clouds.
 * Prefer camera host when the map is many tile sprites.
 */
export function attachClouds(
  scene: Phaser.Scene,
  host: CloudsFxHost,
  options: CloudsAttachOptions,
): CloudsHandle {
  const { renderer } = scene.game;
  if (!isWebGL(renderer)) return noopHandle;

  renderer.pipelines.addPostPipeline(CLOUDS_PIPELINE, CloudsPipeline);

  host.setPostPipeline(CLOUDS_PIPELINE);
  const pipe = host.getPostPipeline(CLOUDS_PIPELINE) as
    | CloudsPipeline
    | CloudsPipeline[]
    | undefined;

  const instance = Array.isArray(pipe) ? pipe[0] : pipe;
  if (!instance) {
    console.warn('[clouds] PostFX instance missing — skipped');
    return noopHandle;
  }

  instance.camera = scene.cameras.main;
  instance.mapW = options.mapWidth;
  instance.mapH = options.mapHeight;
  if (options.opacity != null) instance.opacity = options.opacity;
  if (options.coverage != null) instance.coverage = options.coverage;
  if (options.scale != null) instance.scale = options.scale;
  else instance.scale = Math.max(18, Math.min(36, options.mapWidth / 450));
  if (options.speed != null) instance.speed = options.speed;

  let alive = true;

  return {
    setTime(timeMs: number) {
      if (!alive) return;
      instance.timeMs = timeMs;
    },
    destroy() {
      if (!alive) return;
      alive = false;
      instance.camera = null;
      host.removePostPipeline(CLOUDS_PIPELINE);
    },
  };
}
