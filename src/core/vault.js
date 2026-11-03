// The vault maps placeholders to the values they stand for. It lives only in
// the browser (chrome.storage.session, so it is gone when the browser closes)
// and never travels with the redacted text.
//
// The same value always gets the same placeholder, so the AI can still reason
// about "EMAIL_1 sent the invoice to EMAIL_2" across several pastes.

import { typeInfo } from './types.js';

const CASE_INSENSITIVE = new Set(['EMAIL', 'PERSON', 'LOCATION', 'ORG', 'CUSTOM']);
const PLACEHOLDER_RE = /\[([A-Z][A-Z0-9_]*?_\d+)\]|(?<![A-Za-z0-9_])([A-Z][A-Z0-9_]*?_\d+)(?![A-Za-z0-9_])/g;

export function normalizeValue(type, value) {
  const v = value.trim().replace(/\s+/g, ' ');
  return CASE_INSENSITIVE.has(type) ? v.toLowerCase() : v;
}

export class Vault {
  constructor(data = {}) {
    /** @type {Record<string, { type: string, value: string, at: number }>} */
    this.entries = { ...(data.entries || {}) };
    /** @type {Record<string, string>} `${type}:${normalized}` -> key */
    this.index = { ...(data.index || {}) };
    /** @type {Record<string, number>} */
    this.counters = { ...(data.counters || {}) };
  }

  get size() {
    return Object.keys(this.entries).length;
  }

  /** Returns the placeholder text, e.g. "[EMAIL_1]". */
  assign(type, value) {
    const idx = `${type}:${normalizeValue(type, value)}`;
    let key = this.index[idx];
    if (!key) {
      const prefix = typeInfo(type).prefix;
      const n = (this.counters[prefix] || 0) + 1;
      this.counters[prefix] = n;
      key = `${prefix}_${n}`;
      this.index[idx] = key;
      this.entries[key] = { type, value, at: Date.now() };
    }
    return `[${key}]`;
  }

  get(key) {
    return this.entries[key.replace(/^\[|\]$/g, '')];
  }

  /** Replace every known placeholder in `text` with its original value. */
  restore(text) {
    return text.replace(PLACEHOLDER_RE, (whole, a, b) => {
      const e = this.entries[a || b];
      return e ? e.value : whole;
    });
  }

  /** Positions of known placeholders in `text`: [{ start, end, key, entry }]. */
  findPlaceholders(text) {
    const out = [];
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      const key = m[1] || m[2];
      const entry = this.entries[key];
      if (entry) out.push({ start: m.index, end: m.index + m[0].length, key, entry });
    }
    return out;
  }

  /**
   * Values from earlier pastes that appear again in `text`, so a name the
   * model spotted once stays hidden even where it is missed later.
   */
  findKnownValues(text) {
    const spans = [];
    const haystackLower = text.toLowerCase();
    for (const [key, e] of Object.entries(this.entries)) {
      if (e.value.length < 3) continue;
      const ci = CASE_INSENSITIVE.has(e.type);
      const hay = ci ? haystackLower : text;
      const needle = ci ? e.value.toLowerCase() : e.value;
      const wordy = /^\w/.test(needle) && /\w$/.test(needle);
      let from = 0;
      for (;;) {
        const i = hay.indexOf(needle, from);
        if (i === -1) break;
        from = i + needle.length;
        if (wordy && (/\w/.test(text[i - 1] || '') || /\w/.test(text[i + needle.length] || ''))) continue;
        spans.push({ start: i, end: i + needle.length, type: e.type, source: 'vault', detector: 'known-value', key, score: 1 });
      }
    }
    return spans;
  }

  remove(key) {
    const e = this.entries[key];
    if (!e) return;
    delete this.entries[key];
    delete this.index[`${e.type}:${normalizeValue(e.type, e.value)}`];
  }

  toJSON() {
    return { entries: this.entries, index: this.index, counters: this.counters };
  }
}
