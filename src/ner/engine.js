// Runs the PII model over text of any length. Shared by the extension's
// offscreen document and the Node evaluation script; the caller supplies the
// transformers.js module so each side can configure paths and backends.

import { decodeEntities, chunkText, DEFAULT_THRESHOLDS } from './decode.js';

const MAX_TOKENS = 510;

export async function createEngine({ transformers, modelId = 'pii', dtype = 'q8' }) {
  const { AutoTokenizer, AutoModelForTokenClassification } = transformers;
  const tokenizer = await AutoTokenizer.from_pretrained(modelId);
  const model = await AutoModelForTokenClassification.from_pretrained(modelId, { dtype });
  const id2label = model.config.id2label;

  async function runChunk(text, offset, thresholds, out) {
    if (!text.trim()) return;
    const tokens = tokenizer.tokenize(text);
    if (tokens.length > MAX_TOKENS) {
      // Dense text (base64, minified code) packs more tokens per character.
      const mid = splitPoint(text);
      await runChunk(text.slice(0, mid), offset, thresholds, out);
      await runChunk(text.slice(mid), offset + mid, thresholds, out);
      return;
    }
    const enc = await tokenizer(text);
    const n = enc.input_ids.dims.at(-1);
    if (n !== tokens.length + 2) return; // tokenizer disagreement; skip rather than misalign
    const { logits } = await model(enc);
    const L = logits.dims.at(-1);
    const data = logits.data;
    const preds = [];
    for (let i = 1; i < n - 1; i++) {
      let best = 0;
      let max = -Infinity;
      for (let j = 0; j < L; j++) {
        const v = data[i * L + j];
        if (v > max) {
          max = v;
          best = j;
        }
      }
      let z = 0;
      for (let j = 0; j < L; j++) z += Math.exp(data[i * L + j] - max);
      preds.push({ label: id2label[best], score: 1 / z });
    }
    for (const e of decodeEntities(text, tokens, preds, { thresholds })) {
      out.push({ ...e, start: e.start + offset, end: e.end + offset });
    }
  }

  /**
   * @param {string} text
   * @param {{ maxChars?: number, thresholds?: object }} [opts]
   * @returns {Promise<{ spans: Array, scannedChars: number, ms: number }>}
   */
  async function detect(text, { maxChars = 50000, thresholds = DEFAULT_THRESHOLDS } = {}) {
    const t0 = performance.now();
    const scanned = text.slice(0, maxChars);
    const spans = [];
    for (const c of chunkText(scanned)) await runChunk(c.text, c.start, thresholds, spans);
    return { spans, scannedChars: scanned.length, ms: Math.round(performance.now() - t0) };
  }

  return { detect };
}

function splitPoint(text) {
  const mid = Math.floor(text.length / 2);
  for (let d = 0; d < 200 && d < mid; d++) {
    if (/\s/.test(text[mid + d])) return mid + d;
    if (/\s/.test(text[mid - d])) return mid - d;
  }
  return mid;
}
