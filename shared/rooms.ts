/** Multiplayer room config + overlay types (shared client/server). */

import type { PlayerId, PlayerState, RoomState } from './types.js';
import type { RoomSimTime, TimeSyncPayload } from './time.js';
import { createRoomSimTime } from './time.js';

export type { RoomSimTime, TimeSyncPayload, RoomTimeScale } from './time.js';

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
  /** Server-authoritative civil clock / calendar / lunar for this room. */
  simTime: RoomSimTime;
}

export interface RoomPublicMeta {
  roomId: string;
  joinCode: string;
  config: RoomConfig;
  playerCount: number;
  seaLevelOffsetM: number;
  time?: TimeSyncPayload;
}

export interface WelcomePayload {
  you: PlayerState;
  room: RoomState;
  config: RoomConfig;
  joinCode: string;
  seaLevelOffsetM: number;
  time: TimeSyncPayload;
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
    time: {
      hour: room.simTime.hour,
      dayOfYear: room.simTime.dayOfYear,
      lunarAge: room.simTime.lunarAge,
      daySeconds: room.simTime.scale.daySeconds,
      daysPerMonth: room.simTime.scale.daysPerMonth,
      lunarQuarterDays: room.simTime.scale.lunarQuarterDays,
      serverTimeMs: room.simTime.updatedAt,
    },
  };
}

export { createRoomSimTime };
