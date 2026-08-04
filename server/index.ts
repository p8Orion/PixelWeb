import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_PLAYER_EMOJI,
  DEFAULT_STARTING_AREA,
  PLAYER_COLORS,
  areaSpawn,
  isPlayerEmoji,
  isStartingAreaId,
  type PlayerState,
  type StartingAreaId,
} from '../shared/types.js';
import {
  roomPublicMeta,
  roomStateFromGameRoom,
  type MapPatchEvent,
  type WelcomePayload,
} from '../shared/rooms.js';
import {
  minuteBucket,
  nudgeRoomSimCalendarDays,
  nudgeRoomSimHours,
  tickRoomSimTime,
  timeSyncFromSim,
} from '../shared/time.js';
import { MAP_TILE_SIZE } from '../shared/maps/tiles.js';
import { createMapsRouter } from './maps/routes.js';
import { ensureAllReadyWorlds, getActiveWorld, getWorld } from './maps/store.js';
import { createRoomsRouter } from './rooms/routes.js';
import { roomStore } from './rooms/store.js';
import { floodRect, setSeaLevelOffset } from './rooms/overlay.js';
import { mergedTileCache } from './rooms/tileCache.js';

const PORT = Number(process.env.PORT) || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const ROOM_TIME_TICK_MS = 200;

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/maps', createMapsRouter());
app.use('/api/rooms', createRoomsRouter());
app.use(express.static(distDir));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e7,
});

let colorIndex = 0;

function emitMapPatch(roomId: string, event: MapPatchEvent) {
  io.to(roomId).emit('map:patch', event);
}

function emitTimeSync(roomId: string) {
  const room = roomStore.getById(roomId);
  if (!room) return;
  io.to(roomId).emit('time:sync', timeSyncFromSim(room.simTime));
}

/** Advance sim clocks for rooms with players; broadcast when the displayed minute changes. */
function tickAllRoomClocks() {
  const now = Date.now();
  for (const room of roomStore.list()) {
    if (Object.keys(room.players).length === 0) continue;
    const prevMin = minuteBucket(room.simTime.hour);
    const dt = now - room.simTime.updatedAt;
    tickRoomSimTime(room.simTime, dt, now);
    roomStore.save(room);
    if (minuteBucket(room.simTime.hour) !== prevMin) {
      emitTimeSync(room.id);
    }
  }
}

io.on('connection', (socket) => {
  const roomId = String(socket.handshake.query.roomId || '');
  const room = roomId ? roomStore.getById(roomId) : null;
  if (!room) {
    socket.emit('room:reject', { message: 'Sala inválida o inexistente' });
    socket.disconnect(true);
    return;
  }

  const name =
    (socket.handshake.query.name as string)?.slice(0, 16) || `P${socket.id.slice(0, 4)}`;
  const startingAreaRaw = String(socket.handshake.query.startingArea || DEFAULT_STARTING_AREA);
  const startingArea: StartingAreaId = isStartingAreaId(startingAreaRaw)
    ? startingAreaRaw
    : DEFAULT_STARTING_AREA;
  const emojiRaw = String(socket.handshake.query.emoji || DEFAULT_PLAYER_EMOJI);
  const emoji = isPlayerEmoji(emojiRaw) ? emojiRaw : DEFAULT_PLAYER_EMOJI;

  // Catch up sim clock before spawning so welcome has fresh time.
  {
    const now = Date.now();
    tickRoomSimTime(room.simTime, now - room.simTime.updatedAt, now);
  }

  const { mapWidth, mapHeight } = room.config;
  const spawn = areaSpawn(startingArea, mapWidth, mapHeight);
  const player: PlayerState = {
    id: socket.id,
    name,
    x: spawn.x,
    y: spawn.y,
    color: PLAYER_COLORS[colorIndex++ % PLAYER_COLORS.length],
    facing: 'down',
    emoji,
  };

  room.players[socket.id] = player;
  if (!room.hostId) room.hostId = socket.id;
  roomStore.save(room);
  socket.join(roomId);
  socket.data.roomId = roomId;

  const welcome: WelcomePayload = {
    you: player,
    room: roomStateFromGameRoom(room),
    config: room.config,
    joinCode: room.joinCode,
    seaLevelOffsetM: room.overlay.seaLevelOffsetM,
    time: timeSyncFromSim(room.simTime),
  };
  socket.emit('welcome', welcome);
  socket.to(roomId).emit('player:join', player);

  socket.on('player:move', (data: { x: number; y: number; facing: PlayerState['facing'] }) => {
    const r = roomStore.getById(roomId);
    if (!r) return;
    const p = r.players[socket.id];
    if (!p) return;
    p.x = Math.max(0, Math.min(r.config.mapWidth, data.x));
    p.y = Math.max(0, Math.min(r.config.mapHeight, data.y));
    p.facing = data.facing;
    socket.to(roomId).emit('player:move', {
      id: socket.id,
      x: p.x,
      y: p.y,
      facing: p.facing,
    });
  });

  socket.on('chat', (msg: string) => {
    const text = String(msg || '').slice(0, 120).trim();
    if (!text) return;
    const r = roomStore.getById(roomId);
    const p = r?.players[socket.id];
    if (!p) return;
    io.to(roomId).emit('chat', { id: socket.id, name: p.name, text });
  });

  /** Anyone in the room can nudge shared time (server applies + broadcasts). */
  socket.on(
    'time:nudge',
    (data: { hours?: number; days?: number }) => {
      const r = roomStore.getById(roomId);
      if (!r) return;
      const hours = Number(data?.hours) || 0;
      const days = Number(data?.days) || 0;
      if (hours === 0 && days === 0) return;
      // Clamp abuse: max ±48h / ±60d per event
      const dh = Math.max(-48, Math.min(48, hours));
      const dd = Math.max(-60, Math.min(60, days));
      const now = Date.now();
      tickRoomSimTime(r.simTime, now - r.simTime.updatedAt, now);
      if (dh !== 0) nudgeRoomSimHours(r.simTime, dh, now);
      if (dd !== 0) nudgeRoomSimCalendarDays(r.simTime, dd, now);
      roomStore.save(r);
      emitTimeSync(roomId);
    },
  );

  /** Demo deltas: sea level or local flood around a point. */
  socket.on(
    'map:demo',
    (
      data:
        | { kind: 'seaLevel'; meters: number }
        | { kind: 'flood'; x: number; y: number; halfSize?: number },
    ) => {
      const r = roomStore.getById(roomId);
      if (!r) return;
      const world = getWorld(r.config.worldId);
      const tileSize = world?.meta.tileSize ?? MAP_TILE_SIZE;

      if (data?.kind === 'seaLevel') {
        setSeaLevelOffset(r.overlay, Number(data.meters) || 0);
        roomStore.save(r);
        mergedTileCache.invalidate(roomId);
        emitMapPatch(roomId, {
          tiles: [],
          seaLevelOffsetM: r.overlay.seaLevelOffsetM,
        });
        io.to(roomId).emit('chat', {
          id: 'system',
          name: 'sistema',
          text: `Nivel del mar → ${r.overlay.seaLevelOffsetM} m (overlay de sala)`,
        });
        return;
      }

      if (data?.kind === 'flood') {
        const half = Math.max(8, Math.min(256, Number(data.halfSize) || 48));
        const x = Number(data.x);
        const y = Number(data.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const touched = floodRect(
          r.overlay,
          r.config.mapWidth,
          r.config.mapHeight,
          x - half,
          y - half,
          x + half,
          y + half,
          tileSize,
        );
        roomStore.save(r);
        mergedTileCache.invalidate(roomId, touched);
        emitMapPatch(roomId, { tiles: touched });
        io.to(roomId).emit('chat', {
          id: 'system',
          name: 'sistema',
          text: `Inundación local ±${half}px (${touched.length} tiles)`,
        });
      }
    },
  );

  socket.on('latency:ping', (clientTime: number) => {
    socket.emit('latency:pong', clientTime);
  });

  socket.on('disconnect', () => {
    const r = roomStore.getById(roomId);
    if (!r) return;
    delete r.players[socket.id];
    if (r.hostId === socket.id) {
      const next = Object.keys(r.players)[0] ?? null;
      r.hostId = next;
    }
    roomStore.save(r);
    socket.to(roomId).emit('player:leave', socket.id);
    if (roomStore.deleteIfEmpty(roomId)) {
      mergedTileCache.invalidate(roomId);
    }
  });
});

app.get('/health', (_req, res) => {
  const rooms = roomStore.list();
  const players = rooms.reduce((n, r) => n + Object.keys(r.players).length, 0);
  const world = getActiveWorld();
  res.json({
    ok: true,
    rooms: rooms.length,
    players,
    roomsMeta: rooms.map(roomPublicMeta),
    map: world
      ? { profile: world.meta.profile, width: world.meta.width, height: world.meta.height }
      : null,
  });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/socket.io') || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) res.status(404).send('Build missing — run npm run build or npm run dev');
  });
});

async function boot() {
  try {
    await ensureAllReadyWorlds(process.env.MAP_PROFILE || 'default');
  } catch (err) {
    console.warn('Maps: no ingested world yet — multiplayer ok, layers API will 503.');
    console.warn('  → npm run maps:build -- --world=default');
    console.warn('  → npm run maps:build -- --world=earth3x --force');
    console.warn(String(err));
  }

  setInterval(tickAllRoomClocks, ROOM_TIME_TICK_MS);

  httpServer.listen(PORT, () => {
    console.log(`PixelWeb server on http://localhost:${PORT}`);
  });
}

boot();
