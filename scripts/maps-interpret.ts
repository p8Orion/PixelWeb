/**
 * maps:interpret — apply a game profile to a world's ingest → interpreted/
 *
 *   npm run maps:interpret
 *   npm run maps:interpret -- --world=earth3x --profile=default --force
 */

import fs from 'fs/promises';
import { getMapWorld, MAP_WORLD_DEFAULT } from '../shared/maps/worlds.js';
import {
  loadIngested,
  persistInterpreted,
  worldInterpretedDir,
} from '../server/maps/store.js';
import { interpretWorld, listProfiles } from '../server/maps/interpret/index.js';

function parseCli(argv: string[]): { profile: string; force: boolean; worldId: string } {
  let profile = process.env.MAP_PROFILE || 'default';
  let force = false;
  let worldId = process.env.MAP_WORLD || MAP_WORLD_DEFAULT.id;
  for (const a of argv) {
    if (a.startsWith('--profile=')) profile = a.slice(10);
    if (a.startsWith('--world=')) worldId = a.slice(8);
    if (a === '--force') force = true;
  }
  return { profile, force, worldId };
}

async function main() {
  const { profile, force, worldId } = parseCli(process.argv.slice(2));
  const world = getMapWorld(worldId);
  console.log(`PixelWeb maps:interpret  world=${worldId}  profile=${profile}`);
  console.log(`  hydroStrokeScale=${world.hydroStrokeScale}`);
  console.log(
    'Profiles:',
    listProfiles()
      .map((p) => `${p.id} — ${p.description}`)
      .join('\n  '),
  );

  const outMeta = `${worldInterpretedDir(worldId, profile)}/meta.json`;
  if (!force) {
    try {
      await fs.access(outMeta);
      console.log(`Already interpreted at ${outMeta}. Pass --force to redo.`);
      return;
    } catch {
      /* continue */
    }
  }

  const ingested = await loadIngested(worldId);
  const layers = interpretWorld(ingested, profile, { worldId });
  const dir = await persistInterpreted(layers, worldId);
  console.log(`\nInterpreted → ${dir}`);
  console.log(`  ${layers.meta.width}×${layers.meta.height}`);
  console.log(`  landmask: ${layers.meta.layers.landmask.meaning}`);
  console.log(`  landcover: ${layers.meta.layers.landcover.meaning}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
