import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vault } from '../../src/core/vault.js';
import { redactText, mergeSpans, propagateMentions } from '../../src/core/redact.js';
import { summarize } from '../../src/core/types.js';

test('vault keeps placeholders stable and restores them', () => {
  const v = new Vault();
  assert.equal(v.assign('EMAIL', 'a@x.io'), '[EMAIL_1]');
  assert.equal(v.assign('EMAIL', 'A@X.io'), '[EMAIL_1]', 'emails are case-insensitive');
  assert.equal(v.assign('EMAIL', 'b@x.io'), '[EMAIL_2]');
  assert.equal(v.assign('API_KEY', 'sk-1'), '[API_KEY_1]');
  assert.equal(v.restore('to [EMAIL_2] and EMAIL_1, not [EMAIL_9]'), 'to b@x.io and a@x.io, not [EMAIL_9]');
  const copy = new Vault(JSON.parse(JSON.stringify(v)));
  assert.equal(copy.assign('EMAIL', 'b@x.io'), '[EMAIL_2]', 'survives serialisation');
  copy.remove('EMAIL_2');
  assert.equal(copy.restore('[EMAIL_2]'), '[EMAIL_2]');
});

test('higher-priority and longer spans win overlaps', () => {
  const spans = mergeSpans([
    { start: 0, end: 10, type: 'PERSON', source: 'model' },
    { start: 5, end: 20, type: 'EMAIL', source: 'pattern' },
    { start: 25, end: 30, type: 'PERSON', source: 'model' },
  ]);
  assert.deepEqual(spans.map((s) => s.type), ['EMAIL', 'PERSON']);
});

test('redactText combines patterns, model spans and earlier values', () => {
  const v = new Vault();
  const text = 'Priya Raman (priya@corp.in) owns it. Priya agreed.';
  const nerSpans = [{ start: 0, end: 11, type: 'PERSON', source: 'model', score: 0.9 }];
  const r = redactText(text, { vault: v, nerSpans });
  assert.equal(r.text, '[PERSON_1] ([EMAIL_1]) owns it. [PERSON_2] agreed.');
  assert.equal(v.restore(r.text), text);

  // A later paste with no model findings still hides known values.
  const again = redactText('Ask Priya Raman about it', { vault: v });
  assert.equal(again.text, 'Ask [PERSON_1] about it');
});

test('allowlist and disabled types are respected', () => {
  const v = new Vault();
  const r = redactText('support@acme.io or jane@acme.io', { vault: v, settings: { allowlist: ['Support@acme.io'] } });
  assert.equal(r.text, 'support@acme.io or [EMAIL_1]');
  const off = redactText('jane@acme.io', { vault: new Vault(), settings: { types: { EMAIL: false } } });
  assert.equal(off.text, 'jane@acme.io');
});

test('name parts propagate but filler words do not', () => {
  const text = 'Will Smith called. Will you reply to Smith?';
  const spans = propagateMentions(text, [{ start: 0, end: 10, type: 'PERSON' }]);
  const values = spans.map((s) => text.slice(s.start, s.end));
  assert.ok(values.includes('Smith'));
  assert.ok(!values.includes('Will'), '"Will" is a stopword');
});

test('summaries read naturally', () => {
  assert.equal(summarize({ EMAIL: 2, API_KEY: 1 }), '2 email addresses, 1 API key');
  assert.equal(summarize({ PAN: 2 }), '2 PANs (India)');
});
