import test from 'node:test';
import assert from 'node:assert/strict';
import {
  spanMinutes, breakAnalysis, setupAnalysis, deriveRequiredQualifications, generalizeLocation
} from '../core/derive.mjs';
import { verifyResult } from '../core/verify.mjs';
import { baseResult, baseFacts, fact } from './fixtures.mjs';

const clean = { customerDisclosure: 'hidden' };

test('spanMinutes parses a time range and rejects nonsense', () => {
  assert.equal(spanMinutes('10:00-17:00'), 420);
  assert.equal(spanMinutes('09:30-17:30'), 480);
  assert.equal(spanMinutes('17:00-10:00'), null);
  assert.equal(spanMinutes('오전 10시'), null);
  assert.equal(spanMinutes(null), null);
});

test('a one-hour gap is lunch, not a contradiction', () => {
  // 10:00-17:00 is 7h; the document says 6h of teaching. That hour is lunch.
  const analysis = breakAnalysis({ dailySchedule: '10:00-17:00', hoursPerSession: 6 });
  assert.deepEqual(analysis, { gap: 60, kind: 'break' });
});

test('no gap is reported as none', () => {
  assert.deepEqual(
    breakAnalysis({ dailySchedule: '10:00-17:00', hoursPerSession: 7 }),
    { gap: 0, kind: 'none' }
  );
});

test('an implausibly large gap is not silently called a break', () => {
  const analysis = breakAnalysis({ dailySchedule: '09:00-18:00', hoursPerSession: 5 });
  assert.equal(analysis.kind, 'unexplained');
  assert.equal(analysis.gap, 240);
});

test('teaching longer than the class block is an overrun', () => {
  assert.equal(breakAnalysis({ dailySchedule: '10:00-15:00', hoursPerSession: 6 }).kind, 'overrun');
});

test('lunch produces a warning, not an error', () => {
  const result = baseResult();
  result.facts.dailySchedule = fact('10:00-17:00');
  result.facts.hoursPerSession = fact(6);
  result.facts.totalHours = fact(18);
  const { errors, warnings } = verifyResult({ result, conditions: clean });
  assert.deepEqual(errors, [], '점심 1시간은 오류가 아닙니다');
  assert.ok(warnings.some((w) => w.includes('휴게시간')));
});

test('an unexplained gap blocks the run', () => {
  const result = baseResult();
  result.facts.dailySchedule = fact('09:00-18:00');
  result.facts.hoursPerSession = fact(5);
  result.facts.totalHours = fact(15);
  result.facts.workingHours = fact(null);
  const { errors } = verifyResult({ result, conditions: clean });
  assert.ok(errors.some((e) => e.includes('휴게시간으로 보기에 큽니다')));
});

test('setup time is the difference between working and class hours', () => {
  assert.deepEqual(
    setupAnalysis({ dailySchedule: '10:00-17:00', workingHours: '09:30-17:30' }),
    { extra: 60, differs: true }
  );
});

test('working hours shorter than class hours is an error', () => {
  const result = baseResult();
  result.facts.workingHours = fact('10:30-16:30');
  const { errors } = verifyResult({ result, conditions: clean });
  assert.ok(errors.some((e) => e.includes('근무 시간')));
});

test('derivation returns nothing rather than guessing', () => {
  const derived = deriveRequiredQualifications(baseFacts({
    sessionDates: fact([]),
    location: fact(null),
    workingHours: fact(null),
    dailySchedule: fact(null)
  }));
  assert.deepEqual(derived, []);
});

test('every derived line names the fact it came from', () => {
  const derived = deriveRequiredQualifications(baseFacts());
  assert.deepEqual(derived.map((d) => d.basis), ['sessionDates', 'location', 'workingHours']);
  for (const item of derived) assert.ok(item.text.length > 0);
});

test('derivation is deterministic', () => {
  const a = deriveRequiredQualifications(baseFacts());
  const b = deriveRequiredQualifications(baseFacts());
  assert.deepEqual(a, b);
});

test('generalizeLocation keeps city and district, drops the rest', () => {
  assert.equal(generalizeLocation('서울 성동구 성수이로 00, 가상캠퍼스 4층'), '서울 성동구 인근');
  assert.equal(generalizeLocation('서울시 내 교육장'), '서울 인근');
  assert.equal(generalizeLocation('경기 성남시 분당구 판교로 1'), '경기 성남시 인근');
  assert.equal(generalizeLocation('부산광역시 해운대구 센텀로'), '부산 해운대구 인근');
  assert.equal(generalizeLocation('제주특별자치도 제주시 첨단로'), '제주 제주시 인근');
});

test('generalizeLocation returns null rather than leaking an unrecognised address', () => {
  assert.equal(generalizeLocation('본사 지하 1층 대강당'), null);
  assert.equal(generalizeLocation('Zoom 온라인'), null);
  assert.equal(generalizeLocation(null), null);
  assert.equal(generalizeLocation(42), null);
});

test('the derived venue line uses the generalised form', () => {
  const derived = deriveRequiredQualifications(baseFacts({
    location: fact('서울 성동구 성수이로 00, 가상캠퍼스 4층')
  }));
  const venue = derived.find((d) => d.basis === 'location');
  assert.equal(venue.text, '서울 성동구 인근 교육장 출근 가능');
});

test('online courses derive no commute requirement', () => {
  const derived = deriveRequiredQualifications(baseFacts({ format: fact('온라인 실시간') }));
  assert.ok(!derived.some((d) => d.basis === 'location'));
});
