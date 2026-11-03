import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPatterns } from '../../src/core/detectors.js';

// Synthetic values only.
const found = (text, opts) => detectPatterns(text, opts).map((s) => [s.type, text.slice(s.start, s.end)]);
const has = (text, type, value, opts) =>
  assert.ok(found(text, opts).some(([t, v]) => t === type && v === value), `${type} "${value}" not found in ${JSON.stringify(found(text, opts))}`);
const none = (text, opts) => assert.deepEqual(found(text, opts), [], text);

// Token-shaped strings are assembled at runtime so no literal in this file
// looks like a live credential to secret scanners.
const tok = (...parts) => parts.join('');

test('vendor keys and tokens', () => {
  const cases = [
    ['API_KEY', tok('AKIA', 'IOSFODNN7', 'EXAMPLE')],
    ['API_KEY', tok('ghp', '_', 'a'.repeat(36))],
    ['API_KEY', tok('sk-', 'ant-', 'api03-', 'x1Y2z3'.repeat(6))],
    ['API_KEY', tok('sk', '_live_', 'Q8m2N4b7X1c9', 'V3z5K6j0L2p4')],
    ['API_KEY', tok('AI', 'za', 'Sy', 'Q8m2N4b7X1c9V3z5K6j0L2p4R7t9W1y3', 'A')],
    ['API_KEY', tok('hf', '_', 'abcdefghijklmnop', 'qrstuvwxyzABCDEF')],
    ['API_KEY', tok('xo', 'xb-', '1234567890-', 'abcdefghij')],
  ];
  for (const [type, value] of cases) has(`key ${value} here`, type, value);
  has('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456', 'TOKEN', 'abcdefghijklmnopqrstuvwxyz123456');
  const jwt = tok('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
  has(`token ${jwt}`, 'JWT', jwt);
});

test('private keys', () => {
  const pem = tok('-----BEGIN OPENSSH ', 'PRIVATE KEY-----\n', 'b3BlbnNzaC1rZXktdjEAAAAA\n', '-----END OPENSSH ', 'PRIVATE KEY-----');
  has(`id_ed25519:\n${pem}\n`, 'PRIVATE_KEY', pem);
});

test('secret assignments', () => {
  has('DB_PASSWORD=hunter2!', 'PASSWORD', 'hunter2!');
  has('"client_secret": "a1b2c3d4e5"', 'SECRET', 'a1b2c3d4e5');
  has("api_key: 'abcd-1234-efgh'", 'SECRET', 'abcd-1234-efgh');
  has('postgres://admin:S3cr3tPass@db.internal:5432/app', 'PASSWORD', 'S3cr3tPass');
  has('my password is Tr0ub4dor&3.', 'PASSWORD', 'Tr0ub4dor&3');
  has('https://api.example.com/v1?access_token=Zx81kLmN02pq&page=2', 'SECRET', 'Zx81kLmN02pq');
});

test('code that only mentions secrets is left alone', () => {
  none('max_tokens: 1024');
  none('const token = response.data.token;');
  none('password: string;');
  none('apiKey = getApiKey()');
  none('tokenizer = AutoTokenizer.from_pretrained(model_id)');
  none('PASSWORD=${DB_PASSWORD}');
  none('token: required');
  none('git checkout 4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39');
});

test('contact details', () => {
  has('mail john.oneill@acme.io today', 'EMAIL', 'john.oneill@acme.io');
  has('call +44 20 7946 0958', 'PHONE', '+44 20 7946 0958');
  has('call (415) 555-0172', 'PHONE', '(415) 555-0172');
  has('WhatsApp 98765 43210', 'PHONE', '98765 43210');
  has('ph +91-9876543210', 'PHONE', '+91-9876543210');
  none('version 1.2.3 released 2024-11-03 at 10:15');
  none('see logo@2x.png');
});

test('financial and identity numbers', () => {
  has('Card 4111 1111 1111 1111 exp', 'CARD', '4111 1111 1111 1111');
  has('card:4111-1111-1111-1111', 'CARD', '4111-1111-1111-1111');
  none('order id 1234567812345670');
  has('IBAN GB82 WEST 1234 5698 7654 32', 'IBAN', 'GB82 WEST 1234 5698 7654 32');
  has('SSN 123-45-6789', 'SSN', '123-45-6789');
  none('SSN 000-12-3456');
  has('Aadhaar 2345 6789 0124', 'AADHAAR', '2345 6789 0124');
  has('PAN ABCPE1234F', 'PAN', 'ABCPE1234F');
});

test('network identifiers', () => {
  has('from 203.0.113.42', 'IP', '203.0.113.42');
  none('listening on 127.0.0.1:8080');
  has('host fe80::1ff:fe23:4567:890a up', 'IP', 'fe80::1ff:fe23:4567:890a');
  has('mac 00:1A:2B:3C:4D:5E', 'MAC', '00:1A:2B:3C:4D:5E');
  none('meeting at 12:30:45');
});

test('type switches and custom terms', () => {
  none('mail john.oneill@acme.io', { types: { EMAIL: false } });
  has('Project Falcon launches with ACME Corp', 'CUSTOM', 'Project Falcon', { customTerms: ['project falcon'] });
  none('falconry is fun', { customTerms: ['falcon'] });
});

test('high-entropy mode is opt-in and skips hashes', () => {
  const s = 'Q8m2N4b7X1c9V3z5K6j0L2p4R7t9W1y3Ab';
  none(`value ${s}`);
  has(`value ${s}`, 'SECRET', s, { highEntropy: true });
  none('sha 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', { highEntropy: true });
});
