/**
 * The operator research and the demo sign-in live under `_local`, which is
 * gitignored. A checkout of the repository does not include them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function missing(path, what) {
  console.error(
    `Missing ${path}.\n${what} is kept under _local and is not part of the repository.`,
  );
  process.exit(1);
}

function readLocal(path, what) {
  if (!existsSync(path)) missing(path, what);
  const value = readFileSync(path, 'utf8').trim();
  if (!value) {
    console.error(`${path} is empty.`);
    process.exit(1);
  }
  return value;
}

export function demoPassword() {
  return readLocal(join(root, '_local', 'demo-accounts', 'password.txt'), 'The demo sign-in password');
}

export function adminEmail() {
  return readLocal(
    join(root, '_local', 'demo-accounts', 'admin-email.txt'),
    'The platform admin address',
  );
}

export async function loadOperatorResearch() {
  const path = join(root, '_local', 'operator-research', 'seed-data.mjs');
  if (!existsSync(path)) missing(path, 'The operator research the seed is built from');
  return import(pathToFileURL(path).href);
}
