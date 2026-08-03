import Phaser from 'phaser';

/**
 * Soft procedural cloud veil in world space.
 * Independent of map layers — pure FBM noise drifting over the equirect grid.
 */
const FRAG = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform float uTime;
uniform float uOpacity;
uniform float uScale;
uniform float uCoverage;
uniform float uSpeed;
uniform vec4 uWorldView;
uniform vec2 uMapSize;

varying vec2 outTexCoord;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    v += a * noise(p);
    p = p * 2.15 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main () {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  if (c.a < 0.01) {
    gl_FragColor = c;
    return;
  }

  vec2 screenUV = vec2(outTexCoord.x, 1.0 - outTexCoord.y);
  vec2 world = uWorldView.xy + screenUV * uWorldView.zw;
  vec2 mapUV = world / uMapSize;

  if (mapUV.x < 0.0 || mapUV.x > 1.0 || mapUV.y < 0.0 || mapUV.y > 1.0) {
    gl_FragColor = c;
    return;
  }

  float t = uTime * 0.00004 * uSpeed;
  vec2 windA = vec2(t * 1.15, t * 0.35);
  vec2 windB = vec2(t * -0.4, t * 0.55);

  // Higher uScale → smaller individual clouds. Extra high-freq layers for detail.
  vec2 p = mapUV * uScale;
  float n1 = fbm(p + windA);
  float n2 = fbm(p * 2.4 + windB + 17.0);
  float n3 = fbm(p * 0.55 - windA * 0.6 + 41.0);
  float detail = fbm(p * 5.5 + windA * 1.4 + 91.0);
  float micro = noise(p * 14.0 + windB * 2.0);

  float field = n1 * 0.42 + n2 * 0.28 + n3 * 0.14 + detail * 0.12 + micro * 0.04;

  // Mostly clear but still visible patches. Sharp clear ↔ cloudy edge.
  // field from this fbm mix typically sits ~0.35–0.65.
  float thresh = mix(0.58, 0.50, uCoverage);
  float cloudMask = smoothstep(thresh, thresh + 0.045, field);

  // Inside clouds: opacity clusters near ~0.7, hard-capped (no pure white)
  float dens = clamp((field - thresh) / 0.18, 0.0, 1.0);
  dens = dens * dens * (3.0 - 2.0 * dens);
  float opacCurve = mix(0.45, 0.72, dens);
  opacCurve *= mix(0.92, 1.0, detail);

  float alpha = cloudMask * opacCurve * uOpacity;
  vec3 cloudCol = vec3(0.84, 0.87, 0.90);
  vec3 shaded = mix(c.rgb, c.rgb * 0.78, alpha * 0.4);
  c.rgb = mix(shaded, cloudCol, alpha);

  gl_FragColor = c;
}
`;

export const CLOUDS_PIPELINE = 'Clouds';

export class CloudsPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  camera: Phaser.Cameras.Scene2D.Camera | null = null;

  timeMs = 0;
  /** 0..1 overall multiplier on cloud alpha */
  opacity = 1.0;
  /** World-space cloud frequency (higher = smaller puffs) */
  scale = 22;
  /** 0..1 nudges coverage; default keeps sky mostly clear */
  coverage = 0.45;
  /** Drift multiplier */
  speed = 1.0;

  mapW = 1;
  mapH = 1;

  constructor(game: Phaser.Game) {
    super({
      game,
      name: CLOUDS_PIPELINE,
      fragShader: FRAG,
    });
  }

  private pushWorldView(): void {
    const cam = this.camera;
    if (!cam) {
      this.set4f('uWorldView', 0, 0, 1, 1);
      return;
    }
    const v = cam.worldView;
    this.set4f('uWorldView', v.x, v.y, v.width, v.height);
  }

  onPreRender(): void {
    this.pushWorldView();
    this.set1f('uTime', this.timeMs);
    this.set1f('uOpacity', this.opacity);
    this.set1f('uScale', this.scale);
    this.set1f('uCoverage', this.coverage);
    this.set1f('uSpeed', this.speed);
    this.set2f('uMapSize', this.mapW, this.mapH);
    this.set1i('uMainSampler', 0);
  }

  onDraw(renderTarget: Phaser.Renderer.WebGL.RenderTarget): void {
    this.pushWorldView();
    this.bindAndDraw(renderTarget);
  }
}
