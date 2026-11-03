// Measures the name/place model on tests/eval/ner-cases.json and sweeps the
// confidence thresholds. Prints precision/recall per type, which is how the
// defaults in src/ner/decode.js were chosen.
//
//   node scripts/eval-ner.mjs [--json out.json]

import * as transformers from '@huggingface/transformers';
import { readFile, writeFile } from 'node:fs/promises';
import { createEngine } from '../src/ner/engine.js';
import { DEFAULT_THRESHOLDS } from '../src/ner/decode.js';

transformers.env.allowRemoteModels = false;
transformers.env.localModelPath = new URL('../models/', import.meta.url).pathname;

const cases = JSON.parse(await readFile(new URL('../tests/eval/ner-cases.json', import.meta.url), 'utf8'));
const engine = await createEngine({ transformers });
const TYPES = ['PERSON', 'LOCATION'];

// Run once with no threshold, keep scores, then sweep offline.
const runs = [];
for (const c of cases) {
  const { spans } = await engine.detect(c.text, { thresholds: { default: 0 } });
  runs.push({ c, spans: spans.filter((s) => TYPES.includes(s.type)).map((s) => ({ ...s, value: c.text.slice(s.start, s.end) })) });
}

// A finding counts if it overlaps the expected value's position.
function score(type, threshold) {
  let tp = 0, fp = 0, fn = 0;
  const misses = [], extras = [];
  for (const { c, spans } of runs) {
    const expected = (c[type] || []).map((v) => {
      const start = c.text.indexOf(v);
      return { v, start, end: start + v.length, hit: false };
    });
    for (const s of spans.filter((s) => s.type === type && s.score >= threshold)) {
      const e = expected.find((e) => s.start < e.end && e.start < s.end);
      if (e) {
        if (!e.hit) tp++;
        e.hit = true;
      } else {
        fp++;
        extras.push(`${s.value} (${s.score.toFixed(2)})`);
      }
    }
    for (const e of expected) if (!e.hit) {
      fn++;
      misses.push(e.v);
    }
  }
  const p = tp / (tp + fp || 1), r = tp / (tp + fn || 1);
  return { threshold, tp, fp, fn, precision: p, recall: r, f1: (2 * p * r) / (p + r || 1), misses, extras };
}

const report = {};
for (const type of TYPES) {
  console.log(`\n${type}  (${runs.reduce((n, { c }) => n + (c[type]?.length || 0), 0)} expected)`);
  console.log('  thr   prec   recall  f1     fp  fn');
  const rows = [];
  for (let t = 0.3; t <= 0.91; t += 0.05) {
    const s = score(type, Math.round(t * 100) / 100);
    rows.push(s);
    const mark = Math.abs(s.threshold - DEFAULT_THRESHOLDS[type]) < 1e-9 ? '  <- default' : '';
    console.log(`  ${s.threshold.toFixed(2)}  ${s.precision.toFixed(3)}  ${s.recall.toFixed(3)}   ${s.f1.toFixed(3)}  ${String(s.fp).padStart(2)}  ${String(s.fn).padStart(2)}${mark}`);
  }
  const cur = score(type, DEFAULT_THRESHOLDS[type]);
  console.log(`  at default ${DEFAULT_THRESHOLDS[type]}: missed [${cur.misses.join('; ')}]  extra [${cur.extras.join('; ')}]`);
  report[type] = { default: cur, sweep: rows.map(({ misses, extras, ...r }) => r) };
}

const negatives = runs.filter(({ c }) => !TYPES.some((t) => c[t]?.length));
const noisy = negatives.filter(({ spans }) => spans.some((s) => s.score >= DEFAULT_THRESHOLDS[s.type]));
console.log(`\nClean texts (code, logs, questions): ${negatives.length - noisy.length}/${negatives.length} with no findings at defaults`);
for (const { c, spans } of noisy) console.log(`  ${JSON.stringify(c.text.slice(0, 60))} -> ${spans.map((s) => `${s.type}:${s.value}`).join(', ')}`);

const jsonIdx = process.argv.indexOf('--json');
if (jsonIdx > 0) await writeFile(process.argv[jsonIdx + 1], JSON.stringify(report, null, 2));
