import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_MAP,
  DEFAULT_PLAYER_EMOJI,
  DEFAULT_STARTING_AREA,
  PLAYER_COLORS,
  areaSpawn,
  isPlayerEmoji,
  isStartingAreaId,
  type PlayerState,
  type RoomState,
  type StartingAreaId,
} from '../shared/types.js';
import { createMapsRouter } from './maps/routes.js';
import { ensureAllReadyWorlds, getActiveWorld, getWorld } from './maps/store.js';

const PORT = Number(process.env.PORT) || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/maps', createMapsRouter());
app.use(express.static(distDir));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e7,
});

const room: RoomState = {
  players: {},
  mapWidth: DEFAULT_MAP.width,
  mapHeight: DEFAULT_MAP.height,
};

let colorIndex = 0;

function syncRoomMapSizeFromWorld() {
  const world = getActiveWorld();
  if (!world) return;
  room.mapWidth = world.meta.width;
  room.mapHeight = world.meta.height;
}

function randomSpawn(areaId: StartingAreaId): { x: number; y: number } {
  return areaSpawn(areaId, room.mapWidth, room.mapHeight);
}

io.on('connection', (socket) => {
  const name = (socket.handshake.query.name as string)?.slice(0, 16) || `P${socket.id.slice(0, 4)}`;
  const worldId = String(socket.handshake.query.worldId || 'default');
  const startingAreaRaw = String(socket.handshake.query.startingArea || DEFAULT_STARTING_AREA);
  const startingArea: StartingAreaId = isStartingAreaId(startingAreaRaw)
    ? startingAreaRaw
    : DEFAULT_STARTING_AREA;
  const emojiRaw = String(socket.handshake.query.emoji || DEFAULT_PLAYER_EMOJI);
  const emoji = isPlayerEmoji(emojiRaw) ? emojiRaw : DEFAULT_PLAYER_EMOJI;
  const world = getWorld(worldId);
  if (world) {
    room.mapWidth = world.meta.width;
    room.mapHeight = world.meta.height;
  }
  const spawn = randomSpawn(startingArea);
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
  socket.emit('welcome', { you: player, room });
  socket.broadcast.emit('player:join', player);

  socket.on('player:move', (data: { x: number; y: number; facing: PlayerState['facing'] }) => {
    const p = room.players[socket.id];
    if (!p) return;
    p.x = Math.max(0, Math.min(room.mapWidth, data.x));
    p.y = Math.max(0, Math.min(room.mapHeight, data.y));
    p.facing = data.facing;
    socket.broadcast.emit('player:move', {
      id: socket.id,
      x: p.x,
      y: p.y,
      facing: p.facing,
    });
  });

  socket.on('map:size', (data: { width: number; height: number }) => {
    // Align room to the map the client actually loaded (4k vs 12k, etc.)
    if (data.width > 0 && data.height > 0) {
      room.mapWidth = data.width;
      room.mapHeight = data.height;
      io.emit('map:size', { width: room.mapWidth, height: room.mapHeight });
    }
  });

  socket.on('chat', (msg: string) => {
    const text = String(msg || '').slice(0, 120).trim();
    if (!text) return;
    const p = room.players[socket.id];
    if (!p) return;
    io.emit('chat', { id: socket.id, name: p.name, text });
  });

  socket.on('latency:ping', (clientTime: number) => {
    socket.emit('latency:pong', clientTime);
  });

  socket.on('disconnect', () => {
    delete room.players[socket.id];
    socket.broadcast.emit('player:leave', socket.id);
  });
});

app.get('/health', (_req, res) => {
  const world = getActiveWorld();
  res.json({
    ok: true,
    players: Object.keys(room.players).length,
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
    syncRoomMapSizeFromWorld();
  } catch (err) {
    console.warn('Maps: no ingested world yet — multiplayer ok, layers API will 503.');
    console.warn('  → npm run maps:build -- --world=default');
    console.warn('  → npm run maps:build -- --world=earth3x --force');
    console.warn(String(err));
  }

  httpServer.listen(PORT, () => {
    console.log(`PixelWeb server on http://localhost:${PORT}`);
  });
}

boot();
