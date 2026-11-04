// Builds the unpacked extension into dist/extension.
//   node scripts/build.mjs             production build
//   node scripts/build.mjs --test      also matches http://127.0.0.1 for e2e tests
//   node scripts/build.mjs --firefox   Firefox build in dist/firefox (combines with --test)
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const test = process.argv.includes('--test');
const firefox = process.argv.includes('--firefox');
const out = join(root, 'dist', firefox ? 'firefox' : 'extension');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// __FIREFOX__ picks the Firefox code paths; the Chrome bundles drop them entirely.
const common = {
  bundle: true,
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
console.log(`Built ${test ? 'test ' : ''}${firefox ? 'Firefox ' : ''}extension -> ${out}`);
