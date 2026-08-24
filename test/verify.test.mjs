import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyResult } from '../core/verify.mjs';
import { baseResult, baseFacts, fact, qual } from './fixtures.mjs';

const clean = { customerDisclosure: 'hidden' };

test('a complete result is postable', () => {
  const { errors, postable, pendingMarkers } = verifyResult({ result: baseResult(), conditions: clean });
  assert.deepEqual(errors, []);
  assert.deepEqual(pendingMarkers, []);
  assert.equal(postable, true);
});

test('blocks arithmetic that does not reconcile', () => {
  const result = baseResult();
  result.facts.totalHours = fact(28);
  const { errors } = verifyResult({ result, conditions: clean });
  assert.ok(errors.some((e) => e.includes('총 시간 불일치')));
});

test('blocks an impossible calendar date', () => {
  const result = baseResult();
  result.facts.sessionDates = fact(['2026-02-30']);
  const { errors } = verifyResult({ result, conditions: clean });
  assert.ok(errors.some((e) => e.includes('실재하지 않는 날짜')));
});

test('blocks duplicate session dates', () => {
  const result = baseResult();
  result.facts.sessionDates = fact(['2026-09-01', '2026-09-01']);
  result.facts.totalHours = fact(14);
  const { errors } = verifyResult({ result, conditions: clean });
  assert.ok(errors.some((e) => e.includes('중복된 날짜')));
});

test('blocks a deadline that falls after the course starts', () => {
  const result = baseResult();
  result.facts.deadline = fact('2026-09-10');
  const { errors } = verifyResult({ result, conditions: clean });
  assert.ok(errors.some((e) => e.includes('첫 교육일')));
});

test('blocks a fact with no evidence', () => {
  const result = baseResult();
  result.facts.location = { value: '강남역 인근', evidence: null };
  const { errors } = verifyResult({ result, conditions: clean });
  assert.ok(errors.some((e) => e.includes('facts.location')));
});

test('operating conditions outrank the model', () => {
  const result = baseResult();
  result.facts.headcount = fact(3);
  result.facts.role = fact('주강사', '운영 조건');
  const { errors } = verifyResult({
    result,
    conditions: { customerDisclosure: 'hidden', headcount: 1, instructorRole: '보조강사' }
  });
  assert.ok(errors.some((e) => e.includes('headcount 불일치')));
  assert.ok(errors.some((e) => e.includes('role 불일치')));
});

test('blocks a real customer name while disclosure is hidden', () => {
  const result = baseResult();
  result.facts.customerLabel = fact('모두컴퍼니', '제안서');
  const { errors } = verifyResult({
    result,
    conditions: { customerDisclosure: 'hidden', customerName: '모두컴퍼니' }
  });
  assert.ok(errors.some((e) => e.includes('실명')));
});

test('blocks internal budget language leaking into the facts', () => {
  const result = baseResult();
  result.facts.requiredQualifications = fact([qual('내부 예산 상한 내 협의 가능한 분')]);
  const { errors } = verifyResult({ result, conditions: clean });
  assert.ok(errors.some((e) => e.includes('내부 예산')));
});

test('flags a proposed qualification so the reviewer checks it', () => {
  const result = baseResult();
  result.facts.requiredQualifications = fact([qual('AI 코딩 도구 사용 경험', false)]);
  const { warnings } = verifyResult({ result, conditions: clean });
  assert.ok(warnings.some((w) => w.includes('제안된 자격')));
});

test('flags requirements too heavy for an assistant instructor', () => {
  const result = baseResult();
  result.facts.requiredQualifications = fact([qual('분산 시스템 아키텍처 설계 경험')]);
  const { warnings } = verifyResult({ result, conditions: clean });
  assert.ok(warnings.some((w) => w.includes('과한 요건')));
});

test('a blocking gap makes the run non-postable', () => {
  const result = baseResult();
  result.facts.applicationMethod = fact(null);
  result.missingFields = [{ field: 'applicationMethod', blocking: true, question: '지원 방법은?' }];
  const { errors, postable, pendingMarkers } = verifyResult({ result, conditions: clean });
  assert.deepEqual(errors, []);
  assert.equal(postable, false, '지원 경로 없이 게시 가능이면 안 됩니다');
  assert.ok(pendingMarkers.includes('지원 방법'));
});

test('declared conflicts always block', () => {
  const result = baseResult();
  result.conflicts = [{ field: 'totalHours', values: ['21', '24'], note: '문서 내 총 시간이 다릅니다' }];
  const { errors } = verifyResult({ result, conditions: clean });
  assert.ok(errors.some((e) => e.includes('충돌: totalHours')));
});

test('the verified post is the rendered one', () => {
  const { slackJobPost } = verifyResult({ result: baseResult(), conditions: clean });
  assert.ok(slackJobPost.includes('2026년 9월 1일(화)'));
  assert.ok(slackJobPost.endsWith('많은 연락 부탁드립니다. 감사합니다.'));
});

test('verification never mutates the input facts', () => {
  const result = baseResult();
  const before = JSON.stringify(result);
  verifyResult({ result, conditions: clean });
  assert.equal(JSON.stringify(result), before);
});

test('fixtures cover every schema fact key', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const schema = JSON.parse(readFileSync(
    join(import.meta.dirname, '..', 'schemas', 'recruitment-result.schema.json'), 'utf8'
  ));
  assert.deepEqual(
    Object.keys(baseFacts()).sort(),
    Object.keys(schema.properties.facts.properties).sort()
  );
});

test('blocks a fee amount in a qualification line', () => {
  // 커리큘럼은 고객사 문서다. 거기 적힌 금액이 강사 공고로 새면 안 된다.
  const result = baseResult();
  result.facts.requiredQualifications = fact([qual('일 120,000원 조건 수용 가능한 분')]);
  const { errors } = verifyResult({ result, conditions: clean });
  assert.ok(errors.some((e) => e.includes('금액')), '금액 누출이 차단돼야 합니다');
});

test('blocks a fee amount hidden in responsibilities', () => {
  const result = baseResult();
  result.facts.responsibilities = fact(['실습 지원 (일 120,000원)']);
  const { errors } = verifyResult({ result, conditions: clean });
  assert.ok(errors.some((e) => e.includes('responsibilities')));
});

test('warns rather than blocks when money appears in course content', () => {
  // 금융 교육이라면 커리큘럼 본문에 금액이 정당하게 나올 수 있다.
  const result = baseResult();
  result.facts.curriculumOutline = fact([
    { label: '1일차', content: '월 3,000,000원 예산 시나리오 분석', kind: '실습' }
  ]);
  result.facts.hoursPerSession = fact(7);
  result.facts.totalHours = fact(21);
  const { errors, warnings } = verifyResult({ result, conditions: clean });
  assert.ok(!errors.some((e) => e.includes('금액')), '교육 내용의 금액은 차단하지 않습니다');
  assert.ok(warnings.some((w) => w.includes('금액')));
});

test('the rendered post never contains a currency figure', () => {
  const { slackJobPost } = verifyResult({ result: baseResult(), conditions: clean });
  assert.ok(!/\d{1,3}(,\d{3})+\s*원/.test(slackJobPost));
});

test('all-proposed qualifications need no field-level evidence', () => {
  // 제안에는 인용할 원문이 없다. 근거를 요구하면 제안 자체가 불가능해진다.
  const result = baseResult();
  result.facts.requiredQualifications = {
    value: [qual('ChatGPT 사용에 능숙', false), qual('CS 업무 흐름 이해', false)],
    evidence: null
  };
  const { errors } = verifyResult({ result, conditions: clean });
  assert.deepEqual(errors, []);
});

test('a sourced qualification still requires evidence', () => {
  const result = baseResult();
  result.facts.requiredQualifications = {
    value: [qual('Python 기초 이해', true)],
    evidence: null
  };
  const { errors } = verifyResult({ result, conditions: clean });
  assert.ok(errors.some((e) => e.includes('requiredQualifications')));
});

test('a mix of sourced and proposed requires evidence for the sourced one', () => {
  const result = baseResult();
  result.facts.requiredQualifications = {
    value: [qual('Python 기초 이해', true), qual('CS 업무 흐름 이해', false)],
    evidence: null
  };
  assert.ok(verifyResult({ result, conditions: clean }).errors.some((e) => e.includes('evidence')));

  result.facts.requiredQualifications.evidence = '커리큘럼 실습 환경';
  assert.deepEqual(verifyResult({ result, conditions: clean }).errors, []);
});

test('other fields still require evidence when non-empty', () => {
  const result = baseResult();
  result.facts.topics = { value: ['AI 코딩'], evidence: null };
  assert.ok(verifyResult({ result, conditions: clean }).errors.some((e) => e.includes('facts.topics')));
});
