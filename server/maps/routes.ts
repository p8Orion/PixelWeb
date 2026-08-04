import { Router } from 'express';
import {
  previewRgbForCell,
  type GameWorldLayers,
} from '../../shared/maps/game.js';
import {
  generateProceduralLayers,
  generateWorldFromDef,
  isProceduralWorld,
  type ProceduralParams,
} from '../../shared/maps/procedural/index.js';
import { MAP_TILE_SIZE, cropWorldTile, encodeMapTile, tileCount } from '../../shared/maps/tiles.js';
import { getMapWorld, listMapWorlds } from '../../shared/maps/worlds.js';
import {
  ensureGameWorld,
  getActiveWorld,
  getWorld,
  loadIngested,
  persistInterpreted,
  setWorld,
  worldAvailability,
} from './store.js';
import { interpretWorld, listProfiles } from './interpret/index.js';

function sendBin(
  res: import('express').Response,
  data: Uint8Array | Int16Array,
) {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(buf);
}

function requireWorld(
  res: import('express').Response,
  worldId?: string,
): GameWorldLayers | null {
  const world = worldId ? getWorld(worldId) : getActiveWorld();
  if (!world) {
    res.status(503).json({
      error: 'Mapa no listo',
      worldId: worldId ?? null,
      hint: worldId
        ? `Corré npm run maps:build -- --world=${worldId} --force y reiniciá el server`
        : 'Corré npm run maps:ingest y reiniciá el server',
    });
    return null;
  }
  return world;
}

function metaWithTiles(world: GameWorldLayers) {
  return {
    ...world.meta,
    tileSize: world.meta.tileSize ?? MAP_TILE_SIZE,
  };
}

function mountWorldRoutes(
  router: Router,
  prefix: string,
  resolveId: (req: import('express').Request) => string,
) {
  router.get(`${prefix}/meta`, (req, res) => {
    const world = requireWorld(res, resolveId(req));
    if (!world) return;
    res.json(metaWithTiles(world));
  });

  router.get(`${prefix}/tiles/:tx/:ty`, (req, res) => {
    const world = requireWorld(res, resolveId(req));
    if (!world) return;
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
    const tile = cropWorldTile(
      world.meta.width,
      world.meta.height,
      world.landmask,
      world.elevation,
      world.landcover,
      tx,
      ty,
      tileSize,
    );
    if (!tile) {
      res.status(404).json({ error: 'empty tile' });
      return;
    }
    const body = encodeMapTile(tile);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(body);
  });

  router.get(`${prefix}/landmask.bin`, (req, res) => {
    const world = requireWorld(res, resolveId(req));
    if (!world) return;
    sendBin(res, world.landmask);
  });

  router.get(`${prefix}/elevation.bin`, (req, res) => {
    const world = requireWorld(res, resolveId(req));
    if (!world) return;
    sendBin(res, world.elevation);
  });

  router.get(`${prefix}/landcover.bin`, (req, res) => {
    const world = requireWorld(res, resolveId(req));
    if (!world) return;
    sendBin(res, world.landcover);
  });

  router.get(`${prefix}/preview.png`, async (req, res) => {
    const world = requireWorld(res, resolveId(req));
    if (!world) return;
    try {
      const sharp = (await import('sharp')).default;
      const { width, height } = world.meta;
      const rgba = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const [r, g, b] = previewRgbForCell(
          world.landcover[i],
          world.elevation[i],
          world.landmask[i] === 1,
        );
        const o = i * 4;
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = 255;
      }
      const png = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
      res.setHeader('Content-Type', 'image/png');
      res.send(png);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'preview failed' });
    }
  });

  router.post(`${prefix}/reinterpret`, async (req, res) => {
    try {
      const worldId = resolveId(req);
      const def = getMapWorld(worldId);
      if (isProceduralWorld(def)) {
        const layers = await generateWorldFromDef(def, { profile: 'procedural' });
        setWorld(worldId, layers);
        res.json({ ok: true, meta: metaWithTiles(layers) });
        return;
      }
      const profile = String(req.body?.profile || process.env.MAP_PROFILE || 'default');
      const ingested = await loadIngested(worldId);
      const layers = interpretWorld(ingested, profile, { worldId });
      await persistInterpreted(layers, worldId);
      setWorld(worldId, layers);
      res.json({ ok: true, meta: metaWithTiles(layers) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}

export function createMapsRouter(): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    const worlds = await worldAvailability();
    const active = getActiveWorld();
    res.json({
      ok: worlds.some((w) => w.ready),
      activeWorldId: active?.meta.worldId ?? null,
      profile: active?.meta.profile ?? null,
      width: active?.meta.width ?? null,
      height: active?.meta.height ?? null,
      worlds,
      profiles: listProfiles().map((p) => ({ id: p.id, description: p.description })),
      catalog: listMapWorlds().map((w) => ({
        id: w.id,
        label: w.label,
        hint: w.hint,
        width: w.width,
        height: w.height,
      })),
    });
  });

  router.get('/worlds', async (_req, res) => {
    const worlds = await worldAvailability();
    res.json({ worlds });
  });

  /** Lab → server: regenerate procedural world from params and cache it. */
  router.post('/worlds/procedural/apply', async (req, res) => {
    try {
      const raw = req.body?.params as ProceduralParams | undefined;
      const def = getMapWorld('procedural');
      const layers = await generateProceduralLayers({
        worldId: 'procedural',
        width: raw?.width ?? def.width,
        height: raw?.height ?? def.height,
        seed: raw?.seed ?? 42,
        profile: 'procedural',
        params: raw,
      });
      setWorld('procedural', layers);
      try {
        await persistInterpreted(layers, 'procedural');
      } catch (err) {
        console.warn(`Maps: persist procedural apply failed — ${String(err)}`);
      }
      console.log(
        `Maps: applied procedural from lab ${layers.meta.width}×${layers.meta.height} seed=${raw?.seed ?? 42}`,
      );
      res.json({ ok: true, meta: metaWithTiles(layers) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  mountWorldRoutes(router, '/worlds/:worldId', (req) => String(req.params.worldId));
  mountWorldRoutes(router, '/world', () => 'default');

  router.post('/worlds/:worldId/ensure', async (req, res) => {
    try {
      const worldId = String(req.params.worldId);
      const profile = String(req.body?.profile || process.env.MAP_PROFILE || 'default');
      const layers = await ensureGameWorld(worldId, profile);
      res.json({ ok: true, meta: metaWithTiles(layers) });
    } catch (err) {
      res.status(503).json({ error: String(err) });
    }
  });

  return router;
}
