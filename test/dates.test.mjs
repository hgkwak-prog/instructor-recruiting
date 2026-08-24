import test from 'node:test';
import assert from 'node:assert/strict';
import { businessDaysAfter, localDateKey } from '../core/dates.mjs';

test('adds three business days across a weekend', () => {
  assert.equal(businessDaysAfter(new Date('2026-08-14T09:00:00.000Z'), 3), '2026-08-19');
});

test('adds three business days from a Monday', () => {
  assert.equal(businessDaysAfter(new Date('2026-08-17T09:00:00.000Z'), 3), '2026-08-20');
});

test('uses the KST calendar date, not the UTC one', () => {
  // 2026-08-17T23:00Z is already Tuesday 2026-08-18 08:00 in Seoul.
  // The old UTC-based logic based it on Monday and answered 2026-08-20.
  assert.equal(localDateKey(new Date('2026-08-17T23:00:00.000Z')), '2026-08-18');
  assert.equal(businessDaysAfter(new Date('2026-08-17T23:00:00.000Z'), 3), '2026-08-21');
});

test('KST morning and KST evening of the same day agree', () => {
  const morning = new Date('2026-08-17T23:30:00.000Z'); // 08:30 KST, 18 Aug
  const evening = new Date('2026-08-18T09:00:00.000Z'); // 18:00 KST, 18 Aug
  assert.equal(businessDaysAfter(morning, 3), businessDaysAfter(evening, 3));
});
