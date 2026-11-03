// Pattern detectors: fast, deterministic and checksum-backed where a checksum
// exists. Each one yields spans { start, end, type, source, detector }.
// `group` selects a capture group when only part of the match is sensitive
// (the password in a URL, the value in `API_KEY=...`).

import { isCardNumber, isIban, isAadhaar, entropy, isIPv4, isIPv6 } from './checksums.js';

const SECRET_KEY_NAMES =
  '(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|' +
  'client[_-]?secret|auth[_-]?key|credentials?|session[_-]?(?:id|key|token)|signing[_-]?key|encryption[_-]?key)';

// Values that are obviously not secrets: templating, env lookups, empties.
const PLACEHOLDER_VALUE =
  /^(?:true|false|null|none|nil|undefined|required|optional|string|number|boolean|redacted|hidden|\*+|x+|\.{3}|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|%[a-z]|\$[A-Z_][A-Z0-9_]*|\[[A-Z_]+_\d+\])$/i;
const CODE_REFERENCE =
  /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:\(.*)?|[A-Za-z_$][\w$]*\(.*|[a-z]+(?:[A-Z][a-z]+)+|[a-z]+(?:_[a-z]+)+)$/;
// Keys that mention a secret word but hold settings, not secrets (max_tokens: 1024).
const NOT_SECRET_KEY =
  /(?:max|num|total|prompt|completion|input|output|context)[_-]?tokens|tokens?[_-]?(?:count|limit|type|ids?|usage|url|uri|endpoint|length|len|size|expir\w*|ttl|budget)$|tokeniz|[_-](?:length|len|min|max|policy|url|uri|file|path|name|id|count|enabled|required)$/i;

// Template and variable references: ${VAR}, {{ secret }}, $(cmd), %(name)s, <your-key>.
const TEMPLATE_START = /^(?:\$\{|\{\{|\$\(|%\(|<)/;

function plausibleSecretValue(value, quoted) {
  if (!value || value.length < 4) return false;
  if (TEMPLATE_START.test(value)) return false;
  if (PLACEHOLDER_VALUE.test(value)) return false;
  if (CODE_REFERENCE.test(value)) return false;
  if (quoted) return true;
  // Unquoted: a single plain word is usually prose ("token: required"), so ask
  // for something password-shaped.
  return /\d/.test(value) || /[^A-Za-z]/.test(value) || entropy(value) >= 3.2 || value.length >= 12;
}

export const DETECTORS = [
  {
    id: 'private-key',
    type: 'PRIVATE_KEY',
    re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { id: 'jwt', type: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{0,}/g },
  { id: 'aws-access-key', type: 'API_KEY', re: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  { id: 'github-token', type: 'API_KEY', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g },
  { id: 'gitlab-token', type: 'API_KEY', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'slack-token', type: 'API_KEY', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'slack-webhook', type: 'API_KEY', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+/g },
  { id: 'stripe-key', type: 'API_KEY', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { id: 'google-api-key', type: 'API_KEY', re: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { id: 'llm-api-key', type: 'API_KEY', re: /\bsk-(?:ant-|proj-|svcacct-|admin-|or-v1-)?[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g },
  { id: 'huggingface-token', type: 'API_KEY', re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { id: 'npm-token', type: 'API_KEY', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'sendgrid-key', type: 'API_KEY', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { id: 'twilio-key', type: 'API_KEY', re: /\bSK[0-9a-f]{32}\b/g },
  { id: 'telegram-bot-token', type: 'API_KEY', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g },
  { id: 'discord-token', type: 'TOKEN', re: /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}\b/g },
  {
    id: 'auth-header',
    type: 'TOKEN',
    re: /\b(?:Bearer|Basic|Token)\s+([A-Za-z0-9._~+/-]{16,}=*)/dg,
    group: 1,
  },
  {
    id: 'url-credentials',
    type: 'PASSWORD',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@/dgi,
    group: 1,
    validate: (m) => !PLACEHOLDER_VALUE.test(m[1]),
  },
  {
    id: 'secret-assignment',
    type: 'SECRET',
    // key = "value" | key: 'value' | KEY=value | "key": "value" | key => value
    re: new RegExp(
      `(?<![A-Za-z0-9])([A-Za-z0-9_.-]*${SECRET_KEY_NAMES}[A-Za-z0-9_-]*)["']?\\s*(?::=|=>|[:=])\\s*` +
        `(?:"([^"\\n]{4,})"|'([^'\\n]{4,})'|([^\\s"',;&)}\\]]{4,}))`,
      'dgi',
    ),
    pickGroup: (m) => (m[2] !== undefined ? 2 : m[3] !== undefined ? 3 : 4),
    validate: (m) => {
      if (NOT_SECRET_KEY.test(m[1])) return false;
      const value = m[2] ?? m[3] ?? m[4];
      if (/^\d+$/.test(value) && !/pass|pwd|pin/i.test(m[1])) return false;
      return plausibleSecretValue(value, m[4] === undefined);
    },
    typeFor: (m) => (/pass|pwd/i.test(m[1]) ? 'PASSWORD' : 'SECRET'),
  },
  {
    id: 'password-phrase',
    type: 'PASSWORD',
    re: /\b(?:password|passcode|passwd|pin)\s+(?:is|was|=)\s*[:"']?\s*([^\s"',]{4,})/dgi,
    group: 1,
    validate: (m) => plausibleSecretValue(m[1].replace(/[.!?]$/, ''), false),
    trim: /[.!?]+$/,
  },
  {
    id: 'email',
    type: 'EMAIL',
    re: /(?<![A-Za-z0-9._%+:/-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}(?![A-Za-z0-9-])/g,
    validate: (m) => !/^[^@]+@\d+x\.(?:png|jpe?g|webp|gif)$/i.test(m[0]),
  },
  {
    id: 'card',
    type: 'CARD',
    re: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g,
    validate: (m) => isCardNumber(m[0].replace(/[ -]/g, '')) && consistentSeparators(m[0]),
  },
  {
    id: 'iban',
    type: 'IBAN',
    re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g,
    validate: (m) => isIban(m[0]),
  },
  {
    id: 'us-ssn',
    type: 'SSN',
    re: /(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/g,
  },
  {
    id: 'aadhaar',
    type: 'AADHAAR',
    re: /(?<![\d-])[2-9]\d{3}([ -]?)\d{4}\1\d{4}(?![\d-])/g,
    validate: (m) => isAadhaar(m[0].replace(/[ -]/g, '')),
  },
  { id: 'india-pan', type: 'PAN', re: /\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/g },
  {
    id: 'phone-international',
    type: 'PHONE',
    re: /(?<![\w+])\+\d{1,3}[ .-]?(?:\(\d{1,4}\)[ .-]?)?\d{1,5}(?:[ .-]?\d{2,5}){1,4}(?![\w])/g,
    validate: (m) => digitCount(m[0], 8, 15),
  },
  {
    id: 'phone-us',
    type: 'PHONE',
    re: /(?<![\w.-])(?:\(\d{3}\)\s?|\d{3}[-. ])\d{3}[-. ]\d{4}(?![\w-]|\.\d)/g,
  },
  {
    id: 'phone-india',
    type: 'PHONE',
    re: /(?<![\w.+-])(?:0|91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?![\w-]|\.\d)/g,
    validate: (m) => digitCount(m[0], 10, 12),
  },
  {
    id: 'ipv4',
    type: 'IP',
    re: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d]|\.\d)/g,
    validate: (m) => isIPv4(m[0]) && !/^(?:127\.|0\.0\.0\.0$|255\.255\.255\.255$)/.test(m[0]),
  },
  {
    id: 'ipv6',
    type: 'IP',
    re: /(?<![\w:.])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])/g,
    validate: (m) => isIPv6(m[0]) && m[0] !== '::1' && /[0-9A-Fa-f]{2}/.test(m[0]),
  },
  { id: 'mac', type: 'MAC', re: /\b(?:[0-9A-Fa-f]{2}([:-]))(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}\b/g },
];

// Optional, off by default: long random-looking strings that no vendor
// pattern recognises. Off because git SHAs and hashes trip it.
export const HIGH_ENTROPY_DETECTOR = {
  id: 'high-entropy',
  type: 'SECRET',
  re: /(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_=-]{32,}(?![A-Za-z0-9+/_=-])/g,
  validate: (m) => {
    const s = m[0];
    if (/^[0-9a-f]+$/i.test(s) && (s.length === 32 || s.length === 40 || s.length === 64)) return false;
    return /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s) && entropy(s) >= 4.0;
  },
};

function digitCount(s, min, max) {
  const n = s.replace(/\D/g, '').length;
  return n >= min && n <= max;
}

// "4111 1111 1111 1111" and "4111111111111111" are cards; "41 1111 11-11 1111 1" is noise.
function consistentSeparators(s) {
  const seps = s.match(/[ -]/g);
  if (!seps) return true;
  if (new Set(seps).size > 1) return false;
  const blocks = s.split(/[ -]/).map((b) => b.length);
  return blocks.every((n) => n >= 3);
}

/**
 * Run pattern detectors over `text`.
 * @param {string} text
 * @param {{ types?: Record<string, boolean>, highEntropy?: boolean, customTerms?: string[] }} [opts]
 */
export function detectPatterns(text, opts = {}) {
  const enabled = (type) => opts.types?.[type] !== false;
  const detectors = opts.highEntropy ? [...DETECTORS, HIGH_ENTROPY_DETECTOR] : DETECTORS;
  const spans = [];

  for (const det of detectors) {
    if (!enabled(det.type) && !(det.typeFor && enabled('PASSWORD'))) continue;
    det.re.lastIndex = 0;
    for (const m of text.matchAll(det.re)) {
      if (det.validate && !det.validate(m)) continue;
      const type = det.typeFor ? det.typeFor(m) : det.type;
      if (!enabled(type)) continue;
      const g = det.pickGroup ? det.pickGroup(m) : det.group;
      let start = m.index;
      let end = m.index + m[0].length;
      if (g) {
        [start, end] = m.indices[g];
      }
      if (det.trim) {
        const value = text.slice(start, end);
        end = start + value.replace(det.trim, '').length;
      }
      if (end > start) spans.push({ start, end, type, source: 'pattern', detector: det.id, score: 1 });
    }
  }

  if (enabled('CUSTOM')) spans.push(...detectTerms(text, opts.customTerms || []));
  return spans;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// User-defined words (company names, project codenames). Case-insensitive,
// whole-word where the term starts/ends with a word character.
export function detectTerms(text, terms, type = 'CUSTOM') {
  const spans = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (term.length < 2) continue;
    const pre = /^\w/.test(term) ? '(?<![\\w])' : '';
    const post = /\w$/.test(term) ? '(?![\\w])' : '';
    const re = new RegExp(pre + escapeRe(term).replace(/\s+/g, '\\s+') + post, 'gi');
    for (const m of text.matchAll(re)) {
      spans.push({ start: m.index, end: m.index + m[0].length, type, source: 'term', detector: 'custom-term', score: 1 });
    }
  }
  return spans;
}
