import Phaser from 'phaser';
import { CLOCK_UTC_OFFSET_HOURS } from '../../gameClock';
import { SUNLIGHT_PIPELINE, SunlightPipeline, type SunlightGeoMode } from './SunlightPipeline';
import {
  ELEV_PACK,
  uploadElevationTexture,
  type ElevationTexLayers,
} from './elevationTex';

export type SunlightFxHost =
  | Phaser.GameObjects.Image
  | Phaser.Cameras.Scene2D.Camera;

export interface SunlightRegionLayers {
  originX: number;
  originY: number;
  width: number;
  height: number;
  elevation: Int16Array;
  landmask?: Uint8Array;
  landcover?: Uint8Array;
}

export interface SunlightAttachOptions {
  hour?: number;
  dayOfYear?: number;
  /** Moonlight 0..1 (new → full). Default 1. */
  moonIntensity?: number;
  /**
   * `equirectangular`: per-pixel lat/lon solar (terminator + seasons).
   * `none`: legacy hour-only day curve (non-Earth / abstract maps).
   */
  geo?: SunlightGeoMode;
  /** Full world size in pixels (for lat/lon + world UV). */
  mapWidth: number;
  mapHeight: number;
}

export interface SunlightHandle {
  /** Civil clock hours [0, 24) (GMT−3 when using default offset). */
  setTimeOfDay(hour: number): void;
  /** Day of year 1..365 — seasons / declination. */
  setDayOfYear(day: number): void;
  /** Moonlight magnitude 0..1 (new → full). */
  setMoonIntensity(amount: number): void;
  /** Re-upload elev texture for the loaded tile AABB (or full map). */
  setRegionLayers(region: SunlightRegionLayers | null): void;
  destroy(): void;
}

const noopHandle: SunlightHandle = {
  setTimeOfDay() {},
  setDayOfYear() {},
  setMoonIntensity() {},
  setRegionLayers() {},
  destroy() {},
};

function isWebGL(
  renderer: Phaser.Renderer.Canvas.CanvasRenderer | Phaser.Renderer.WebGL.WebGLRenderer,
): renderer is Phaser.Renderer.WebGL.WebGLRenderer {
  return renderer.type === Phaser.WEBGL;
}

function resolveElevGl(
  scene: Phaser.Scene,
  elevKey: string,
): Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null {
  const elevTexture = scene.textures.get(elevKey);
  return elevTexture.source[0]?.glTexture ?? elevTexture.get()?.glTexture ?? null;
}

/**
 * Attach elevation hillshade + day/night grade.
 * Prefer camera host when the map is many tile sprites.
 */
export function attachSunlight(
  scene: Phaser.Scene,
  host: SunlightFxHost,
  options: SunlightAttachOptions,
  /** Optional initial region (full-map or first tile AABB). */
  initialRegion?: SunlightRegionLayers | null,
): SunlightHandle {
  const { renderer } = scene.game;
  if (!isWebGL(renderer)) return noopHandle;

  renderer.pipelines.addPostPipeline(SUNLIGHT_PIPELINE, SunlightPipeline);

  const dummy: SunlightRegionLayers = {
    originX: 0,
    originY: 0,
    width: 1,
    height: 1,
    elevation: new Int16Array([0]),
    landmask: new Uint8Array([0]),
  };
  let elevKey = uploadElevationTexture(scene, {
    width: dummy.width,
    height: dummy.height,
    elevation: dummy.elevation,
    landmask: dummy.landmask,
  });
  let elevGl = resolveElevGl(scene, elevKey);
  if (!elevGl) {
    console.warn('[sunlight] elevation GL texture missing — skipped');
    return noopHandle;
  }

  host.setPostPipeline(SUNLIGHT_PIPELINE);
  const pipe = host.getPostPipeline(SUNLIGHT_PIPELINE) as
    | SunlightPipeline
    | SunlightPipeline[]
    | undefined;

  const instance = Array.isArray(pipe) ? pipe[0] : pipe;
  if (!instance) {
    console.warn('[sunlight] PostFX instance missing — skipped');
    return noopHandle;
  }

  const initialHour = options.hour ?? 12;
  const geo = options.geo ?? 'equirectangular';

  instance.elevGlTexture = elevGl;
  instance.camera = scene.cameras.main;
  instance.mapW = options.mapWidth;
  instance.mapH = options.mapHeight;
  instance.elevMin = ELEV_PACK.min;
  instance.elevMax = ELEV_PACK.max;
  instance.hour = ((initialHour % 24) + 24) % 24;
  instance.dayOfYear = Math.max(1, Math.min(365, Math.floor(options.dayOfYear ?? 215)));
  instance.moonIntensity = Math.max(0, Math.min(1, options.moonIntensity ?? 1));
  instance.geoMode = geo === 'equirectangular' ? 1 : 0;
  instance.utcOffsetFromCivil = -CLOCK_UTC_OFFSET_HOURS;
  instance.slopeScale = Math.max(0.02, Math.min(0.08, 90 / options.mapWidth));
  instance.regionOriginX = 0;
  instance.regionOriginY = 0;
  instance.regionW = 1;
  instance.regionH = 1;

  let alive = true;

  const applyRegion = (region: SunlightRegionLayers | null) => {
    if (!alive) return;
    const r = region && region.width > 0 && region.height > 0 ? region : dummy;
    elevKey = uploadElevationTexture(scene, {
      width: r.width,
      height: r.height,
      elevation: r.elevation,
      landmask: r.landmask,
      landcover: r.landcover,
    } satisfies ElevationTexLayers);
    elevGl = resolveElevGl(scene, elevKey);
    if (!elevGl) return;
    instance.elevGlTexture = elevGl;
    instance.regionOriginX = r.originX;
    instance.regionOriginY = r.originY;
    instance.regionW = r.width;
    instance.regionH = r.height;
  };

  if (initialRegion) applyRegion(initialRegion);

  return {
    setTimeOfDay(hour: number) {
      if (!alive) return;
      instance.hour = ((hour % 24) + 24) % 24;
    },
    setDayOfYear(day: number) {
      if (!alive) return;
      instance.dayOfYear = Math.max(1, Math.min(365, Math.floor(day)));
    },
    setMoonIntensity(amount: number) {
      if (!alive) return;
      instance.moonIntensity = Math.max(0, Math.min(1, amount));
    },
    setRegionLayers(region) {
      applyRegion(region);
    },
    destroy() {
      if (!alive) return;
      alive = false;
      instance.camera = null;
      host.removePostPipeline(SUNLIGHT_PIPELINE);
      if (scene.textures.exists(elevKey)) {
        scene.textures.remove(elevKey);
      }
    },
  };
}
