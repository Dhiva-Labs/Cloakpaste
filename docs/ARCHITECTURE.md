# Architecture

```
src/
  core/          pure logic, no browser APIs; unit-tested in Node
    types.js       kinds of data, placeholder prefixes, overlap priorities
    checksums.js   Luhn, mod-97, Verhoeff, IP validation, entropy
    detectors.js   pattern detectors and custom terms
    vault.js       placeholder <-> value map with restore and known-value search
    redact.js      merge spans, propagate mentions, apply placeholders
    settings.js    defaults and the built-in site list
  ner/
    decode.js      WordPiece-to-character alignment, BIO decoding, cleanup, chunking
    engine.js      runs the model over text of any length (shared by Node and the extension)
  background/      service worker: settings, per-site vaults, offscreen lifecycle, stats
  offscreen/       hosts transformers.js and the ONNX runtime (WASM)
  content/         paste interception, editor insertion, toast and tooltip, reply highlighting
  popup/           per-site switch, hidden items, "Protect this site"
  options/         settings and the playground
```

## A paste, step by step

1. `content.js` catches the `paste` event in the capture phase on `window`,
   before the page's own handlers run. Pastes that contain files, or that are
   shorter than 3 characters, pass through untouched.
2. It calls `preventDefault()` straight away, because scanning is async, and
   records the selection.
3. The service worker runs the model in the offscreen document (if enabled)
   and the pattern detectors, then searches for values already in this site's
   vault. `mergeSpans` resolves overlaps by type priority, then length, then
   source.
4. Placeholders come from the site's vault, so the same value always gets the
   same placeholder. The vault is saved to `chrome.storage.session`.
5. The content script restores the selection and inserts the text:
   - Textareas and inputs get `execCommand('insertText')`, which keeps undo
     working and fires React's input events.
   - Rich editors get a synthetic `paste` event carrying a `DataTransfer`.
     ProseMirror, Lexical and Quill read text from it the same way they read a
     real paste.
   - If nothing was found, the original HTML is passed along too, so
     formatting survives.
6. A toast summarises what was hidden. **Paste original** re-selects the
   inserted text and replaces it. In rich editors this extends the selection
   backwards by grapheme count, then waits a tick so the editor can sync its
   own selection state.

## Why an offscreen document

MV3 service workers can't use dynamic `import()`, and the ONNX runtime loads
its WebAssembly glue that way. The offscreen document is an ordinary
extension page, so it can. It's created on the first paste or focus, keeps
the model warm, and closes itself after 10 idle minutes. Only the plain SIMD
WebAssembly build is shipped (14 MB). The WebGPU build would double the
package size with no gain for a 4-layer model.

## Firefox

The same source builds for Firefox (`scripts/build.mjs --firefox`, which sets
`__FIREFOX__`). Firefox has no offscreen documents, but its background page
has a DOM, so the offscreen page runs there in an iframe and gets the same
messages. The background page is suspended after 30 idle seconds, which
unloads the model; the next paste loads it again (about 0.7 s on a laptop).
Content scripts can't read session storage in Firefox, so they ask
the background for their site's vault and are told when it changes. See
[BUILD_FIREFOX.md](BUILD_FIREFOX.md).

## Privacy boundaries

- No host permissions beyond the built-in chat sites. Extra sites are
  requested one origin at a time.
- No network access. Model files and the WebAssembly runtime load from the
  extension package with `allowRemoteModels = false`.
- Vaults live in session storage, which is in memory and cleared when the
  browser closes. They're readable by PasteGuard's own contexts only.
- Originals are never written into the page by default. Reply highlighting
  uses `CSS.highlights` ranges, and the tooltip lives in a closed shadow root.
