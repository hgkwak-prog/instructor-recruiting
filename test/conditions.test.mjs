import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConditions, CONDITION_TO_FACT } from '../core/conditions.mjs';
import { verifyResult } from '../core/verify.mjs';
import { deriveResponsibilities, DEFAULT_RESPONSIBILITIES } from '../core/derive.mjs';
import { baseFacts, baseResult, fact } from './fixtures.mjs';

test('fills a fact the model left null from the operating conditions', () => {
  // 실제 사례: 커리큘럼에 시간표가 없어 dailySchedule이 비었고, 공고에 시간 줄이 사라졌다.
  const facts = baseFacts({ dailySchedule: fact(null), workingHours: fact(null) });
  const { facts: filled, applied } = { facts, applied: null };
  const result = applyConditions(facts, { dailySchedule: '10:00-17:00', workingHours: '09:30-17:30' });
  assert.deepEqual(result.filled, ['dailySchedule', 'workingHours']);
  assert.equal(result.facts.dailySchedule.value, '10:00-17:00');
  assert.match(result.facts.dailySchedule.evidence, /운영 조건 dailySchedule/);
});

test('never overwrites a value the model already extracted', () => {
  const result = applyConditions(baseFacts(), { dailySchedule: '09:00-18:00' });
  assert.deepEqual(result.filled, []);
  assert.equal(result.facts.dailySchedule.value, '10:00-17:00', '문서 값이 유지돼야 합니다');
});

test('normalises English aliases while filling', () => {
  const facts = baseFacts({ role: fact(null), customerDisclosure: fact(null) });
  const result = applyConditions(facts, { instructorRole: 'assistant', customerDisclosure: 'private' });
  assert.equal(result.facts.role.value, '보조강사');
  assert.equal(result.facts.customerDisclosure.value, 'hidden');
});

test('ignores conditions that are absent or null', () => {
  const facts = baseFacts({ deadline: fact(null) });
  assert.deepEqual(applyConditions(facts, { deadline: null }).filled, []);
  assert.deepEqual(applyConditions(facts, {}).filled, []);
});

test('does not touch course content', () => {
  for (const factKey of Object.values(CONDITION_TO_FACT)) {
    assert.ok(
      !['objectives', 'curriculumOutline', 'topics', 'audience', 'courseTitle'].includes(factKey),
      `${factKey}는 운영 조건으로 덮어쓰면 안 됩니다`
    );
  }
});

test('a filled condition survives verification', () => {
  const result = baseResult();
  result.facts.dailySchedule = fact(null);
  const conditions = { customerDisclosure: 'hidden', dailySchedule: '10:00-17:00' };
  result.facts = applyConditions(result.facts, conditions).facts;
  const { errors, slackJobPost } = verifyResult({ result, conditions });
  assert.deepEqual(errors, []);
  assert.match(slackJobPost, /• 시간 : 교육 10:00-17:00 \/ 근무 09:30-17:30/);
});

test('standard duties fill in when the source states none', () => {
  // 커리큘럼은 고객사용 문서라 강사 업무가 적혀 있지 않은 게 보통이다.
  const facts = baseFacts({ responsibilities: fact([]) });
  const duties = deriveResponsibilities(facts);
  assert.equal(duties.fromDefaults, true);
  assert.deepEqual(duties.items, DEFAULT_RESPONSIBILITIES['보조강사']);
});

test('stated duties always win over the standard set', () => {
  const duties = deriveResponsibilities(baseFacts());
  assert.equal(duties.fromDefaults, false);
  assert.deepEqual(duties.items, ['실습 중 수강생 개별 지원', '환경 설정 오류 대응']);
});

test('the lead instructor has a different standard set', () => {
  const duties = deriveResponsibilities(baseFacts({
    role: fact('주강사', '운영 조건'), responsibilities: fact([])
  }));
  assert.deepEqual(duties.items, DEFAULT_RESPONSIBILITIES['주강사']);
  assert.notDeepEqual(DEFAULT_RESPONSIBILITIES['주강사'], DEFAULT_RESPONSIBILITIES['보조강사']);
});

test('missing duties no longer block the posting, but the reviewer is told', () => {
  const result = baseResult();
  result.facts.responsibilities = fact([]);
  const { errors, warnings, pendingMarkers, postable, slackJobPost } =
    verifyResult({ result, conditions: { customerDisclosure: 'hidden' } });
  assert.deepEqual(errors, []);
  assert.ok(!pendingMarkers.includes('담당 업무'), '표준 세트로 채워져 막히지 않습니다');
  assert.equal(postable, true);
  assert.ok(warnings.some((w) => w.includes('표준 세트')));
  assert.match(slackJobPost, /\*담당 업무\*\n• 실습 환경·계정 사전 점검/);
});

test('an unknown role leaves duties empty rather than guessing', () => {
  const duties = deriveResponsibilities(baseFacts({
    role: fact(null), responsibilities: fact([])
  }));
  assert.deepEqual(duties.items, []);
  assert.equal(duties.fromDefaults, false);
});
