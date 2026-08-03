import Phaser from 'phaser';
import { ELEV_PACK } from './elevationTex';

/**
 * Elevation hillshade (DEM per pixel) + day/night from solar model.
 *
 * When uGeoMode >= 0.5 (equirectangular): sun elevation/azimuth from
 * lat/lon + GMT−3 civil hour + day-of-year → terminator arcs, seasons.
 * Otherwise: legacy fixed 6–18 day curve from uHour only.
 */
const FRAG = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform sampler2D uElevation;
uniform float uHour;
uniform float uDayOfYear;
uniform float uGeoMode;
uniform float uUtcOffset;
uniform float uIntensity;
uniform float uSlopeScale;
uniform vec4 uWorldView;
uniform vec2 uMapSize;
uniform vec2 uRegionOrigin;
uniform vec2 uRegionSize;
uniform vec2 uElevRange;

varying vec2 outTexCoord;

const float PI = 3.14159265;
const float DEG = PI / 180.0;

float elevAt(vec2 uv) {
  float t = texture2D(uElevation, uv).r;
  return mix(uElevRange.x, uElevRange.y, t);
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

  float hour = mod(uHour, 24.0);
  float sinEl;
  float lightEast;
  float lightSouth;
  float lightUp;

  if (uGeoMode > 0.5) {
    float lon = mapUV.x * 360.0 - 180.0;
    float lat = 90.0 - mapUV.y * 180.0;
    float phi = lat * DEG;
    float decl = 23.44 * sin(2.0 * PI * (uDayOfYear - 81.0) / 365.0) * DEG;

    float utc = mod(hour + uUtcOffset, 24.0);
    float lst = utc + lon / 15.0;
    float ha = (lst - 12.0) * 15.0 * DEG;

    sinEl = clamp(sin(phi) * sin(decl) + cos(phi) * cos(decl) * cos(ha), -1.0, 1.0);
    float el = asin(sinEl);
    float cosEl = max(cos(el), 1e-4);

    float sinAz = (-cos(decl) * sin(ha)) / cosEl;
    float cosAz = (sin(decl) - sinEl * sin(phi)) / (cosEl * max(cos(phi), 1e-4));
    float invAz = inversesqrt(max(sinAz * sinAz + cosAz * cosAz, 1e-6));
    sinAz *= invAz;
    cosAz *= invAz;

    float cosElPos = max(cosEl, 0.0);
    lightEast = sinAz * cosElPos;
    lightSouth = -cosAz * cosElPos;
    lightUp = max(sinEl, 0.12);
  } else {
    float sunH = max(0.0, sin((hour - 6.0) / 12.0 * PI));
    sinEl = sunH;
    float dayT = clamp((hour - 6.0) / 12.0, 0.0, 1.0);
    float az = dayT * PI;
    lightEast = cos(az);
    lightSouth = sin(az) * 0.85;
    lightUp = max(0.15, sunH);
  }

  float night = 1.0 - smoothstep(-0.08, 0.18, sinEl);
  float twilight = exp(-pow((sinEl + 0.02) / 0.14, 2.0));
  twilight *= 1.0 - smoothstep(0.25, 0.55, sinEl);

  vec3 orange = vec3(1.0, 0.52, 0.22);
  vec3 pink = vec3(1.0, 0.58, 0.72);
  float pinkPick = fract(sin(floor(uDayOfYear + hour) * 12.9898 + 78.233) * 43758.5453);
  float usePink = step(0.62, pinkPick);
  vec3 twilightCol = mix(orange, pink, usePink * 0.85);

  vec3 sunTint = mix(vec3(1.0), twilightCol, clamp(twilight, 0.0, 1.0));
  sunTint = mix(sunTint, vec3(0.55, 0.62, 0.85), night * 0.65);
  float nightDim = mix(1.0, 0.52, night);

  float shade = 1.0;

  // Elevation texture covers loaded region only (may be full map).
  vec2 texUV = (world - uRegionOrigin) / max(uRegionSize, vec2(1.0));
  bool inRegion = texUV.x >= 0.0 && texUV.x <= 1.0 && texUV.y >= 0.0 && texUV.y <= 1.0;

  if (inRegion) {
    float lit = texture2D(uElevation, texUV).g;
    float z0 = elevAt(texUV);
    float coastalFade = smoothstep(2.0, 55.0, z0);
    float doHill = lit * coastalFade;
    // Soften hillshade contribution under the horizon
    doHill *= smoothstep(-0.05, 0.12, sinEl);

    if (doHill > 0.01) {
      vec2 texel = 1.0 / max(uRegionSize, vec2(1.0));
      float zL = elevAt(texUV + vec2(-texel.x, 0.0));
      float zR = elevAt(texUV + vec2( texel.x, 0.0));
      float zU = elevAt(texUV + vec2(0.0, -texel.y));
      float zD = elevAt(texUV + vec2(0.0,  texel.y));

      vec3 n = normalize(vec3(
        (zL - zR) * uSlopeScale,
        (zU - zD) * uSlopeScale,
        1.0
      ));

      vec3 lightDir = normalize(vec3(lightEast, lightSouth, lightUp));
      float ndotl = clamp(dot(n, lightDir), 0.0, 1.0);
      float sunH = max(0.0, sinEl);
      float ambient = mix(0.22, 0.55, sunH);
      float hill = mix(ambient, 1.0, ndotl * uIntensity);
      shade = mix(1.0, hill, doHill);
    }
  }

  c.rgb *= shade * sunTint * nightDim;
  gl_FragColor = c;
}
`;

export const SUNLIGHT_PIPELINE = 'Sunlight';

export type SunlightGeoMode = 'none' | 'equirectangular';

export class SunlightPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  elevGlTexture: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null = null;
  /** Set by attach — read at draw time after Camera.preRender. */
  camera: Phaser.Cameras.Scene2D.Camera | null = null;

  /** Civil clock hours [0, 24) — interpreted with utcOffset (default GMT−3). */
  hour = 12;
  /** Day of year 1..365 for declination / seasons. */
  dayOfYear = 215;
  /** Hours to add to civil clock to get UTC (GMT−3 → +3). */
  utcOffsetFromCivil = 3;
  /** 0 = legacy hour curve, 1 = equirectangular solar. */
  geoMode = 1;
  intensity = 0.85;
  slopeScale = 0.045;

  mapW = 1;
  mapH = 1;
  /** World-space origin of the elevation texture (region streaming). */
  regionOriginX = 0;
  regionOriginY = 0;
  regionW = 1;
  regionH = 1;
  elevMin = ELEV_PACK.min;
  elevMax = ELEV_PACK.max;

  constructor(game: Phaser.Game) {
    super({
      game,
      name: SUNLIGHT_PIPELINE,
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
    this.set1f('uHour', this.hour);
    this.set1f('uDayOfYear', this.dayOfYear);
    this.set1f('uGeoMode', this.geoMode);
    this.set1f('uUtcOffset', this.utcOffsetFromCivil);
    this.set1f('uIntensity', this.intensity);
    this.set1f('uSlopeScale', this.slopeScale);
    this.set2f('uMapSize', this.mapW, this.mapH);
    this.set2f('uRegionOrigin', this.regionOriginX, this.regionOriginY);
    this.set2f('uRegionSize', this.regionW, this.regionH);
    this.set2f('uElevRange', this.elevMin, this.elevMax);
    this.set1i('uMainSampler', 0);
    this.set1i('uElevation', 1);
  }

  onDraw(renderTarget: Phaser.Renderer.WebGL.RenderTarget): void {
    this.pushWorldView();
    if (this.elevGlTexture) {
      this.bindTexture(this.elevGlTexture, 1);
    }
    this.bindAndDraw(renderTarget);
  }
}
