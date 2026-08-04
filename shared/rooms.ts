/** Multiplayer room config + overlay types (shared client/server). */

import type { PlayerId, PlayerState, RoomState } from './types.js';

export interface RoomConfig {
  worldId: string;
  profile: string;
  mapWidth: number;
  mapHeight: number;
}

/** Sparse per-cell overrides inside one logical tile (local index 0..tw*th-1). */
export interface TilePatch {
  landmask?: Map<number, number>;
  landcover?: Map<number, number>;
  elevDelta?: Map<number, number>;
}

export interface RoomOverlay {
  seaLevelOffsetM: number;
  tiles: Map<string, TilePatch>;
}

export interface GameRoom {
  id: string;
  joinCode: string;
  hostId: string | null;
  config: RoomConfig;
  /** Live presence — not durable. */
  players: Record<PlayerId, PlayerState>;
  createdAt: number;
  overlay: RoomOverlay;
}

export interface RoomPublicMeta {
  roomId: string;
  joinCode: string;
  config: RoomConfig;
  playerCount: number;
  seaLevelOffsetM: number;
}

export interface WelcomePayload {
  you: PlayerState;
  room: RoomState;
  config: RoomConfig;
  joinCode: string;
  seaLevelOffsetM: number;
}

export interface MapPatchEvent {
  tiles: Array<{ tx: number; ty: number }>;
  seaLevelOffsetM?: number;
}

export function emptyOverlay(): RoomOverlay {
  return { seaLevelOffsetM: 0, tiles: new Map() };
}

export function roomStateFromGameRoom(room: GameRoom): RoomState {
  return {
    players: room.players,
    mapWidth: room.config.mapWidth,
    mapHeight: room.config.mapHeight,
  };
}

export function roomPublicMeta(room: GameRoom): RoomPublicMeta {
  return {
    roomId: room.id,
    joinCode: room.joinCode,
    config: room.config,
    playerCount: Object.keys(room.players).length,
    seaLevelOffsetM: room.overlay.seaLevelOffsetM,
  };
}
