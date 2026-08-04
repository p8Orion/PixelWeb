import Phaser from 'phaser';
import { io, type Socket } from 'socket.io-client';
import type { PlayerState, StartingAreaId } from '../../shared/types';
import type { MapPatchEvent, WelcomePayload } from '../../shared/rooms';
import type { TimeSyncPayload } from '../../shared/time';
import {
  areaSpawn,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_PLAYER_EMOJI,
  DEFAULT_STARTING_AREA,
} from '../../shared/types';
import { LANDCOVER, LANDCOVER_LABELS } from '../../shared/maps/game';
import { attachWaterCaustics, type WaterCausticsHandle } from './fx/water';
import { attachSunlight, type SunlightHandle } from './fx/sunlight';
import { attachClouds, type CloudsHandle } from './fx/clouds';
import { GameClock } from './gameClock';
import { GameCalendar } from './gameCalendar';
import { GameLunar, setLunarQuarterDays } from './gameLunar';
import { buildPixelMap, imageDataToTextureKey } from './map/pixelMap';
import { TileMapView } from './map/tileLayer';
import { fetchWorldMeta, TileStore, type RegionLayers } from './map/tileStore';
import {
  ingameSpeedKmh,
  metersPerWorldPixel,
  setDaySeconds,
  setDaysPerMonth,
  walkSpeedPxPerSec,
} from './timeScale';

export interface BootConfig {
  name: string;
  width: number;
  height: number;
  palette: 'earth' | 'retro' | 'mono';
  /** Prefer baked logical layers from `npm run maps:build`. */
  mapSource: 'layers' | 'procedural' | 'upload';
  /** Which interpreted world to fetch when mapSource=layers. */
  worldId: string;
  /** Multiplayer room; null = solo local (no socket). */
  roomId: string | null;
  /** Shareable join code (HUD); null in solo. */
  joinCode: string | null;
  /** Regional spawn box (Argentina, EEUU, …). */
  startingArea: StartingAreaId;
  /** Emoji avatar drawn on the map. */
  emoji: string;
  file: File | null;
  /** PostFX: procedural clouds */
  fxClouds: boolean;
  /** PostFX: coastal water caustics / waves */
  fxWaves: boolean;
  /** Real seconds for one game day (pace knob). */
  daySeconds: number;
  /** Game days that fill one calendar month (1 = día=mes, 30 ≈ día=día). */
  daysPerMonth: number;
  /** Game days for one lunar quarter (nueva→creciente…); cycle = ×4. */
  lunarQuarterDays: number;
  onStatus: (msg: string) => void;
}

export interface TileInfo {
  x: number;
  y: number;
  lon: number;
  lat: number;
  elevationM: number | null;
  landcover: string | null;
  landcoverCode: number | null;
  land: boolean | null;
}

/** HUD stats — from the last applied movement step. */
export interface PlayerStats {
  speedKmh: number;
  /** Slope of last step in degrees (positive = uphill). */
  slopeDeg: number;
  /** Terrain+climb speed multiplier as percent (100 = normal). */
  speedModPct: number;
  facing: PlayerState['facing'];
  moving: boolean;
  /** Standing on inland freshwater (slow ford). */
  riverCrossing: boolean;
  /** Current camera zoom level. */
  zoom: number;
}

interface RemoteSprite {
  body: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
}

interface PlayableMap {
  width: number;
  height: number;
  /** Procedural / upload full-map path. */
  imageData?: ImageData;
  walkable?: Uint8Array;
  elevation?: Int16Array;
  landcover?: Uint8Array;
  landmask?: Uint8Array;
  /** Viewport-streamed layers. */
  tileStore?: TileStore;
}

/** On-screen size in CSS pixels at any zoom. */
const PLAYER_SCREEN_PX = 32;
const PLAYER_LABEL_FONT = '16px';
const PLAYER_LABEL_OFFSET = 20;
/** Nearly solid — only a hint of fade so they don't look pasted on. */
const PLAYER_MARKER_ALPHA = 0.96;
const MOVE_TARGET_EMOJI = '🎯';
const MOVE_TARGET_SCREEN_PX = 28;
const EMOJI_FONT =
  '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

const MOVE_CAPTURE = [
  Phaser.Input.Keyboard.KeyCodes.W,
  Phaser.Input.Keyboard.KeyCodes.A,
  Phaser.Input.Keyboard.KeyCodes.S,
  Phaser.Input.Keyboard.KeyCodes.D,
  Phaser.Input.Keyboard.KeyCodes.UP,
  Phaser.Input.Keyboard.KeyCodes.DOWN,
  Phaser.Input.Keyboard.KeyCodes.LEFT,
  Phaser.Input.Keyboard.KeyCodes.RIGHT,
  Phaser.Input.Keyboard.KeyCodes.SHIFT,
  Phaser.Input.Keyboard.KeyCodes.CTRL,
];

export class WorldScene extends Phaser.Scene {
  private config!: BootConfig;
  private socket?: Socket;
  private localId = '';
  private mapData?: PlayableMap;
  private tileView?: TileMapView;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private shiftKey?: Phaser.Input.Keyboard.Key;
  private ctrlKey?: Phaser.Input.Keyboard.Key;
  private player?: Phaser.GameObjects.Text;
  private playerLabel?: Phaser.GameObjects.Text;
  private facing: PlayerState['facing'] = 'down';
  private remotes = new Map<string, RemoteSprite>();
  private waterFx?: WaterCausticsHandle;
  private sunlightFx?: SunlightHandle;
  private cloudsFx?: CloudsHandle;
  private lastEmit = 0;
  private lastEmitX = Number.NaN;
  private lastEmitY = Number.NaN;
  private wasMoving = false;
  private lastTileKey = '';
  private lastMouseTileKey = '';
  private chatFocused = false;
  /** Click-to-move destination in world px; cleared by WASD or arrival. */
  private moveTarget: { x: number; y: number } | null = null;
  private moveTargetMarker?: Phaser.GameObjects.Text;
  /** km/h from the previous applied displacement (0 when idle). */
  private lastMoveSpeedKmh = 0;
  private lastMoveSlopeDeg = 0;
  private lastMoveSpeedModPct = 100;
  private onPlayersChange?: (n: number) => void;
  private onChat?: (line: string) => void;
  private onPing?: (ms: number | null) => void;
  private onTileInfo?: (info: TileInfo) => void;
  private onMouseTileInfo?: (info: TileInfo | null) => void;
  private onPlayerStats?: (stats: PlayerStats) => void;
  private pingTimer?: ReturnType<typeof setInterval>;
  private awaitingPong = false;
  /** False while async create/load runs — clock must not burn day-seconds. */
  private simReady = false;
  /** Wall-clock anchor so day length matches real seconds (not capped frame dt). */
  private lastClockWallMs = 0;
  /**
   * Phaser skips any key event with defaultPrevented===true. So we must NOT
   * preventDefault in capture phase. Bubble phase runs after Phaser queues the
   * key, then we cancel browser/IDE shortcuts that use Ctrl/Shift/Meta.
   */
  private readonly blockBrowserHotkeys = (e: KeyboardEvent) => {
    if (this.chatFocused) return;
    if (!(e.ctrlKey || e.shiftKey || e.metaKey || e.altKey)) return;
    e.preventDefault();
  };

  /** N/M ±5min, Shift+N/M ±1h; V/B calendar; +/− ±1h. In rooms → server. */
  private readonly onTimeKeys = (e: KeyboardEvent) => {
    if (this.chatFocused) return;
    if (e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      return;
    }

    const sendOrLocal = (hours = 0, days = 0) => {
      if (this.config.roomId && this.socket?.connected) {
        this.socket.emit('time:nudge', { hours, days });
        return;
      }
      if (hours) GameClock.nudge(hours);
      if (days) GameCalendar.nudgeDays(days);
    };

    if (e.key === '+' || e.code === 'NumpadAdd') {
      sendOrLocal(1, 0);
      e.preventDefault();
    } else if (e.key === '-' || e.code === 'NumpadSubtract') {
      sendOrLocal(-1, 0);
      e.preventDefault();
    } else if (e.code === 'KeyM') {
      sendOrLocal(e.shiftKey ? 1 : 5 / 60, 0);
      e.preventDefault();
    } else if (e.code === 'KeyN') {
      sendOrLocal(e.shiftKey ? -1 : -5 / 60, 0);
      e.preventDefault();
    } else if (e.code === 'KeyB') {
      sendOrLocal(0, e.shiftKey ? 30 : 1);
      e.preventDefault();
    } else if (e.code === 'KeyV') {
      sendOrLocal(0, e.shiftKey ? -30 : -1);
      e.preventDefault();
    }
  };

  /** Clear stuck WASD/arrows after blur — Phaser never sees the missing keyup. */
  private readonly clearStuckKeys = () => {
    this.input.keyboard?.resetKeys();
  };

  private readonly onVisibilityChange = () => {
    if (document.hidden) this.clearStuckKeys();
    // Avoid a huge clock jump when returning to the tab.
    this.lastClockWallMs = performance.now();
  };

  /** Keep right-click cancel from opening the browser menu on the canvas. */
  private readonly blockContextMenu = (e: Event) => {
    e.preventDefault();
  };

  /** Apply server room clock (scale + hour + calendar + lunar). */
  private applyRoomTimeSync(sync: TimeSyncPayload) {
    GameClock.applyServerSync(sync);
    this.config.daySeconds = sync.daySeconds;
    this.config.daysPerMonth = sync.daysPerMonth;
    this.config.lunarQuarterDays = sync.lunarQuarterDays;
    const lag = Date.now() - sync.serverTimeMs;
    if (lag > 0 && lag < 2000) GameClock.tick(lag);
    this.lastClockWallMs = performance.now();
    this.sunlightFx?.setTimeOfDay(GameClock.hour);
    this.sunlightFx?.setDayOfYear(GameCalendar.dayOfYear);
    this.sunlightFx?.setMoonIntensity(GameLunar.shaderIntensity);
  }

  constructor() {
    super('World');
  }

  init(data: {
    boot: BootConfig;
    onPlayersChange: (n: number) => void;
    onChat: (line: string) => void;
    onPing?: (ms: number | null) => void;
    onTileInfo: (info: TileInfo) => void;
    onMouseTileInfo?: (info: TileInfo | null) => void;
    onPlayerStats?: (stats: PlayerStats) => void;
  }) {
    this.config = data.boot;
    this.onPlayersChange = data.onPlayersChange;
    this.onChat = data.onChat;
    this.onPing = data.onPing;
    this.onTileInfo = data.onTileInfo;
    this.onMouseTileInfo = data.onMouseTileInfo;
    this.onPlayerStats = data.onPlayerStats;
    if (this.config.daySeconds != null) setDaySeconds(this.config.daySeconds);
    if (this.config.daysPerMonth != null) setDaysPerMonth(this.config.daysPerMonth);
    if (this.config.lunarQuarterDays != null) {
      setLunarQuarterDays(this.config.lunarQuarterDays);
    }
  }

  setChatFocused(focused: boolean) {
    this.chatFocused = focused;
    const kb = this.input.keyboard;
    if (!kb) return;
    if (focused) {
      // Let the DOM input receive Space and other keys (Phaser capture uses preventDefault).
      kb.disableGlobalCapture();
      kb.resetKeys();
    } else {
      kb.enableGlobalCapture();
      kb.addCapture(MOVE_CAPTURE);
    }
  }

  async create() {
    this.config.onStatus('Cargando mapa…');

    let streamed = false;

    if (this.config.mapSource === 'layers') {
      try {
        this.config.onStatus('Pediendo meta al servidor…');
        const meta = await fetchWorldMeta(this.config.worldId);
        const store = new TileStore(this.config.worldId, meta, this.config.roomId);
        this.tileView = new TileMapView(this, store.tileSize);
        store.onTileReady = (tile) => this.tileView?.addOrUpdate(tile);
        store.onTileEvicted = (tx, ty) => this.tileView?.remove(tx, ty);
        store.onRegionChanged = (region) => this.applyFxRegion(region);
        this.mapData = {
          width: meta.width,
          height: meta.height,
          tileStore: store,
        };
        streamed = true;
        this.config.onStatus('');
      } catch (err) {
        console.warn(err);
        this.config.onStatus('Sin mapa en server — usando procedural…');
        this.mapData = await this.buildFallbackMap();
      }
    } else {
      this.mapData = await this.buildFallbackMap();
    }

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.mapData.width, this.mapData.height);
    cam.setZoom(DEFAULT_CAMERA_ZOOM);
    cam.setBackgroundColor('#0a1620');

    if (streamed && this.mapData.tileStore) {
      const geo = 'equirectangular' as const;
      this.sunlightFx = attachSunlight(this, cam, {
        hour: GameClock.hour,
        dayOfYear: GameCalendar.dayOfYear,
        moonIntensity: GameLunar.shaderIntensity,
        geo,
        mapWidth: this.mapData.width,
        mapHeight: this.mapData.height,
      });
      if (this.config.fxWaves) {
        this.waterFx = attachWaterCaustics(this, cam, {
          mapWidth: this.mapData.width,
          mapHeight: this.mapData.height,
        });
      }
      if (this.config.fxClouds) {
        this.cloudsFx = attachClouds(this, cam, {
          mapWidth: this.mapData.width,
          mapHeight: this.mapData.height,
        });
      }
      // Kick first tile fetch around default spawn / camera center
      this.mapData.tileStore.syncToView(cam.worldView);
    } else {
      imageDataToTextureKey(this, 'world-map', this.mapData.imageData!);
      const mapImage = this.add
        .image(0, 0, 'world-map')
        .setOrigin(0, 0)
        .setDisplaySize(this.mapData.width, this.mapData.height);

      const geo =
        this.config.mapSource === 'upload' ? 'none' : 'equirectangular';
      if (this.mapData.elevation) {
        this.sunlightFx = attachSunlight(
          this,
          mapImage,
          {
            hour: GameClock.hour,
            dayOfYear: GameCalendar.dayOfYear,
            moonIntensity: GameLunar.shaderIntensity,
            geo,
            mapWidth: this.mapData.width,
            mapHeight: this.mapData.height,
          },
          {
            originX: 0,
            originY: 0,
            width: this.mapData.width,
            height: this.mapData.height,
            elevation: this.mapData.elevation,
            landmask: this.mapData.landmask,
            landcover: this.mapData.landcover,
          },
        );
      }

      if (this.mapData.landmask && this.config.fxWaves) {
        this.waterFx = attachWaterCaustics(
          this,
          mapImage,
          {
            mapWidth: this.mapData.width,
            mapHeight: this.mapData.height,
          },
          {
            originX: 0,
            originY: 0,
            width: this.mapData.width,
            height: this.mapData.height,
            landmask: this.mapData.landmask,
            elevation: this.mapData.elevation,
            landcover: this.mapData.landcover,
          },
        );
      }

      if (this.config.fxClouds) {
        this.cloudsFx = attachClouds(this, mapImage, {
          mapWidth: this.mapData.width,
          mapHeight: this.mapData.height,
        });
      }
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.waterFx?.destroy();
      this.waterFx = undefined;
      this.sunlightFx?.destroy();
      this.sunlightFx = undefined;
      this.cloudsFx?.destroy();
      this.cloudsFx = undefined;
      this.mapData?.tileStore?.destroy();
      this.tileView?.destroy();
      this.tileView = undefined;
      this.clearMoveTarget(true);
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = undefined;
      }
      window.removeEventListener('keydown', this.blockBrowserHotkeys);
      window.removeEventListener('keyup', this.blockBrowserHotkeys);
      window.removeEventListener('keydown', this.onTimeKeys);
      window.removeEventListener('blur', this.clearStuckKeys);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.game.canvas?.removeEventListener('contextmenu', this.blockContextMenu);
      this.game.events.off(Phaser.Core.Events.BLUR, this.clearStuckKeys);
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.clearStuckKeys);
    });

    this.input.on('wheel', (_p: unknown, _dx: number, _dy: number, dz: number) => {
      const cam = this.cameras.main;
      const next = Phaser.Math.Clamp(cam.zoom - dz * 0.0015, 0.15, 32);
      cam.setZoom(next);
      this.syncPlayerScreenScale();
      this.syncMoveTargetMarker();
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.emitMouseTileInfo(pointer);
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.chatFocused || document.hidden || !this.mapData) return;
      if (pointer.rightButtonDown() || pointer.button === 2) {
        this.clearMoveTarget();
        return;
      }
      if (!pointer.leftButtonDown() && pointer.button !== 0) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.setMoveTarget(world.x, world.y);
    });
    this.input.on('gameout', () => {
      this.lastMouseTileKey = '';
      this.onMouseTileInfo?.(null);
    });

    if (this.input.keyboard) {
      // Arrows only — createCursorKeys() also captures SPACE and blocks typing spaces in chat.
      this.cursors = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.UP,
        down: Phaser.Input.Keyboard.KeyCodes.DOWN,
        left: Phaser.Input.Keyboard.KeyCodes.LEFT,
        right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      }) as Phaser.Types.Input.Keyboard.CursorKeys;
      this.wasd = this.input.keyboard.addKeys('W,A,S,D') as typeof this.wasd;
      this.shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
      this.ctrlKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);
      this.input.keyboard.addCapture(MOVE_CAPTURE);
    }

    // Bubble phase (after Phaser): cancel browser shortcuts without starving input
    window.addEventListener('keydown', this.blockBrowserHotkeys);
    window.addEventListener('keyup', this.blockBrowserHotkeys);
    window.addEventListener('keydown', this.onTimeKeys);
    window.addEventListener('blur', this.clearStuckKeys);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.game.canvas?.addEventListener('contextmenu', this.blockContextMenu);
    this.game.events.on(Phaser.Core.Events.BLUR, this.clearStuckKeys);
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.clearStuckKeys);

    if (this.config.roomId) {
      this.config.onStatus('Conectando a la sala…');
      this.connectMultiplayer();
    } else {
      this.config.onStatus('');
      this.spawnLocalSolo();
      this.onPlayersChange?.(1);
    }

    // Re-apply after async load (HMR / long fetch) and start the day timer cleanly.
    if (this.config.daySeconds != null) setDaySeconds(this.config.daySeconds);
    if (this.config.daysPerMonth != null) setDaysPerMonth(this.config.daysPerMonth);
    if (this.config.lunarQuarterDays != null) {
      setLunarQuarterDays(this.config.lunarQuarterDays);
    }
    this.lastClockWallMs = performance.now();
    this.simReady = true;
  }

  private setMoveTarget(x: number, y: number) {
    if (!this.mapData) return;
    const { width, height } = this.mapData;
    const tx = Phaser.Math.Clamp(x, 4, width - 4);
    const ty = Phaser.Math.Clamp(y, 4, height - 4);
    if (this.isBlockedAt(tx, ty)) return;
    this.moveTarget = { x: tx, y: ty };
    const z = Math.max(this.cameras.main.zoom, 0.01);
    if (!this.moveTargetMarker) {
      this.moveTargetMarker = this.add
        .text(tx, ty, MOVE_TARGET_EMOJI, {
          fontFamily: EMOJI_FONT,
          fontSize: `${MOVE_TARGET_SCREEN_PX}px`,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(10_000)
        .setScale(1 / z);
    } else {
      this.moveTargetMarker.setPosition(tx, ty).setVisible(true).setScale(1 / z);
    }
  }

  private clearMoveTarget(destroy = false) {
    this.moveTarget = null;
    if (destroy) {
      this.moveTargetMarker?.destroy();
      this.moveTargetMarker = undefined;
    } else {
      this.moveTargetMarker?.setVisible(false);
    }
  }

  private syncMoveTargetMarker() {
    if (!this.moveTargetMarker?.visible || !this.moveTarget) return;
    const z = Math.max(this.cameras.main.zoom, 0.01);
    this.moveTargetMarker.setPosition(this.moveTarget.x, this.moveTarget.y);
    this.moveTargetMarker.setScale(1 / z);
  }

  /** Impassable: ocean, missing tile, or walkable=0. */
  private isBlockedAt(x: number, y: number): boolean {
    if (!this.mapData) return true;
    const s = this.sampleAt(x, y);
    if (s.land === null) {
      if (this.mapData.tileStore) return true;
      const cover = s.landcoverCode;
      if (cover === LANDCOVER.WATER) return true;
      const { width: w, height: h } = this.mapData;
      const ix = Phaser.Math.Clamp(Math.floor(x), 0, w - 1);
      const iy = Phaser.Math.Clamp(Math.floor(y), 0, h - 1);
      return this.mapData.walkable?.[iy * w + ix] === 0;
    }
    return s.land === false;
  }

  private emitMove(force = false) {
    if (!this.player || !this.socket?.connected) return;
    const { x, y } = this.player;
    const moved =
      Number.isNaN(this.lastEmitX) ||
      Math.hypot(x - this.lastEmitX, y - this.lastEmitY) > 0.25;
    const now = performance.now();
    if (!force && !moved) return;
    if (!force && now - this.lastEmit < 80) return;
    this.lastEmit = now;
    this.lastEmitX = x;
    this.lastEmitY = y;
    this.socket.emit('player:move', { x, y, facing: this.facing });
  }

  private applyFxRegion(region: RegionLayers | null) {
    this.sunlightFx?.setRegionLayers(region);
    this.waterFx?.setRegionLayers(region);
  }

  private async buildFallbackMap(): Promise<PlayableMap> {
    const pixelScale = this.config.width >= 8192 ? 4 : this.config.width >= 4096 ? 2 : 1;
    const result = await buildPixelMap(
      {
        width: this.config.width,
        height: this.config.height,
        pixelScale,
        palette: this.config.palette,
      },
      this.config.mapSource === 'upload' ? this.config.file : null,
      this.config.onStatus,
    );
    return result;
  }

  private sampleAt(x: number, y: number): {
    elevationM: number | null;
    landcoverCode: number | null;
    land: boolean | null;
  } {
    const store = this.mapData?.tileStore;
    if (store) return store.sample(x, y);
    if (!this.mapData) return { elevationM: null, landcoverCode: null, land: null };
    const { width, height } = this.mapData;
    const ix = Phaser.Math.Clamp(Math.floor(x), 0, width - 1);
    const iy = Phaser.Math.Clamp(Math.floor(y), 0, height - 1);
    const idx = iy * width + ix;
    const land =
      this.mapData.landmask?.[idx] !== undefined
        ? this.mapData.landmask[idx] === 1
        : this.mapData.walkable
          ? this.mapData.walkable[idx] === 1
          : null;
    return {
      elevationM: this.mapData.elevation?.[idx] ?? null,
      landcoverCode: this.mapData.landcover?.[idx] ?? null,
      land,
    };
  }

  private sampleTileAt(x: number, y: number): TileInfo | null {
    if (!this.mapData) return null;
    const { width, height } = this.mapData;
    const ix = Phaser.Math.Clamp(Math.floor(x), 0, width - 1);
    const iy = Phaser.Math.Clamp(Math.floor(y), 0, height - 1);
    const lon = (ix / width) * 360 - 180;
    const lat = 90 - (iy / height) * 180;
    const s = this.sampleAt(ix, iy);
    const code = s.landcoverCode;

    return {
      x: ix,
      y: iy,
      lon,
      lat,
      elevationM: s.elevationM,
      landcoverCode: code,
      landcover: code != null ? LANDCOVER_LABELS[code] ?? `code_${code}` : null,
      land: s.land,
    };
  }

  private spawnLocalSolo() {
    if (this.player || !this.mapData) return;
    const spawn = areaSpawn(
      this.config.startingArea || DEFAULT_STARTING_AREA,
      this.mapData.width,
      this.mapData.height,
    );
    this.spawnLocal({
      id: 'local',
      name: this.config.name,
      x: spawn.x,
      y: spawn.y,
      color: 0xf0a050,
      facing: 'down',
      emoji: this.config.emoji || DEFAULT_PLAYER_EMOJI,
    });
  }

  private connectMultiplayer() {
    const roomId = this.config.roomId;
    if (!roomId) {
      this.spawnLocalSolo();
      return;
    }

    const url = import.meta.env.VITE_SOCKET_URL || undefined;
    this.socket = io(url || '/', {
      query: {
        roomId,
        name: this.config.name,
        startingArea: this.config.startingArea || DEFAULT_STARTING_AREA,
        emoji: this.config.emoji || DEFAULT_PLAYER_EMOJI,
      },
      transports: ['websocket', 'polling'],
    });

    const startPingLoop = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      const probe = () => {
        if (!this.socket?.connected || this.awaitingPong) return;
        this.awaitingPong = true;
        this.socket.emit('latency:ping', performance.now());
      };
      probe();
      this.pingTimer = setInterval(probe, 2000);
    };

    this.socket.on('latency:pong', (clientTime: number) => {
      this.awaitingPong = false;
      const ms = Math.max(0, Math.round(performance.now() - clientTime));
      this.onPing?.(ms);
    });

    this.socket.on('connect', () => {
      startPingLoop();
    });

    this.socket.on('disconnect', () => {
      this.awaitingPong = false;
      this.onPing?.(null);
    });

    this.socket.on('welcome', (payload: WelcomePayload) => {
      this.localId = payload.you.id;
      if (payload.joinCode) this.config.joinCode = payload.joinCode;
      if (payload.time) this.applyRoomTimeSync(payload.time);
      this.spawnLocal(payload.you);
      for (const p of Object.values(payload.room.players)) {
        if (p.id !== this.localId) this.spawnRemote(p);
      }
      this.onPlayersChange?.(Object.keys(payload.room.players).length);
      this.config.onStatus('');
      startPingLoop();
    });

    this.socket.on('player:join', (p: PlayerState) => {
      if (p.id === this.localId) return;
      this.spawnRemote(p);
      this.onPlayersChange?.((this.remotes.size || 0) + 1);
    });

    this.socket.on('player:leave', (id: string) => {
      const r = this.remotes.get(id);
      if (r) {
        r.body.destroy();
        r.label.destroy();
        this.remotes.delete(id);
      }
      this.onPlayersChange?.(this.remotes.size + 1);
    });

    this.socket.on(
      'player:move',
      (data: { id: string; x: number; y: number; facing: PlayerState['facing'] }) => {
        const r = this.remotes.get(data.id);
        if (!r) return;
        r.targetX = data.x;
        r.targetY = data.y;
      },
    );

    this.socket.on('chat', (msg: { name: string; text: string }) => {
      this.onChat?.(`${msg.name}: ${msg.text}`);
    });

    this.socket.on('map:patch', (event: MapPatchEvent) => {
      const store = this.mapData?.tileStore;
      if (!store) return;
      store.invalidate(event.tiles?.length ? event.tiles : undefined);
    });

    this.socket.on('time:sync', (sync: TimeSyncPayload) => {
      this.applyRoomTimeSync(sync);
    });

    this.socket.on('room:reject', (payload: { message?: string }) => {
      this.config.onStatus(payload?.message || 'No se pudo entrar a la sala');
      this.spawnLocalSolo();
      this.onPlayersChange?.(1);
    });

    this.socket.on('connect_error', () => {
      this.awaitingPong = false;
      this.onPing?.(null);
      this.config.onStatus('Sin servidor — modo local (abrí `npm run dev`)');
      this.spawnLocalSolo();
      this.onPlayersChange?.(1);
    });
  }

  private makeEmojiMarker(x: number, y: number, emoji: string, depth: number) {
    return this.add
      .text(x, y, emoji || DEFAULT_PLAYER_EMOJI, {
        fontFamily: EMOJI_FONT,
        fontSize: `${PLAYER_SCREEN_PX}px`,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(depth)
      .setResolution(2)
      .setAlpha(PLAYER_MARKER_ALPHA)
      .setShadow(0, 1, '#000000', 4, false, true);
  }

  private makePlayerLabel(x: number, y: number, name: string, color: string, depth: number) {
    return this.add
      .text(x, y, name, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: PLAYER_LABEL_FONT,
        color,
        stroke: '#0a1210',
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setDepth(depth)
      .setAlpha(PLAYER_MARKER_ALPHA)
      .setShadow(0, 1, '#000000', 3, false, true);
  }

  private spawnLocal(p: PlayerState) {
    this.player = this.makeEmojiMarker(p.x, p.y, p.emoji, 10);
    this.playerLabel = this.makePlayerLabel(
      p.x,
      p.y - PLAYER_LABEL_OFFSET,
      p.name,
      '#f2f7f0',
      11,
    );
    this.syncPlayerScreenScale();
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.mapData?.tileStore?.syncToView(this.cameras.main.worldView);
    this.emitTileInfo(true);
  }

  private spawnRemote(p: PlayerState) {
    if (this.remotes.has(p.id)) return;
    const body = this.makeEmojiMarker(p.x, p.y, p.emoji, 9);
    const label = this.makePlayerLabel(
      p.x,
      p.y - PLAYER_LABEL_OFFSET,
      p.name,
      '#f0d9a8',
      9,
    );
    this.remotes.set(p.id, { body, label, targetX: p.x, targetY: p.y });
    this.syncPlayerScreenScale();
  }

  /** Keep markers tiny on screen even when the camera is zoomed in. */
  private syncPlayerScreenScale() {
    const zoom = Math.max(this.cameras.main.zoom, 0.01);
    const scale = 1 / zoom;
    const labelLift = PLAYER_LABEL_OFFSET / zoom;
    if (this.player) this.player.setScale(scale);
    if (this.playerLabel) {
      this.playerLabel.setScale(scale);
      this.playerLabel.setPosition(this.player!.x, this.player!.y - labelLift);
    }
    for (const r of this.remotes.values()) {
      r.body.setScale(scale);
      r.label.setScale(scale);
      r.label.setPosition(r.body.x, r.body.y - labelLift);
    }
    this.syncMoveTargetMarker();
  }

  sendChat(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Demo room deltas (chat commands)
    const seaMatch = trimmed.match(/^\/sea\s+(-?\d+)\s*$/i);
    if (seaMatch && this.socket) {
      this.socket.emit('map:demo', { kind: 'seaLevel', meters: Number(seaMatch[1]) });
      return;
    }
    if (/^\/flood\b/i.test(trimmed) && this.socket && this.player) {
      const halfMatch = trimmed.match(/^\/flood\s+(\d+)\s*$/i);
      const halfSize = halfMatch ? Number(halfMatch[1]) : 48;
      this.socket.emit('map:demo', {
        kind: 'flood',
        x: this.player.x,
        y: this.player.y,
        halfSize,
      });
      return;
    }

    this.socket?.emit('chat', trimmed);
  }

  private emitTileInfo(force = false) {
    if (!this.player || !this.onTileInfo) return;
    const x = Math.floor(this.player.x);
    const y = Math.floor(this.player.y);
    const key = `${x},${y}`;
    if (!force && key === this.lastTileKey) return;
    this.lastTileKey = key;
    const info = this.sampleTileAt(x, y);
    if (info) this.onTileInfo(info);
  }

  private emitPlayerStats(moving: boolean) {
    if (!this.player || !this.onPlayerStats) return;
    const cur = this.sampleAt(this.player.x, this.player.y);
    this.onPlayerStats({
      speedKmh: this.lastMoveSpeedKmh,
      slopeDeg: this.lastMoveSlopeDeg,
      speedModPct: this.lastMoveSpeedModPct,
      facing: this.facing,
      moving,
      riverCrossing: cur.landcoverCode === LANDCOVER.FRESHWATER,
      zoom: this.cameras.main.zoom,
    });
  }

  private emitMouseTileInfo(pointer: Phaser.Input.Pointer) {
    if (!this.mapData || !this.onMouseTileInfo) return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = Math.floor(world.x);
    const y = Math.floor(world.y);
    const { width, height } = this.mapData;
    if (x < 0 || y < 0 || x >= width || y >= height) {
      if (this.lastMouseTileKey !== '') {
        this.lastMouseTileKey = '';
        this.onMouseTileInfo(null);
      }
      return;
    }
    const key = `${x},${y}`;
    if (key === this.lastMouseTileKey) return;
    this.lastMouseTileKey = key;
    const info = this.sampleTileAt(x, y);
    this.onMouseTileInfo(info);
  }

  /** Hours in [0, 24). Sunrise ~6.5, noon 12, sunset ~18. */
  setTimeOfDay(hour: number) {
    GameClock.setHour(hour);
    this.sunlightFx?.setTimeOfDay(GameClock.hour);
    this.sunlightFx?.setDayOfYear(GameCalendar.dayOfYear);
  }

  getTimeOfDay(): number {
    return GameClock.hour;
  }

  /** Moonlight driven by GameLunar (shader range 0.2 … 1). */
  getMoonIntensity(): number {
    return GameLunar.shaderIntensity;
  }

  update(_t: number, dt: number) {
    // Movement keeps a tight dt cap; the civil clock uses wall time so
    // "duración del día" matches real seconds (frame hitches won't stretch it).
    const frameDt = Math.min(dt, 50);
    if (this.simReady && !document.hidden) {
      const now = performance.now();
      let wallDt = now - this.lastClockWallMs;
      this.lastClockWallMs = now;
      // Ignore absurd stalls (debugger / long GC); keep day pacing honest.
      if (wallDt > 0 && wallDt <= 1000) GameClock.tick(wallDt);
    } else {
      this.lastClockWallMs = performance.now();
    }

    this.sunlightFx?.setTimeOfDay(GameClock.hour);
    this.sunlightFx?.setDayOfYear(GameCalendar.dayOfYear);
    this.sunlightFx?.setMoonIntensity(GameLunar.shaderIntensity);
    this.waterFx?.setTime(this.time.now);
    this.cloudsFx?.setTime(this.time.now);

    if (!this.mapData) return;

    this.mapData.tileStore?.syncToView(this.cameras.main.worldView);

    if (!this.player) return;

    let vx = 0;
    let vy = 0;
    let fromKeys = false;
    if (!this.chatFocused && !document.hidden) {
      if (this.cursors?.left.isDown || this.wasd?.A.isDown) vx -= 1;
      if (this.cursors?.right.isDown || this.wasd?.D.isDown) vx += 1;
      if (this.cursors?.up.isDown || this.wasd?.W.isDown) vy -= 1;
      if (this.cursors?.down.isDown || this.wasd?.S.isDown) vy += 1;
      fromKeys = vx !== 0 || vy !== 0;
      if (fromKeys) this.clearMoveTarget();
      else if (this.moveTarget) {
        vx = this.moveTarget.x - this.player.x;
        vy = this.moveTarget.y - this.player.y;
        const dist = Math.hypot(vx, vy);
        if (dist < 0.6) {
          this.player.x = this.moveTarget.x;
          this.player.y = this.moveTarget.y;
          this.playerLabel?.setPosition(
            this.player.x,
            this.player.y - PLAYER_LABEL_OFFSET / Math.max(this.cameras.main.zoom, 0.01),
          );
          this.clearMoveTarget();
          this.emitMove(true);
          vx = 0;
          vy = 0;
        }
      }
    }

    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      const len = Math.hypot(vx, vy) || 1;
      vx /= len;
      vy /= len;
      if (Math.abs(vx) > Math.abs(vy)) this.facing = vx < 0 ? 'left' : 'right';
      else this.facing = vy < 0 ? 'up' : 'down';

      const speedMul = this.shiftKey?.isDown ? 0.1 : this.ctrlKey?.isDown ? 10 : 1;
      const { width, height } = this.mapData;
      const lat = 90 - (this.player.y / height) * 180;
      const speed = walkSpeedPxPerSec(width, lat);
      let step = (speed * speedMul * frameDt) / 1000;

      // Don't overshoot the click target in one frame.
      if (!fromKeys && this.moveTarget) {
        const remain = Math.hypot(
          this.moveTarget.x - this.player.x,
          this.moveTarget.y - this.player.y,
        );
        if (step > remain) step = remain;
      }

      const cur = this.sampleAt(this.player.x, this.player.y);
      // Rivers / inland freshwater: 20× slower. Ocean is blocked below.
      const terrainMul = cur.landcoverCode === LANDCOVER.FRESHWATER ? 0.05 : 1;

      // Uphill only: 1× at 0 m rise → 0.2× at ≥100 m rise (linear).
      let climbMul = 1;
      const elevHere = cur.elevationM;
      const elevAhead = this.sampleAt(this.player.x + vx, this.player.y + vy).elevationM;
      if (elevHere != null && elevAhead != null) {
        const rise = elevAhead - elevHere;
        if (rise > 0) {
          const t = Math.min(1, rise / 100);
          climbMul = 1 - 0.8 * t;
        }
      }

      const tryX = this.player.x + vx * step * terrainMul * climbMul;
      const tryY = this.player.y + vy * step * terrainMul * climbMul;
      const nx = Phaser.Math.Clamp(tryX, 4, width - 4);
      const ny = Phaser.Math.Clamp(tryY, 4, height - 4);

      const prevX = this.player.x;
      const prevY = this.player.y;

      // Ocean / unloaded: impassable. Slide along coast if only one axis is blocked.
      if (!this.isBlockedAt(nx, ny)) {
        this.player.x = nx;
        this.player.y = ny;
      } else {
        if (!this.isBlockedAt(nx, this.player.y)) this.player.x = nx;
        if (!this.isBlockedAt(this.player.x, ny)) this.player.y = ny;
      }

      const movedPx = Math.hypot(this.player.x - prevX, this.player.y - prevY);
      const dtSec = frameDt / 1000;
      // In-game km/h: equator km/px ÷ game hours (from day-duration slider).
      if (movedPx > 0 && dtSec > 0) {
        this.lastMoveSpeedKmh = ingameSpeedKmh(movedPx, width, dtSec);
        this.lastMoveSpeedModPct = terrainMul * climbMul * 100;
        const elevAfter = this.sampleAt(this.player.x, this.player.y).elevationM;
        if (elevHere != null && elevAfter != null) {
          const rise = elevAfter - elevHere;
          const midLat = 90 - (((prevY + this.player.y) * 0.5) / height) * 180;
          const groundM = movedPx * metersPerWorldPixel(width, midLat);
          this.lastMoveSlopeDeg =
            groundM > 1e-9
              ? (Math.atan2(rise, groundM) * 180) / Math.PI
              : rise > 0
                ? 90
                : rise < 0
                  ? -90
                  : 0;
        } else {
          this.lastMoveSlopeDeg = 0;
        }
      }

      // Click path stuck against coast / unloaded tile — drop the target.
      if (!fromKeys && this.moveTarget && movedPx < 1e-6) {
        this.clearMoveTarget();
      }

      this.playerLabel?.setPosition(
        this.player.x,
        this.player.y - PLAYER_LABEL_OFFSET / Math.max(this.cameras.main.zoom, 0.01),
      );
      this.emitMove();
    } else if (this.wasMoving) {
      // Flush final pose so remotes don't keep chasing a mid-stride target.
      this.emitMove(true);
    }
    this.wasMoving = moving;

    this.emitTileInfo();
    this.emitPlayerStats(moving);

    for (const r of this.remotes.values()) {
      r.body.x = Phaser.Math.Linear(r.body.x, r.targetX, 0.25);
      r.body.y = Phaser.Math.Linear(r.body.y, r.targetY, 0.25);
      r.label.setPosition(
        r.body.x,
        r.body.y - PLAYER_LABEL_OFFSET / Math.max(this.cameras.main.zoom, 0.01),
      );
    }
  }
}

export function startGame(
  parent: string,
  boot: BootConfig,
  hooks: {
    onPlayersChange: (n: number) => void;
    onChat: (line: string) => void;
    onPing?: (ms: number | null) => void;
    onTileInfo: (info: TileInfo) => void;
    onMouseTileInfo?: (info: TileInfo | null) => void;
    onPlayerStats?: (stats: PlayerStats) => void;
    getChatSender: (send: (text: string) => void) => void;
    getChatFocusSetter: (setFocused: (focused: boolean) => void) => void;
  },
): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#0a1620',
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    scene: [WorldScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });

  game.scene.start('World', {
    boot,
    onPlayersChange: hooks.onPlayersChange,
    onChat: hooks.onChat,
    onPing: hooks.onPing,
    onTileInfo: hooks.onTileInfo,
    onMouseTileInfo: hooks.onMouseTileInfo,
    onPlayerStats: hooks.onPlayerStats,
  });

  const wire = () => {
    const scene = game.scene.getScene('World') as WorldScene;
    if (!scene) return;
    hooks.getChatSender((text) => scene.sendChat(text));
    hooks.getChatFocusSetter((focused) => scene.setChatFocused(focused));
  };

  game.events.once('ready', wire);
  setTimeout(wire, 500);

  return game;
}
