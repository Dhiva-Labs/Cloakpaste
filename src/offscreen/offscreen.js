// Hosts the PII model. Lives in an offscreen document because MV3 service
// workers cannot load the ONNX runtime's WebAssembly glue. Everything is
// loaded from the extension package; remote model downloads are disabled.

import * as transformers from '@huggingface/transformers';
import { createEngine } from '../ner/engine.js';

const { env } = transformers;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');
env.useBrowserCache = false;
// The plain SIMD build (14 MB) is enough for a 4-layer BERT on CPU; the
// WebGPU-capable build would double the package for no real speed-up.
env.backends.onnx.wasm.wasmPaths = {
  mjs: chrome.runtime.getURL('ort/ort-wasm-simd-threaded.mjs'),
  wasm: chrome.runtime.getURL('ort/ort-wasm-simd-threaded.wasm'),
};
env.backends.onnx.wasm.numThreads = 1;

const IDLE_CLOSE_MS = 10 * 60 * 1000;

let enginePromise = null;
let idleTimer = null;

function engine() {
  enginePromise ||= createEngine({ transformers }).catch((err) => {
    enginePromise = null;
    throw err;
  });
  return enginePromise;
}

// Free the model's memory when nobody has pasted for a while; the service
// worker recreates this document on the next paste. In Firefox this page is
// an iframe in the background page, which can't close itself.
function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => (__FIREFOX__ ? frameElement.remove() : window.close()), IDLE_CLOSE_MS);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  touch();
  (async () => {
    const eng = await engine();
    if (msg.type === 'warm') return { ok: true };
    if (msg.type === 'ner') return eng.detect(msg.text, { maxChars: msg.maxChars });
    return { error: `unknown request ${msg.type}` };
  })().then(sendResponse, (err) => sendResponse({ error: String(err?.message || err) }));
  return true;
});
