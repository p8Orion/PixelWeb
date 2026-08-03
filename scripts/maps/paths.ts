import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const PATHS = {
  root,
  raw: path.join(root, 'data', 'raw'),
  ingested: path.join(root, 'data', 'ingested'),
  interpreted: path.join(root, 'data', 'interpreted'),
};

export function interpretedDir(profile: string): string {
  return path.join(PATHS.interpreted, profile);
}

export async function writeBin(file: string, data: Uint8Array | Int16Array): Promise<void> {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  await fs.writeFile(file, buf);
}

export async function readBin(file: string): Promise<Buffer> {
  return fs.readFile(file);
}
