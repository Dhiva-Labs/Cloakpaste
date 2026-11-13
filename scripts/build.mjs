// Builds the unpacked extension into dist/extension.
//   node scripts/build.mjs             production build
//   node scripts/build.mjs --test      also matches http://127.0.0.1 for e2e tests
//   node scripts/build.mjs --firefox   Firefox build in dist/firefox (combines with --test)
import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const test = process.argv.includes('--test');
const firefox = process.argv.includes('--firefox');
const out = join(root, 'dist', firefox ? 'firefox' : 'extension');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// transformers.js points onnxruntime-web at jsdelivr by default. The offscreen
// page overrides that with the bundled ort/ files, so the CDN is never used,
// but the Chrome Web Store flags the URL itself as remotely hosted code
// (Manifest V3). Swap the default for the packaged ort/ folder.
const ORT_CDN_DEFAULT = /`https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@\$\{[^}`]*\}\/dist\/`/g;
const localOrt = {
  name: 'local-ort',
  setup(b) {
    b.onLoad({ filter: /[\\/]@huggingface[\\/]transformers[\\/]dist[\\/][^\\/]+\.js$/ }, async (args) => ({
      contents: (await readFile(args.path, 'utf8')).replace(ORT_CDN_DEFAULT, '"/ort/"'),
      loader: 'js',
    }));
  },
};

// __FIREFOX__ picks the Firefox code paths; the Chrome bundles drop them entirely.
const common = {
  bundle: true,
  plugins: [localOrt],
  target: firefox ? 'firefox140' : 'chrome116',
  define: { __FIREFOX__: String(firefox) },
  legalComments: 'none',
  logLevel: 'warning',
  minify: !test,
};
await build({
  ...common,
  format: 'esm',
  entryPoints: {
    'src/background/service-worker': 'src/background/service-worker.js',
    'src/offscreen/offscreen': 'src/offscreen/offscreen.js',
    'src/popup/popup': 'src/popup/popup.js',
    'src/options/options': 'src/options/options.js',
  },
  outdir: out,
  absWorkingDir: root,
});
// Content scripts can't be modules.
await build({ ...common, format: 'iife', entryPoints: { 'src/content/content': 'src/content/content.js' }, outdir: out, absWorkingDir: root });

const copy = (from, to = from) => cp(join(root, from), join(out, to), { recursive: true });
for (const f of ['src/popup/popup.html', 'src/popup/popup.css', 'src/options/options.html', 'src/options/options.css', 'src/offscreen/offscreen.html', 'src/ui/theme.css', 'icons']) {
  await copy(f);
}

// Model: config + tokenizer + int8 ONNX weights.
const model = join(root, 'models', 'pii');
try {
  await stat(join(model, 'onnx', 'model_quantized.onnx'));
} catch {
  console.error('Model weights missing. Run: npm run fetch:model');
  process.exit(1);
}
for (const f of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx']) {
  await copy(join('models', 'pii', f));
}

// ONNX runtime WebAssembly (single-threaded SIMD build).
const ort = join('node_modules', 'onnxruntime-web', 'dist');
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) await copy(join(ort, f), join('ort', f));

const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (test) {
  manifest.name += ' (test)';
  manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
}
if (firefox) {
  // Firefox runs the background as an event page (it has a DOM, so the model
  // runs in an iframe there instead of an offscreen document).
  delete manifest.minimum_chrome_version;
  manifest.background = { scripts: [manifest.background.service_worker], type: 'module' };
  manifest.permissions = manifest.permissions.filter((p) => p !== 'offscreen');
  // The ID predates the Cloakpaste name and stays: addons.mozilla.org IDs are permanent.
  manifest.browser_specific_settings = {
    gecko: { id: 'pasteguard@dhiva-labs', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } },
  };
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
// Notices for the bundled model and runtime (Apache-2.0 asks for the licence text).
await copy('THIRD_PARTY_NOTICES.md');
await copy('PRIVACY.md');
await copy('node_modules/@huggingface/transformers/LICENSE', 'licenses/Apache-2.0.txt');
await copy('licenses');

// Manifest V3 forbids remotely hosted code, and the store scans for CDN URLs.
// Fail the build if any packaged file still names a host that serves scripts
// or WebAssembly.
const REMOTE_CODE = /https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh|esm\.run|cdn\.skypack\.dev|ga\.jspm\.io)\b[^\s"'`)]*/;
const hits = [];
for (const f of await readdir(out, { recursive: true })) {
  if (!/\.(?:m?js|html|json)$/.test(f)) continue;
  const m = (await readFile(join(out, f), 'utf8')).match(REMOTE_CODE);
  if (m) hits.push(`  ${relative(root, join(out, f))}: ${m[0]}`);
}
if (hits.length) {
  console.error(`Remote code URL in the build (not allowed in Manifest V3):\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`Built ${test ? 'test ' : ''}${firefox ? 'Firefox ' : ''}extension -> ${out}`);
