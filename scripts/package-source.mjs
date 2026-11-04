// Source archive for addons.mozilla.org review (the add-on's bundles are
// minified). Takes the working tree as git sees it, committed or not, so
// .gitignore keeps out node_modules, dist and the downloaded model weights.
// Build steps for reviewers: docs/BUILD_FIREFOX.md.
//   node scripts/package-source.mjs   ->  dist/pasteguard-source-<version>.zip
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const zip = join(root, 'dist', `pasteguard-source-${version}.zip`);

// A throwaway index, so the real one (and anything staged) is left alone.
const tmp = await mkdtemp(join(tmpdir(), 'pasteguard-src-'));
const git = (...args) =>
  execFileSync('git', args, { cwd: root, env: { ...process.env, GIT_INDEX_FILE: join(tmp, 'index') } })
    .toString()
    .trim();
try {
  git('add', '--all', '.');
  const tree = git('write-tree');
  await mkdir(dirname(zip), { recursive: true });
  await rm(zip, { force: true });
  // Store listing images aren't part of the build.
  git('archive', '--format=zip', '-9', '-o', zip, tree, '--', '.', ':!store-assets');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
const sha = createHash('sha256').update(await readFile(zip)).digest('hex');
console.log(`${zip}\nsha256 ${sha}`);
