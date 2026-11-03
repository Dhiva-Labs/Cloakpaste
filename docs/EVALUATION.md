# Evaluating the name and place model

PasteGuard uses pattern detectors for anything with a fixed shape (keys,
emails, card numbers) and a small on-device model for what patterns can't
catch: people's names, places and street addresses. This page covers how the
model's confidence thresholds were chosen.

## Setup

- Model: `gravitee-io/bert-small-pii-detection`, int8 ONNX (28.7 MB), run with
  transformers.js 4.3 on CPU.
- Data: `tests/eval/ner-cases.json`, 40 hand-written texts.
  - 25 contain 29 names and 21 places or addresses. The names cover Indian,
    East Asian, European, Arabic and Latin American naming.
  - 15 are negatives: code, SQL, a Python traceback, a log line, commit
    messages and general questions. They are what people paste into AI chats
    most, and nothing in them should be hidden.
- Matching: a finding counts as correct if it overlaps the expected span.
- Script: `npm run eval:ner` runs the model once per text with no threshold,
  then sweeps thresholds offline.

## Results (2026-11-03)

People's names:

| Threshold | Precision | Recall | Missed |
|---|---|---|---|
| 0.30–0.65 | 1.000 | 0.966 | 1 |
| **0.50 (default)** | **1.000** | **0.966** | "Sneha" |
| 0.70 | 1.000 | 0.862 | 4 |
| 0.80 | 1.000 | 0.759 | 7 |

Places and addresses:

| Threshold | Precision | Recall | Notes |
|---|---|---|---|
| 0.30–0.50 | 0.955 | 1.000 | one false positive |
| **0.55 (default)** | **1.000** | **1.000** | |
| 0.65 | 1.000 | 0.952 | misses "Boston" |
| 0.70 | 1.000 | 0.714 | |

Negatives: at the default thresholds, 15 of 15 code, log and question
samples produce no findings.

## Reading these numbers

- Recall falls quickly above about 0.65 for both types. The int8 model is
  well calibrated at the low end but rarely very confident about single-word
  names, so a cautious-looking threshold of 0.8 would miss about a quarter of
  names.
- Precision stays at 1.0 on this set across the useful range, partly because
  `decode.js` post-processing removes the usual false positives before
  thresholds apply. It trims filler words next to names ("Ping John" becomes
  "John"), rejects camelCase and snake_case identifiers, and requires names to
  be capitalised.
- Two safeguards sit on top of the model. Once a name is found, its other
  mentions in the paste are hidden too, and so are values from earlier pastes
  on the same site. This lifts real-world recall above what the table shows.
- The set is small and was written by the developer. It catches regressions
  when the model, thresholds or post-processing change; it isn't a substitute
  for a public benchmark. The model card reports micro-F1 0.87 on its own
  test split.

## Browser and Node agree

The extension runs the same `src/ner/engine.js` in an offscreen document
using the ONNX runtime's WebAssembly backend. The e2e suite checks that the
playground finds names and places inside Chrome. A typical paste took 76 ms
in headless Chrome 154, including the first inference after load.
