import { test } from 'node:test';
import assert from 'node:assert/strict';
import { luhn, isCardNumber, isIban, isAadhaar, verhoeff, isIPv4, isIPv6, entropy } from '../../src/core/checksums.js';

test('luhn and card prefixes', () => {
  assert.ok(luhn('4111111111111111'));
  assert.ok(!luhn('4111111111111112'));
  assert.ok(isCardNumber('4111111111111111')); // Visa test number
  assert.ok(isCardNumber('5555555555554444')); // Mastercard test number
  assert.ok(isCardNumber('378282246310005')); // Amex test number
  assert.ok(!isCardNumber('0000000000000000'));
  assert.ok(!isCardNumber('1234567812345670'), 'Luhn-valid but no issuer prefix');
});

test('IBAN mod-97', () => {
  assert.ok(isIban('GB82 WEST 1234 5698 7654 32'));
  assert.ok(isIban('DE89370400440532013000'));
  assert.ok(!isIban('GB82 WEST 1234 5698 7654 33'));
});

test('Aadhaar uses Verhoeff', () => {
  assert.ok(verhoeff('2363'));
  assert.ok(isAadhaar('234567890124'));
  assert.ok(!isAadhaar('234567890123'));
  assert.ok(!isAadhaar('123456789012'), 'cannot start with 0 or 1');
});

test('IP validators', () => {
  assert.ok(isIPv4('203.0.113.42'));
  assert.ok(!isIPv4('256.1.1.1'));
  assert.ok(!isIPv4('01.2.3.4'));
  assert.ok(isIPv6('2001:db8:85a3::8a2e:370:7334'));
  assert.ok(isIPv6('2001:0db8:0000:0000:0000:ff00:0042:8329'));
  assert.ok(!isIPv6('12:30:45'), 'clock times are not addresses');
  assert.ok(!isIPv6('aa:bb:cc:dd:ee:ff'), 'MAC addresses are not IPv6');
});

test('entropy', () => {
  assert.equal(entropy('aaaa'), 0);
  assert.ok(entropy('Q8m2N4b7X1c9V3z5K6j0') > 4);
});
