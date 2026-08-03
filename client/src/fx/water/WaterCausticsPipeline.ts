import Phaser from 'phaser';

/**
 * Organic caustics + soft shore response.
 * Mask R = water; G = shallowness; coast falloff from nearby mask texels.
 * Does not alter the CPU-baked map RGB.
 *
 * PostFX is screen-space; map UV is reconstructed from the live camera
 * worldView at draw time (avoids scroll/zoom ghosting).
 */
const FRAG = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform sampler2D uWaterMask;
uniform float uTime;
uniform float uIntensity;
uniform float uScale;
uniform vec4 uWorldView; // xy = world top-left, zw = visible world size
uniform vec2 uMapSize;
uniform vec2 uRegionOrigin;
uniform vec2 uRegionSize;

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
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.07 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

/** Soft shore weight 0..1 — wider falloff into open water (not a 1px ribbon). */
float shoreFactor(vec2 uv, float water) {
  if (water < 0.5) return 0.0;
  vec2 t = 1.0 / max(uRegionSize, vec2(1.0));
  float landNear = 0.0;
  float landMid = 0.0;
  float landFar = 0.0;
  // near
  landNear = max(landNear, 1.0 - texture2D(uWaterMask, uv + vec2( t.x,  0.0)).r);
  landNear = max(landNear, 1.0 - texture2D(uWaterMask, uv + vec2(-t.x,  0.0)).r);
  landNear = max(landNear, 1.0 - texture2D(uWaterMask, uv + vec2( 0.0,  t.y)).r);
  landNear = max(landNear, 1.0 - texture2D(uWaterMask, uv + vec2( 0.0, -t.y)).r);
  // mid (~6 px)
  landMid = max(landMid, 1.0 - texture2D(uWaterMask, uv + vec2( 6.0 * t.x,  0.0)).r);
  landMid = max(landMid, 1.0 - texture2D(uWaterMask, uv + vec2(-6.0 * t.x,  0.0)).r);
  landMid = max(landMid, 1.0 - texture2D(uWaterMask, uv + vec2( 0.0,  6.0 * t.y)).r);
  landMid = max(landMid, 1.0 - texture2D(uWaterMask, uv + vec2( 0.0, -6.0 * t.y)).r);
  landMid = max(landMid, 1.0 - texture2D(uWaterMask, uv + vec2( 5.0 * t.x,  5.0 * t.y)).r);
  landMid = max(landMid, 1.0 - texture2D(uWaterMask, uv + vec2(-5.0 * t.x, -5.0 * t.y)).r);
  // far (~14 px)
  landFar = max(landFar, 1.0 - texture2D(uWaterMask, uv + vec2( 14.0 * t.x,  0.0)).r);
  landFar = max(landFar, 1.0 - texture2D(uWaterMask, uv + vec2(-14.0 * t.x,  0.0)).r);
  landFar = max(landFar, 1.0 - texture2D(uWaterMask, uv + vec2( 0.0,  14.0 * t.y)).r);
  landFar = max(landFar, 1.0 - texture2D(uWaterMask, uv + vec2( 0.0, -14.0 * t.y)).r);
  landFar = max(landFar, 1.0 - texture2D(uWaterMask, uv + vec2( 10.0 * t.x,  10.0 * t.y)).r);
  landFar = max(landFar, 1.0 - texture2D(uWaterMask, uv + vec2(-10.0 * t.x, -10.0 * t.y)).r);
  return clamp(landNear * 1.0 + landMid * 0.55 + landFar * 0.28, 0.0, 1.0);
}

/** Unit normal pointing offshore (water ← land), from mask gradient. */
vec2 coastNormal(vec2 uv) {
  vec2 t = 1.0 / max(uRegionSize, vec2(1.0));
  // Wider stencil so soft coasts still get a stable direction
  float mL = texture2D(uWaterMask, uv + vec2(-2.0 * t.x, 0.0)).r
           + texture2D(uWaterMask, uv + vec2(-4.0 * t.x, 0.0)).r;
  float mR = texture2D(uWaterMask, uv + vec2( 2.0 * t.x, 0.0)).r
           + texture2D(uWaterMask, uv + vec2( 4.0 * t.x, 0.0)).r;
  float mU = texture2D(uWaterMask, uv + vec2(0.0, -2.0 * t.y)).r
           + texture2D(uWaterMask, uv + vec2(0.0, -4.0 * t.y)).r;
  float mD = texture2D(uWaterMask, uv + vec2(0.0,  2.0 * t.y)).r
           + texture2D(uWaterMask, uv + vec2(0.0,  4.0 * t.y)).r;
  // R high on water → gradient points away from land (offshore)
  vec2 g = vec2(mR - mL, mD - mU);
  float len = length(g);
  return len > 1e-4 ? g / len : vec2(0.0, 1.0);
}

void main () {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  if (c.a < 0.01) {
    gl_FragColor = c;
    return;
  }

  // PostFX quad: v=0 at bottom of RT; Phaser worldView y grows downward from the top of the view.
  vec2 screenUV = vec2(outTexCoord.x, 1.0 - outTexCoord.y);
  vec2 world = uWorldView.xy + screenUV * uWorldView.zw;
  vec2 mapUV = world / uMapSize;
  vec2 texUV = (world - uRegionOrigin) / max(uRegionSize, vec2(1.0));

  vec4 maskSample = vec4(0.0);
  if (texUV.x >= 0.0 && texUV.x <= 1.0 && texUV.y >= 0.0 && texUV.y <= 1.0) {
    maskSample = texture2D(uWaterMask, texUV);
  }
  float m = maskSample.r;
  float shallow = maskSample.g; // 1 ≈ sea surface, 0 ≈ deep shelf+

  if (m > 0.5) {
    float shoreProx = shoreFactor(texUV, m);
    // Soft shelf band — not a hard tape on the pixel edge
    float shoreBand = pow(shoreProx, 0.55) * mix(0.25, 1.0, shallow);
    shoreBand = max(shoreBand, shallow * shallow * 0.35);
    float shore = shoreBand;

    // --- Deep / mid caustics (isotropic fbm) — keep as before ---
    vec2 p = mapUV * uScale;
    float spatial = dot(world, vec2(0.031, 0.027)) + fbm(mapUV * 4.0) * 3.5;
    float t = uTime * 0.35 + spatial;
    vec2 warp = vec2(
      fbm(p * 0.85 + vec2(t * 0.4, -t * 0.25)),
      fbm(p * 0.85 + vec2(5.2, 1.3) - vec2(t * 0.3, t * 0.45))
    );
    warp += (warp - 0.5) * shore * 0.5;
    vec2 q = p + (warp - 0.5) * 2.4;

    float n1 = fbm(q + t * 0.15);
    float n2 = fbm(q * 1.7 - vec2(t * 0.22, -t * 0.18) + 3.1);
    float ridges = 1.0 - abs(n1 * 2.0 - 1.0);
    ridges = pow(ridges, 2.2);
    float fill = n2 * 0.55 + ridges * 0.45;
    float k = (fill - 0.45) * 2.0;
    k = clamp(k, -1.0, 1.0);

    float offshore = 1.0 - smoothstep(0.0, 1.0, shore);
    float localI = uIntensity * mix(0.35, 1.0, offshore) * mix(0.75, 1.0, 1.0 - shallow * 0.5);
    c.rgb *= 1.0 + k * localI;

    // --- Coastal breakers: one band, motion onto shore, dissolves offshore ---
    vec2 nC = coastNormal(texUV);
    vec2 tC = vec2(-nC.y, nC.x);
    float along = dot(world, tC);
    float alongShape = fbm(vec2(along * 0.035, along * 0.02 + 3.1));

    // 0 at beach, 1 offshore
    float dist = 1.0 - clamp(shoreBand, 0.0, 1.0);
    // +uTime → propagates toward decreasing dist (onto land), not out to sea
    float rollers = sin(dist * 5.5 + uTime * 1.0 + alongShape * 1.8);
    rollers = pow(max(rollers, 0.0), 2.4);

    // Single soft band: strong near shore, dissolves into open water
    float dissolve = shoreBand * shoreBand * mix(0.55, 1.0, shallow);
    float foam = dissolve * rollers;
    c.rgb += foam * 0.14 * vec3(0.62, 0.86, 1.0);
    float lip = dissolve * shoreProx * pow(rollers, 4.0);
    c.rgb += lip * 0.05 * vec3(0.85, 0.95, 1.0);
  }

  gl_FragColor = c;
}
`;

export const WATER_CAUSTICS_PIPELINE = 'WaterCaustics';

export class WaterCausticsPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  maskGlTexture: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null = null;
  /** Set by attach — read at draw time after Camera.preRender. */
  camera: Phaser.Cameras.Scene2D.Camera | null = null;

  timeMs = 0;
  intensity = 0.12;
  scale = 48;
  mapW = 1;
  mapH = 1;
  regionOriginX = 0;
  regionOriginY = 0;
  regionW = 1;
  regionH = 1;

  constructor(game: Phaser.Game) {
    super({
      game,
      name: WATER_CAUSTICS_PIPELINE,
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
    this.set1f('uTime', this.timeMs * 0.001);
    this.set1f('uIntensity', this.intensity);
    this.set1f('uScale', this.scale);
    this.set2f('uMapSize', this.mapW, this.mapH);
    this.set2f('uRegionOrigin', this.regionOriginX, this.regionOriginY);
    this.set2f('uRegionSize', this.regionW, this.regionH);
    this.set1i('uMainSampler', 0);
    this.set1i('uWaterMask', 1);
  }

  onDraw(renderTarget: Phaser.Renderer.WebGL.RenderTarget): void {
    this.pushWorldView();
    if (this.maskGlTexture) {
      this.bindTexture(this.maskGlTexture, 1);
    }
    this.bindAndDraw(renderTarget);
  }
}
