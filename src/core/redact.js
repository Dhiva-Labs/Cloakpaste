// Turn a pile of possibly-overlapping detections into the final redacted text.

import { typeInfo } from './types.js';
import { detectPatterns } from './detectors.js';
import { normalizeValue } from './vault.js';
import { STOPWORDS } from '../ner/decode.js';

/**
 * Resolve overlaps: higher-priority types win, then longer spans, then
 * pattern matches over model guesses. Returns spans sorted by start.
 */
export function mergeSpans(spans) {
  const rank = (s) => [typeInfo(s.type).priority, s.end - s.start, s.source === 'pattern' ? 1 : 0];
  const ordered = [...spans].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
    return a.start - b.start;
  });
  const kept = [];
  for (const s of ordered) {
    if (s.end <= s.start) continue;
    if (kept.some((k) => s.start < k.end && k.start < s.end)) continue;
    kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * Replace each span with its vault placeholder.
 * @returns {{ text: string, items: Array<{type:string, placeholder:string, value:string, start:number, end:number}>, counts: Record<string, number> }}
 */
export function applyRedactions(text, spans, vault) {
  let out = '';
  let last = 0;
  const items = [];
  const counts = {};
  for (const s of spans) {
    const value = text.slice(s.start, s.end);
    const placeholder = vault.assign(s.type, value);
    out += text.slice(last, s.start) + placeholder;
    items.push({ type: s.type, placeholder, value, start: s.start, end: s.end, source: s.source });
    counts[s.type] = (counts[s.type] || 0) + 1;
    last = s.end;
  }
  out += text.slice(last);
  return { text: out, items, counts };
}

/**
 * Full pipeline for one paste.
 * @param {string} text
 * @param {object} opts
 * @param {import('./vault.js').Vault} opts.vault
 * @param {Array} [opts.nerSpans] spans from the on-device model
 * @param {object} [opts.settings]
 */
export function redactText(text, { vault, nerSpans = [], settings = {} }) {
  const types = settings.types || {};
  const enabled = (t) => types[t] !== false;
  const spans = [
    ...detectPatterns(text, { types, highEntropy: settings.highEntropy, customTerms: settings.customTerms }),
    ...nerSpans.filter((s) => enabled(s.type)),
    ...propagateMentions(text, nerSpans.filter((s) => enabled(s.type))),
    ...vault.findKnownValues(text).filter((s) => enabled(s.type)),
  ];

  const allow = new Set((settings.allowlist || []).map((a) => a.trim().toLowerCase()).filter(Boolean));
  const allowed = (s) => {
    const v = text.slice(s.start, s.end).trim().toLowerCase();
    return allow.has(v) || allow.has(normalizeValue(s.type, v));
  };

  const merged = mergeSpans(spans.filter((s) => !allowed(s)));
  return applyRedactions(text, merged, vault);
}

/**
 * The model tags a name where context makes it obvious; repeat mentions
 * ("Priya said... Priya will") often score lower. Copy each model finding to
 * its other whole-word occurrences, and for people also tag lone first or last
 * names that appear elsewhere.
 */
export function propagateMentions(text, nerSpans) {
  const out = [];
  const seen = new Set();
  const add = (value, type) => {
    const key = type + ':' + value.toLowerCase();
    if (seen.has(key) || value.length < 3) return;
    seen.add(key);
    const re = new RegExp(`(?<![\\w])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\w])`, 'g');
    for (const m of text.matchAll(re)) {
      out.push({ start: m.index, end: m.index + m[0].length, type, source: 'model', detector: 'mention', score: 0.5 });
    }
  };
  for (const s of nerSpans) {
    const value = text.slice(s.start, s.end);
    add(value, s.type);
    if (s.type === 'PERSON') {
      for (const part of value.split(/\s+/)) {
        if (/^\p{Lu}[\p{Ll}'’-]{2,}$/u.test(part) && !STOPWORDS.has(part.toLowerCase())) add(part, 'PERSON');
      }
    }
  }
  return out;
}
