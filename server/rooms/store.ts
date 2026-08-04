import { randomBytes } from 'crypto';
import type { GameRoom, RoomConfig } from '../../shared/rooms.js';
import { emptyOverlay } from '../../shared/rooms.js';
import { createRoomSimTime, type RoomTimeScale } from '../../shared/time.js';
import { getWorld } from '../maps/store.js';

const JOIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LEN = 5;

export interface CreateRoomInput {
  worldId: string;
  profile?: string;
  hostId?: string | null;
  timeScale?: Partial<RoomTimeScale>;
}

export interface RoomStore {
  create(input: CreateRoomInput): GameRoom;
  getById(id: string): GameRoom | null;
  getByCode(code: string): GameRoom | null;
  save(room: GameRoom): void;
  delete(id: string): void;
  list(): GameRoom[];
  deleteIfEmpty(id: string): boolean;
}

function normalizeCode(code: string): string {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function newId(): string {
  return randomBytes(8).toString('hex');
}

function generateJoinCode(taken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    let code = '';
    const bytes = randomBytes(JOIN_CODE_LEN);
    for (let i = 0; i < JOIN_CODE_LEN; i++) {
      code += JOIN_CODE_CHARS[bytes[i]! % JOIN_CODE_CHARS.length]!;
    }
    if (!taken(code)) return code;
  }
  throw new Error('No se pudo generar join code único');
}

export class InMemoryRoomStore implements RoomStore {
  private byId = new Map<string, GameRoom>();
  private byCode = new Map<string, string>();

  create(input: CreateRoomInput): GameRoom {
    const worldId = String(input.worldId || 'default');
    const world = getWorld(worldId);
    if (!world) {
      throw Object.assign(new Error(`Mundo no listo: ${worldId}`), { status: 503, worldId });
    }
    const profile = input.profile || world.meta.profile || 'default';
    const config: RoomConfig = {
      worldId,
      profile,
      mapWidth: world.meta.width,
      mapHeight: world.meta.height,
    };
    const joinCode = generateJoinCode((c) => this.byCode.has(c));
    const room: GameRoom = {
      id: newId(),
      joinCode,
      hostId: input.hostId ?? null,
      config,
      players: {},
      createdAt: Date.now(),
      overlay: emptyOverlay(),
      simTime: createRoomSimTime(input.timeScale),
    };
    this.byId.set(room.id, room);
    this.byCode.set(joinCode, room.id);
    return room;
  }

  getById(id: string): GameRoom | null {
    return this.byId.get(id) ?? null;
  }

  getByCode(code: string): GameRoom | null {
    const id = this.byCode.get(normalizeCode(code));
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }

  save(room: GameRoom): void {
    this.byId.set(room.id, room);
    this.byCode.set(room.joinCode, room.id);
  }

  delete(id: string): void {
    const room = this.byId.get(id);
    if (!room) return;
    this.byId.delete(id);
    this.byCode.delete(room.joinCode);
  }

  list(): GameRoom[] {
    return [...this.byId.values()];
  }

  deleteIfEmpty(id: string): boolean {
    const room = this.byId.get(id);
    if (!room) return false;
    if (Object.keys(room.players).length > 0) return false;
    this.delete(id);
    return true;
  }
}

export const roomStore: RoomStore = new InMemoryRoomStore();
