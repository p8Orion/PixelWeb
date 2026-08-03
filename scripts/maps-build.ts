/**
 * Convenience: ingest then interpret for a world.
 *
 *   npm run maps:build -- --world=earth3x --force
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function runNpmScript(script: string, forwarded: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', script, '--', ...forwarded], {
      cwd: root,
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm run ${script} exited ${code}`));
    });
  });
}

async function main() {
  const worldArg = args.find((a) => a.startsWith('--world=')) || '--world=default';
  const profileArg = args.find((a) => a.startsWith('--profile=')) || '--profile=default';
  const force = args.includes('--force');
  const ingestArgs = args.filter((a) => !a.startsWith('--profile='));
  const interpretArgs = [
    worldArg,
    profileArg,
    ...(force ? ['--force'] : []),
  ];

  await runNpmScript('maps:ingest', ingestArgs);
  await runNpmScript('maps:interpret', interpretArgs);
  console.log(`\nDone. Restart the server; pick the world in the boot UI.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
