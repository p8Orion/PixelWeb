import { Router } from 'express';
import { MAP_TILE_SIZE, cropWorldTile, encodeMapTile, tileCount } from '../../shared/maps/tiles.js';
import { isProceduralWorld } from '../../shared/maps/procedural/index.js';
import { roomPublicMeta } from '../../shared/rooms.js';
import { ensureGameWorld, getWorld } from '../maps/store.js';
import { applyOverlayToTile } from './overlay.js';
import { roomStore } from './store.js';
import { mergedTileCache } from './tileCache.js';

export function createRoomsRouter(): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const worldId = String(req.body?.worldId || 'default');
      const profile = req.body?.profile ? String(req.body.profile) : undefined;
      const timeScale = {
        daySeconds: req.body?.daySeconds,
        daysPerMonth: req.body?.daysPerMonth,
        lunarQuarterDays: req.body?.lunarQuarterDays,
      };
      // Lazy-load (procedural generates here if boot skipped it).
      await ensureGameWorld(worldId, profile || process.env.MAP_PROFILE || 'default');
      const room = roomStore.create({ worldId, profile, timeScale });
      res.status(201).json({
        roomId: room.id,
        joinCode: room.joinCode,
        config: room.config,
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
      });
    } catch (err) {
      const status = (err as { status?: number }).status || 500;
      const worldId = (err as { worldId?: string }).worldId;
      const procedural = worldId ? isProceduralWorld(worldId) : false;
      res.status(status).json({
        error: err instanceof Error ? err.message : String(err),
        worldId: worldId ?? null,
        hint:
          status === 503 && worldId
            ? procedural
              ? 'Reiniciá el server — el mundo procedural se genera al arrancar'
              : `Corré npm run maps:build -- --world=${worldId} --force y reiniciá el server`
            : undefined,
      });
    }
  });

  router.get('/code/:code', (req, res) => {
    const room = roomStore.getByCode(String(req.params.code || ''));
    if (!room) {
      res.status(404).json({ error: 'Sala no encontrada' });
      return;
    }
    res.json(roomPublicMeta(room));
  });

  router.get('/:roomId', (req, res) => {
    const room = roomStore.getById(String(req.params.roomId || ''));
    if (!room) {
      res.status(404).json({ error: 'Sala no encontrada' });
      return;
    }
    res.json(roomPublicMeta(room));
  });

  router.get('/:roomId/tiles/:tx/:ty', (req, res) => {
    const roomId = String(req.params.roomId || '');
    const room = roomStore.getById(roomId);
    if (!room) {
      res.status(404).json({ error: 'Sala no encontrada' });
      return;
    }
    const world = getWorld(room.config.worldId);
    if (!world) {
      res.status(503).json({
        error: 'Mundo no listo',
        worldId: room.config.worldId,
      });
      return;
    }

    const tileSize = world.meta.tileSize ?? MAP_TILE_SIZE;
    const tx = Number(req.params.tx);
    const ty = Number(req.params.ty);
    if (!Number.isInteger(tx) || !Number.isInteger(ty) || tx < 0 || ty < 0) {
      res.status(400).json({ error: 'invalid tile coords' });
      return;
    }
    const maxTx = tileCount(world.meta.width, tileSize);
    const maxTy = tileCount(world.meta.height, tileSize);
    if (tx >= maxTx || ty >= maxTy) {
      res.status(404).json({ error: 'tile out of range' });
      return;
    }

    const cached = mergedTileCache.get(roomId, tx, ty);
    if (cached) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(cached);
      return;
    }

    const base = cropWorldTile(
      world.meta.width,
      world.meta.height,
      world.landmask,
      world.elevation,
      world.landcover,
      tx,
      ty,
      tileSize,
    );
    if (!base) {
      res.status(404).json({ error: 'empty tile' });
      return;
    }

    const merged = applyOverlayToTile(base, room.overlay);
    const body = encodeMapTile(merged);
    mergedTileCache.set(roomId, tx, ty, body);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(body);
  });

  return router;
}
