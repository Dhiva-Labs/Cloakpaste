# Building the Firefox add-on from source

Notes for addons.mozilla.org reviewers. The add-on's JavaScript is bundled
and minified with esbuild, so this archive holds the source and the steps to
rebuild the exact files in `cloakpaste-firefox-<version>.zip`.

## Environment used

- Ubuntu 26.04.1 LTS, x86_64
- Node.js 24.13.0, npm 11.6.2
- `curl` and `sha256sum` (model download), Info-ZIP `zip` 3.0 (packaging only)

## Steps

```bash
npm ci                              # exact versions from package-lock.json
npm run fetch:model                 # model weights, see below
node scripts/build.mjs --firefox    # unpacked add-on in dist/firefox
```

`dist/firefox` then matches the submitted package file for file:

```bash
mkdir /tmp/cloakpaste && unzip -q cloakpaste-firefox-0.1.1.zip -d /tmp/cloakpaste
diff -r /tmp/cloakpaste dist/firefox && echo identical
```

`node scripts/package.mjs --firefox` runs the same build and zips it as
`dist/cloakpaste-firefox-<version>.zip`.

## What `npm run fetch:model` downloads

One file, the int8 ONNX weights of
[gravitee-io/bert-small-pii-detection](https://huggingface.co/gravitee-io/bert-small-pii-detection)
(Apache-2.0), from Hugging Face:

```
https://huggingface.co/gravitee-io/bert-small-pii-detection/resolve/main/model.quant.onnx
SHA-256 b227845ff4989c9f7383874b841895dfbdb9a4d7a20ceb39c3f187271894bf2a  (28,732,710 bytes)
```

`scripts/fetch-model.sh` checks the hash and saves it as
`models/pii/onnx/model_quantized.onnx`. The model's config and tokenizer
files are already in `models/pii/`. Nothing is downloaded at run time: the
add-on loads the model from its own package.

## Where each file in the package comes from

| Package path | Source |
|---|---|
| `src/*/*.js` | esbuild bundles of `src/` (`scripts/build.mjs`). `src/offscreen/offscreen.js` also bundles `@huggingface/transformers` 4.3.2 and the `onnxruntime-web` JavaScript it imports. |
| `src/**/*.html`, `src/**/*.css`, `icons/` | copied from `src/` and `icons/` |
| `ort/ort-wasm-simd-threaded.mjs`, `ort/ort-wasm-simd-threaded.wasm` | copied unchanged from `node_modules/onnxruntime-web/dist/` (`onnxruntime-web` 1.31.0-dev.20260914-8d85527a0, the version `@huggingface/transformers` 4.3.2 pins). SHA-256 `c57ca563…de9f` and `06ba0577…df9e3`. |
| `models/pii/*` | `models/pii/` (see above) |
| `manifest.json` | `manifest.json`, adapted for Firefox by `scripts/build.mjs` |
| `THIRD_PARTY_NOTICES.md`, `PRIVACY.md`, `licenses/` | copied; `licenses/Apache-2.0.txt` is `node_modules/@huggingface/transformers/LICENSE` |

## Notes for review

- **`'wasm-unsafe-eval'`** in the CSP is for ONNX Runtime's WebAssembly, which
  runs the model. There is no `'unsafe-eval'`.
- **`Function` constructor** (web-ext lint `DANGEROUS_EVAL`,
  `src/offscreen/offscreen.js`): part of the Emscripten glue that
  `onnxruntime-web` embeds in its bundle. The add-on never reaches it: it
  points the runtime at the packaged `ort/ort-wasm-simd-threaded.mjs`
  instead, and the CSP would block it anyway.
- **Dynamic `import()`** (`UNSAFE_VAR_ASSIGNMENT`, same file): `onnxruntime-web`
  importing that same `ort/ort-wasm-simd-threaded.mjs`, by a
  `runtime.getURL()` address set in `src/offscreen/offscreen.js`.
- No network requests, accounts, analytics or remote code. Hence
  `data_collection_permissions: none`.

## How the Firefox build differs from Chrome

`scripts/build.mjs --firefox` sets `__FIREFOX__` to `true`; the Chrome build
sets it to `false` and drops those branches.

- **Model host.** Chrome runs the model in an offscreen document. Firefox has
  no offscreen API, so the same page (`src/offscreen/offscreen.html`) runs in
  an iframe inside the background page and gets the same runtime messages.
- **Placeholder vault.** Content scripts can't read `storage.session` in
  Firefox, so they ask the background for their own site's vault
  (`pg:vault:get`, answered only for the sender's origin) and are told when it
  changes.
- **Added sites.** Firefox match patterns can't carry a port, so a site added
  with "Protect this site" covers its host on any port. The site is also
  registered from `permissions.onAdded`, in case Firefox closes the popup when
  the permission prompt opens.
- **Rich-editor paste.** Firefox ignores `clipboardData` in a synthetic
  `ClipboardEvent`'s init and hides data a content script sets from the page,
  so `src/content/editing.js` writes the (already redacted) text through
  `event.wrappedJSObject.clipboardData`. That is its only use of
  `wrappedJSObject`.
- **Manifest.** Background `scripts` instead of `service_worker`, no
  `offscreen` permission, and `browser_specific_settings.gecko`.
