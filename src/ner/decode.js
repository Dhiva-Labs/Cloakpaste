// Turn raw token-classification output into character spans.
//
// transformers.js does not return character offsets for BERT tokens, so we
// align WordPiece tokens back onto the original text ourselves, then group
// BIO labels into entities and clean them up.

// Model label -> Cloakpaste type. Labels not listed are ignored (DATE_TIME,
// AGE, TITLE, NRP and friends are too common to hide by default).
export const LABEL_MAP = {
  PERSON: 'PERSON',
  LOCATION: 'LOCATION',
  ORGANIZATION: 'ORG',
  PASSWORD: 'PASSWORD',
  EMAIL_ADDRESS: 'EMAIL',
  PHONE_NUMBER: 'PHONE',
  US_SSN: 'SSN',
  US_PASSPORT: 'ID_NUMBER',
  US_DRIVER_LICENSE: 'ID_NUMBER',
  US_ITIN: 'ID_NUMBER',
  US_BANK_NUMBER: 'BANK_ACCOUNT',
  CREDIT_CARD: 'CARD',
  IBAN_CODE: 'IBAN',
  IP_ADDRESS: 'IP',
  MAC_ADDRESS: 'MAC',
  COORDINATE: 'LOCATION',
};

// Minimum mean confidence per type, picked with scripts/eval-ner.mjs (see
// docs/EVALUATION.md). Names are where the model earns its keep;
// structured types already have stricter pattern detectors, so the model only
// fills gaps there when it is very sure.
export const DEFAULT_THRESHOLDS = {
  PERSON: 0.5,
  LOCATION: 0.55,
  ORG: 0.7,
  PASSWORD: 0.85,
  default: 0.85,
};

// Words that open or close a sentence next to a name but are not names
// ("Ping John", "Thanks Priya", "Dear Sam").
export const STOPWORDS = new Set(
  `a an the and or but if then so to of in on at by for from with without into onto about as is are was were be been
  being am i me my we our you your he him his she her they them their it its this that these those here there hi hello
  hey dear thanks thank cheers regards ping ask tell email mail call text message contact meet cc bcc fwd re mr mrs ms
  dr prof sir madam team all everyone please kindly note fyi per via said says met will can could should would may
  might must shall do does did done has have had not no yes ok okay also just only even still yet again today tomorrow
  yesterday monday tuesday wednesday thursday friday saturday sunday january february march april june july august
  september october november december street st road rd avenue ave`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * BERT-style normalisation (lower-case, strip accents) with a map back to
 * original UTF-16 indices.
 */
export function normalizeWithMap(text) {
  let norm = '';
  const start = [];
  const end = [];
  let i = 0;
  for (const ch of text) {
    const n = ch.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
    for (let k = 0; k < n.length; k++) {
      start.push(i);
      end.push(i + ch.length);
    }
    norm += n;
    i += ch.length;
  }
  return { norm, start, end };
}

/**
 * Align WordPiece tokens (without [CLS]/[SEP]) to character offsets.
 * Returns one { start, end } per token, or null where a token cannot be placed.
 */
export function alignTokens(text, tokens) {
  const { norm, start, end } = normalizeWithMap(text);
  const out = new Array(tokens.length).fill(null);
  let cursor = 0;
  let pendingUnk = [];
  const MAX_GAP = 64;

  const skipSpace = (p) => {
    while (p < norm.length && /\s/.test(norm[p])) p++;
    return p;
  };

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    if (tok === '[UNK]') {
      pendingUnk.push(t);
      continue;
    }
    const piece = tok.startsWith('##') ? tok.slice(2) : tok;
    if (!piece) continue;
    const from = tok.startsWith('##') ? cursor : skipSpace(cursor);
    const pos = norm.startsWith(piece, from) ? from : norm.indexOf(piece, from);
    if (pos === -1 || pos - from > MAX_GAP) continue;

    if (pendingUnk.length) {
      // Unknown characters sit between the previous token and this one.
      let a = skipSpace(cursor);
      let b = pos;
      while (b > a && /\s/.test(norm[b - 1])) b--;
      if (b > a) for (const u of pendingUnk) out[u] = { start: start[a], end: end[b - 1] };
      pendingUnk = [];
    }

    out[t] = { start: start[pos], end: end[pos + piece.length - 1] };
    cursor = pos + piece.length;
  }
  return out;
}

/**
 * Group per-token predictions into entity spans.
 * @param {string} text original chunk text
 * @param {string[]} tokens WordPiece tokens, no special tokens
 * @param {Array<{label: string, score: number}>} preds one per token
 */
export function decodeEntities(text, tokens, preds, { thresholds = DEFAULT_THRESHOLDS } = {}) {
  const offsets = alignTokens(text, tokens);
  const entities = [];
  let cur = null;

  const close = () => {
    if (cur) entities.push(cur);
    cur = null;
  };

  for (let t = 0; t < tokens.length; t++) {
    const off = offsets[t];
    if (!off) continue;
    const isSub = tokens[t].startsWith('##');
    const { label, score } = preds[t];

    if (isSub) {
      // Sub-words belong to whatever word they continue.
      if (cur && off.start <= cur.end + 1) cur.end = Math.max(cur.end, off.end);
      continue;
    }

    if (label === 'O') {
      close();
      continue;
    }
    const [bio, raw] = label.includes('-') ? label.split(/-(.+)/) : ['B', label];
    const type = LABEL_MAP[raw];
    if (!type) {
      close();
      continue;
    }
    const contiguous = cur && /^[\s'’.,-]{0,3}$/.test(text.slice(cur.end, off.start));
    if (cur && cur.type === type && contiguous && bio === 'I') {
      cur.end = off.end;
      cur.scores.push(score);
    } else {
      close();
      cur = { type, start: off.start, end: off.end, scores: [score] };
    }
  }
  close();

  return joinAdjacentNames(text, entities)
    .map((e) => cleanEntity(text, e))
    .filter(Boolean)
    .filter((e) => e.score >= (thresholds[e.type] ?? thresholds.default));
}

// The model sometimes starts a new B- tag mid-name ("John" + "O'Neill").
// Two person spans separated by a single space are one person.
function joinAdjacentNames(text, entities) {
  const out = [];
  for (const e of entities) {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'PERSON' && e.type === 'PERSON' && /^ $/.test(text.slice(prev.end, e.start))) {
      prev.end = e.end;
      prev.scores.push(...e.scores);
    } else {
      out.push(e);
    }
  }
  return out;
}

function cleanEntity(text, e) {
  let { start, end } = e;
  const score = e.scores.reduce((a, b) => a + b, 0) / e.scores.length;

  // Trim punctuation and possessives at the edges.
  while (start < end && /[\s.,;:!?"'’()[\]{}-]/.test(text[start])) start++;
  while (end > start && /[\s.,;:!?"'’()[\]{}-]/.test(text[end - 1])) end--;
  if (/['’]s$/i.test(text.slice(start, end))) end -= 2;

  if (e.type === 'PERSON' || e.type === 'LOCATION' || e.type === 'ORG') {
    // Drop filler words at the edges ("Ping John" -> "John").
    const words = [...text.slice(start, end).matchAll(/\S+/g)].map((m) => ({ s: start + m.index, e: start + m.index + m[0].length, w: m[0] }));
    const filler = (w) => STOPWORDS.has(w.w.toLowerCase().replace(/[^\p{L}]/gu, ''));
    while (words.length && filler(words[0])) words.shift();
    while (words.length && filler(words[words.length - 1])) words.pop();
    if (!words.length) return null;
    start = words[0].s;
    end = words[words.length - 1].e;

    // Code identifiers are not people: userName, payment_service, Foo2.
    if (words.some((w) => /[_$]|\p{Ll}\p{Lu}.*\p{Lu}|^\p{Ll}+\p{Lu}/u.test(w.w))) return null;
    if (e.type === 'PERSON') {
      if (!words.some((w) => /^\p{Lu}/u.test(w.w))) return null;
      if (words.some((w) => /\d/.test(w.w))) return null;
    }
  }

  if (end - start < 2) return null;
  return { type: e.type, start, end, score, source: 'model', detector: 'pii-model' };
}

/**
 * Split long text into chunks the model can take (BERT tops out at 512
 * tokens). Splits on blank lines, then lines, then sentences, then spaces.
 */
export function chunkText(text, maxChars = 900) {
  const chunks = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(text.length, pos + maxChars);
    if (end < text.length) {
      const window = text.slice(pos, end);
      const cut =
        lastBreak(window, /\n\s*\n/g) ?? lastBreak(window, /\n/g) ?? lastBreak(window, /[.!?]\s/g) ?? lastBreak(window, /\s/g);
      if (cut && cut > maxChars * 0.3) end = pos + cut;
    }
    chunks.push({ start: pos, text: text.slice(pos, end) });
    pos = end;
  }
  return chunks;
}

function lastBreak(s, re) {
  let last = null;
  for (const m of s.matchAll(re)) last = m.index + m[0].length;
  return last;
}
