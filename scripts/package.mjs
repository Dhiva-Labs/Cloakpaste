// Production build plus the zip that goes to the Chrome Web Store and GitHub releases.
//   node scripts/package.mjs             ->  dist/pasteguard-<version>.zip
//   node scripts/package.mjs --firefox   ->  dist/pasteguard-firefox-<version>.zip (addons.mozilla.org)
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const firefox = process.argv.includes('--firefox');
execFileSync('node', [join(root, 'scripts', 'build.mjs'), ...(firefox ? ['--firefox'] : [])], { stdio: 'inherit' });
const { version } = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const zip = join(root, 'dist', `pasteguard-${firefox ? 'firefox-' : ''}${version}.zip`);
await rm(zip, { force: true });
execFileSync('zip', ['-qr9X', zip, '.'], { cwd: join(root, 'dist', firefox ? 'firefox' : 'extension') });
const sha = createHash('sha256').update(await readFile(zip)).digest('hex');
console.log(`${zip}\nsha256 ${sha}`);
