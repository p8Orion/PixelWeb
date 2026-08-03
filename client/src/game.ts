import Phaser from 'phaser';
import { io, type Socket } from 'socket.io-client';
import type { PlayerState, RoomState, StartingAreaId } from '../../shared/types';
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
import { buildPixelMap, imageDataToTextureKey } from './map/pixelMap';
import { TileMapView } from './map/tileLayer';
import { fetchWorldMeta, TileStore, type RegionLayers } from './map/tileStore';

export interface BootConfig {
  name: string;
  width: number;
  height: number;
  palette: 'earth' | 'retro' | 'mono';
  /** Prefer baked logical layers from `npm run maps:build`. */
  mapSource: 'layers' | 'procedural' | 'upload';
  /** Which interpreted world to fetch when mapSource=layers. */
  worldId: string;
  /** Regional spawn box (Argentina, EEUU, …). */
  startingArea: StartingAreaId;
  /** Emoji avatar drawn on the map. */
  emoji: string;
  file: File | null;
  /** PostFX: procedural clouds */
  fxClouds: boolean;
  /** PostFX: coastal water caustics / waves */
  fxWaves: boolean;
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
  private speed = 70;
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
  private onPlayersChange?: (n: number) => void;
  private onChat?: (line: string) => void;
  private onPing?: (ms: number | null) => void;
  private onTileInfo?: (info: TileInfo) => void;
  private onMouseTileInfo?: (info: TileInfo | null) => void;
  private pingTimer?: ReturnType<typeof setInterval>;
  private awaitingPong = false;
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

  /** N/M ±5min, Shift+N/M ±1h; V/B ±3d, Shift+V/B ±30d; +/− ±1h. */
  private readonly onTimeKeys = (e: KeyboardEvent) => {
    if (this.chatFocused) return;
    if (e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      return;
    }
    if (e.key === '+' || e.code === 'NumpadAdd') {
      GameClock.nudge(1);
      e.preventDefault();
    } else if (e.key === '-' || e.code === 'NumpadSubtract') {
      GameClock.nudge(-1);
      e.preventDefault();
    } else if (e.code === 'KeyM') {
      GameClock.nudge(e.shiftKey ? 1 : 5 / 60);
      e.preventDefault();
    } else if (e.code === 'KeyN') {
      GameClock.nudge(e.shiftKey ? -1 : -5 / 60);
      e.preventDefault();
    } else if (e.code === 'KeyB') {
      GameCalendar.nudgeDays(e.shiftKey ? 30 : 3);
      e.preventDefault();
    } else if (e.code === 'KeyV') {
      GameCalendar.nudgeDays(e.shiftKey ? -30 : -3);
      e.preventDefault();
    }
  };

  /** Clear stuck WASD/arrows after blur — Phaser never sees the missing keyup. */
  private readonly clearStuckKeys = () => {
    this.input.keyboard?.resetKeys();
  };

  private readonly onVisibilityChange = () => {
    if (document.hidden) this.clearStuckKeys();
  };

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
  }) {
    this.config = data.boot;
    this.onPlayersChange = data.onPlayersChange;
    this.onChat = data.onChat;
    this.onPing = data.onPing;
    this.onTileInfo = data.onTileInfo;
    this.onMouseTileInfo = data.onMouseTileInfo;
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
        const store = new TileStore(this.config.worldId, meta);
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
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = undefined;
      }
      window.removeEventListener('keydown', this.blockBrowserHotkeys);
      window.removeEventListener('keyup', this.blockBrowserHotkeys);
      window.removeEventListener('keydown', this.onTimeKeys);
      window.removeEventListener('blur', this.clearStuckKeys);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.game.events.off(Phaser.Core.Events.BLUR, this.clearStuckKeys);
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.clearStuckKeys);
    });

    this.input.on('wheel', (_p: unknown, _dx: number, _dy: number, dz: number) => {
      const cam = this.cameras.main;
      const next = Phaser.Math.Clamp(cam.zoom - dz * 0.0015, 0.15, 32);
      cam.setZoom(next);
      this.syncPlayerScreenScale();
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.emitMouseTileInfo(pointer);
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
    this.game.events.on(Phaser.Core.Events.BLUR, this.clearStuckKeys);
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.clearStuckKeys);

    this.config.onStatus('Conectando al servidor…');
    this.connectMultiplayer();
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

  private connectMultiplayer() {
    const url = import.meta.env.VITE_SOCKET_URL || undefined;
    this.socket = io(url || '/', {
      query: {
        name: this.config.name,
        worldId: this.config.worldId,
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

    this.socket.on('welcome', (payload: { you: PlayerState; room: RoomState }) => {
      this.localId = payload.you.id;
      this.spawnLocal(payload.you);
      for (const p of Object.values(payload.room.players)) {
        if (p.id !== this.localId) this.spawnRemote(p);
      }
      this.socket?.emit('map:size', {
        width: this.mapData!.width,
        height: this.mapData!.height,
      });
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

    this.socket.on('connect_error', () => {
      this.awaitingPong = false;
      this.onPing?.(null);
      this.config.onStatus('Sin servidor — modo local (abrí `npm run dev`)');
      if (!this.player) {
        const spawn = areaSpawn(
          this.config.startingArea || DEFAULT_STARTING_AREA,
          this.mapData!.width,
          this.mapData!.height,
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
      .setResolution(2);
  }

  private spawnLocal(p: PlayerState) {
    this.player = this.makeEmojiMarker(p.x, p.y, p.emoji, 10);
    this.playerLabel = this.add
      .text(p.x, p.y - PLAYER_LABEL_OFFSET, p.name, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: PLAYER_LABEL_FONT,
        color: '#e8f0e6',
      })
      .setOrigin(0.5, 1)
      .setDepth(11);
    this.syncPlayerScreenScale();
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.mapData?.tileStore?.syncToView(this.cameras.main.worldView);
    this.emitTileInfo(true);
  }

  private spawnRemote(p: PlayerState) {
    if (this.remotes.has(p.id)) return;
    const body = this.makeEmojiMarker(p.x, p.y, p.emoji, 9);
    const label = this.add
      .text(p.x, p.y - PLAYER_LABEL_OFFSET, p.name, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: PLAYER_LABEL_FONT,
        color: '#c4a574',
      })
      .setOrigin(0.5, 1)
      .setDepth(9);
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
  }

  sendChat(text: string) {
    this.socket?.emit('chat', text);
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

  update(_t: number, dt: number) {
    // Cap dt so a tab-return spike can't shove you with a stale held key.
    const frameDt = Math.min(dt, 50);
    if (!document.hidden) GameClock.tick(frameDt);

    this.sunlightFx?.setTimeOfDay(GameClock.hour);
    this.sunlightFx?.setDayOfYear(GameCalendar.dayOfYear);
    this.waterFx?.setTime(this.time.now);
    this.cloudsFx?.setTime(this.time.now);

    if (!this.mapData) return;

    this.mapData.tileStore?.syncToView(this.cameras.main.worldView);

    if (!this.player) return;

    let vx = 0;
    let vy = 0;
    if (!this.chatFocused && !document.hidden) {
      if (this.cursors?.left.isDown || this.wasd?.A.isDown) vx -= 1;
      if (this.cursors?.right.isDown || this.wasd?.D.isDown) vx += 1;
      if (this.cursors?.up.isDown || this.wasd?.W.isDown) vy -= 1;
      if (this.cursors?.down.isDown || this.wasd?.S.isDown) vy += 1;
    }

    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      const len = Math.hypot(vx, vy) || 1;
      vx /= len;
      vy /= len;
      if (Math.abs(vx) > Math.abs(vy)) this.facing = vx < 0 ? 'left' : 'right';
      else this.facing = vy < 0 ? 'up' : 'down';

      const speedMul = this.shiftKey?.isDown ? 0.1 : this.ctrlKey?.isDown ? 10 : 1;
      const step = (this.speed * speedMul * frameDt) / 1000;

      const { width, height } = this.mapData;
      const cur = this.sampleAt(this.player.x, this.player.y);
      // Rivers / inland freshwater: 20× slower. Ocean is blocked below.
      const terrainMul = cur.landcoverCode === LANDCOVER.FRESHWATER ? 0.05 : 1;

      // Steep uphill (rise ahead ≥ threshold): 5× slower while climbing.
      let climbMul = 1;
      const elevHere = cur.elevationM;
      const elevAhead = this.sampleAt(this.player.x + vx, this.player.y + vy).elevationM;
      if (elevHere != null && elevAhead != null && elevAhead - elevHere >= 25) {
        climbMul = 0.2;
      }

      const tryX = this.player.x + vx * step * terrainMul * climbMul;
      const tryY = this.player.y + vy * step * terrainMul * climbMul;
      const nx = Phaser.Math.Clamp(tryX, 4, width - 4);
      const ny = Phaser.Math.Clamp(tryY, 4, height - 4);

      /** Impassable: ocean, missing tile, or walkable=0. */
      const blockedAt = (x: number, y: number) => {
        const s = this.sampleAt(x, y);
        if (s.land === null) {
          // Streaming miss → block. Full-map without mask uses cover/walkable.
          if (this.mapData!.tileStore) return true;
          const cover = s.landcoverCode;
          if (cover === LANDCOVER.WATER) return true;
          const { width: w, height: h } = this.mapData!;
          const ix = Phaser.Math.Clamp(Math.floor(x), 0, w - 1);
          const iy = Phaser.Math.Clamp(Math.floor(y), 0, h - 1);
          return this.mapData!.walkable?.[iy * w + ix] === 0;
        }
        return s.land === false;
      };

      // Ocean / unloaded: impassable. Slide along coast if only one axis is blocked.
      if (!blockedAt(nx, ny)) {
        this.player.x = nx;
        this.player.y = ny;
      } else {
        if (!blockedAt(nx, this.player.y)) this.player.x = nx;
        if (!blockedAt(this.player.x, ny)) this.player.y = ny;
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
