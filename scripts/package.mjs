// Production build plus the zip that goes to the Chrome Web Store and GitHub releases.
//   node scripts/package.mjs   ->  dist/pasteguard-<version>.zip
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('node', [join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
const { version } = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const zip = join(root, 'dist', `pasteguard-${version}.zip`);
await rm(zip, { force: true });
execFileSync('zip', ['-qr9X', zip, '.'], { cwd: join(root, 'dist', 'extension') });
const sha = createHash('sha256').update(await readFile(zip)).digest('hex');
console.log(`${zip}\nsha256 ${sha}`);
