import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignTokens, decodeEntities, chunkText, normalizeWithMap } from '../../src/ner/decode.js';

test('normalisation maps accents and case back to original offsets', () => {
  const { norm, start } = normalizeWithMap('São Müller');
  assert.equal(norm, 'sao muller');
  assert.equal(start[norm.indexOf('m')], 4);
});

test('WordPiece tokens align to character offsets', () => {
  const text = "Ping John O'Neill at Acme";
  const tokens = ['ping', 'john', 'o', "'", 'neill', 'at', 'ac', '##me'];
  const off = alignTokens(text, tokens);
  assert.deepEqual(off.map((o) => text.slice(o.start, o.end)), ['Ping', 'John', 'O', "'", 'Neill', 'at', 'Ac', 'me']);
});

test('[UNK] tokens take the characters between neighbours', () => {
  const text = 'hi 🦊 there';
  const off = alignTokens(text, ['hi', '[UNK]', 'there']);
  assert.equal(text.slice(off[1].start, off[1].end), '🦊');
});

test('BIO labels become cleaned entity spans', () => {
  const text = "Ping John O'Neill at Acme Corp in Paris.";
  const tokens = ['ping', 'john', 'o', "'", 'neill', 'at', 'ac', '##me', 'corp', 'in', 'paris', '.'];
  const L = (label, score = 0.9) => ({ label, score });
  const preds = [L('B-PERSON'), L('I-PERSON'), L('I-PERSON'), L('I-PERSON'), L('I-PERSON'), L('O'), L('B-ORGANIZATION'), L('I-ORGANIZATION'), L('I-ORGANIZATION'), L('O'), L('B-LOCATION'), L('O')];
  const ents = decodeEntities(text, tokens, preds).map((e) => [e.type, text.slice(e.start, e.end)]);
  assert.deepEqual(ents, [['PERSON', "John O'Neill"], ['ORG', 'Acme Corp'], ['LOCATION', 'Paris']]);
});

test('code identifiers are never people', () => {
  const text = 'call userName then PaymentServiceImpl';
  const tokens = ['call', 'user', '##name', 'then', 'payment', '##service', '##im', '##pl'];
  const preds = tokens.map((t, i) => ({ label: i === 1 || i === 4 ? 'B-PERSON' : t.startsWith('##') ? 'I-PERSON' : 'O', score: 0.95 }));
  assert.deepEqual(decodeEntities(text, tokens, preds), []);
});

test('chunking splits on natural boundaries and covers all text', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Line ${i} has some words in it.`).join('\n');
  const chunks = chunkText(text, 200);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.map((c) => c.text).join(''), text);
  assert.ok(chunks.slice(0, -1).every((c) => c.text.endsWith('\n')));
});
