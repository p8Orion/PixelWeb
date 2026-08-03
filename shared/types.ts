export type PlayerId = string;

export interface PlayerState {
  id: PlayerId;
  name: string;
  x: number;
  y: number;
  color: number;
  facing: 'up' | 'down' | 'left' | 'right';
  /** Emoji avatar shown on the map (transparent bg). */
  emoji: string;
}

export interface RoomState {
  players: Record<PlayerId, PlayerState>;
  mapWidth: number;
  mapHeight: number;
}

export interface MapSettings {
  width: number;
  height: number;
  pixelScale: number;
  palette: 'earth' | 'retro' | 'mono';
}

export const DEFAULT_MAP: MapSettings = {
  width: 4096,
  height: 2048,
  pixelScale: 1,
  palette: 'earth',
};

export const PLAYER_COLORS = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xff6b9d,
];

/** Pickable explorer avatars (single emoji graphemes). */
export const PLAYER_EMOJIS = [
  '🧭',
  '🥾',
  '🏕️',
  '🗺️',
  '🏔️',
  '🧙',
  '🧑‍🚀',
  '🦊',
  '🐺',
  '🐻',
  '🐼',
  '🐯',
  '🦁',
  '🐸',
  '🐵',
  '🦄',
  '🦓',
  '🦌',
  '🐰',
  '🐻‍❄️',
  '🦦',
  '🦥',
  '🦘',
  '🦙',
  '🦒',
  '🐘',
  '🦏',
  '🐪',
  '🐱',
  '🐶',
  '🦅',
  '🦉',
  '🦜',
  '🐧',
  '🦩',
  '🦇',
  '🦋',
  '🐢',
  '🦎',
  '🐍',
  '🐊',
  '🐬',
  '🦈',
  '🐙',
  '🦀',
] as const;

export type PlayerEmoji = (typeof PLAYER_EMOJIS)[number];

export const DEFAULT_PLAYER_EMOJI: PlayerEmoji = '🧭';

export function isPlayerEmoji(value: string): value is PlayerEmoji {
  return (PLAYER_EMOJIS as readonly string[]).includes(value);
}

export type StartingAreaId = 'argentina' | 'eeuu' | 'europa' | 'congo' | 'himalaya';

export interface LonLatBounds {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

/** Default spawn focus: inland Buenos Aires Province (WGS84). */
export const DEFAULT_SPAWN_LON_LAT = { lon: -60.2, lat: -36.4 } as const;

/**
 * Interior of Buenos Aires Province (mainland pampa).
 * Keeps spawns west of AMBA / Río de la Plata and inside provincial bounds.
 */
export const BSAS_INTERIOR_BOUNDS: LonLatBounds = {
  lonMin: -62.0,
  lonMax: -58.6,
  latMin: -38.6,
  latMax: -34.3,
};

/** Starting areas → inland land boxes (WGS84) for random spawn. */
export const STARTING_AREAS: Record<StartingAreaId, LonLatBounds> = {
  argentina: BSAS_INTERIOR_BOUNDS,
  /** Midwest / Great Plains — continental land. */
  eeuu: { lonMin: -100.0, lonMax: -90.0, latMin: 35.0, latMax: 43.0 },
  /** Central Europe (France–Germany corridor). */
  europa: { lonMin: 5.0, lonMax: 15.0, latMin: 45.0, latMax: 52.0 },
  /** Congo Basin interior. */
  congo: { lonMin: 15.0, lonMax: 25.0, latMin: -5.0, latMax: 5.0 },
  /** Nepal / Himalayan foothills. */
  himalaya: { lonMin: 80.0, lonMax: 88.0, latMin: 27.0, latMax: 30.5 },
};

export const DEFAULT_STARTING_AREA: StartingAreaId = 'argentina';

/** Camera zoom when entering the world (regional Argentina view). */
export const DEFAULT_CAMERA_ZOOM = 8;

export function lonLatToWorldPx(
  lon: number,
  lat: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  const x = ((lon + 180) / 360) * mapWidth;
  const y = ((90 - lat) / 180) * mapHeight;
  return { x, y };
}

export function isStartingAreaId(value: string): value is StartingAreaId {
  return value in STARTING_AREAS;
}

/** Spawn inside the chosen starting area bounds. */
export function areaSpawn(
  areaId: StartingAreaId,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  const { lonMin, lonMax, latMin, latMax } = STARTING_AREAS[areaId];
  const lon = lonMin + Math.random() * (lonMax - lonMin);
  const lat = latMin + Math.random() * (latMax - latMin);
  const { x, y } = lonLatToWorldPx(lon, lat, mapWidth, mapHeight);
  return {
    x: Math.max(4, Math.min(mapWidth - 4, x)),
    y: Math.max(4, Math.min(mapHeight - 4, y)),
  };
}

/** Always spawn inside Buenos Aires Province interior. */
export function argentinaSpawn(
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  return areaSpawn('argentina', mapWidth, mapHeight);
}
