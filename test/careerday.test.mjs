import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CareerdayDraftError,
  buildCareerdayDraft,
  buildCareerdayFormPlan,
  extractRegion
} from '../core/render/careerday.mjs';

const fact = (value) => ({ value, evidence: null });

function facts(overrides = {}) {
  return {
    courseTitle: fact('AI 코딩 기초 교육'),
    role: fact('보조강사'),
    location: fact('서울 강남구 인근'),
    sessionDates: fact(['2026-09-15', '2026-09-01', '2026-09-08']),
    headcount: fact(1),
    deadline: fact('2026-08-25'),
    topics: fact(['Claude Code 활용', 'MCP 연동', 'Agentic Coding']),
    ...overrides
  };
}

const jobPost = '*AI 코딩 기초 교육 보조강사 모집*\n강사료(보조강사) : 총 2,100,000원';
const compensation = { mode: 'hourly', total: 2_100_000, hourlyRate: 100_000 };
const publishingInput = { venueAddress: '서울시 강남구 테헤란로 123 5층' };

function draft(overrides = {}) {
  return buildCareerdayDraft({
    runId: 'run-1', facts: facts(), jobPost, compensation, publishingInput, ...overrides
  });
}

// --- 사실에서 조립한다 ---------------------------------------------------------

test('날짜는 문자열을 되읽지 않고 sessionDates에서 온다', () => {
  // 옛 코드는 완성된 공고 문자열을 정규식으로 긁었다. 사실은 facts에 있다.
  const result = draft();
  assert.equal(result.workStartDate, '2026-09-01');
  assert.equal(result.workEndDate, '2026-09-15', '정렬해서 첫날과 마지막 날을 잡아야 합니다');
});

test('보상금은 담당자가 승인한 강사료다', () => {
  const result = draft();
  assert.equal(result.compensation.totalAmount, 2_100_000);
  assert.equal(result.compensation.count, 3, '회차 수가 보상 기간이 됩니다');
  assert.equal(result.compensation.unit, '일');
});

test('facts에 금액 필드가 없으므로 고객사 예산이 흘러들 경로가 없다', () => {
  // 커리큘럼 원문의 금액 = 고객사 예산. 강사 제시 금액과 다르다.
  const result = buildCareerdayDraft({
    runId: 'r', facts: facts(), jobPost, compensation: null, publishingInput
  });
  assert.equal(result.compensation.totalAmount, null);
  assert.ok(result.missingFields.some((m) => m.field === 'compensation.totalAmount'));
});

test('업무 내용은 승인된 공고 본문을 그대로 쓴다', () => {
  // 따로 조립하면 유지할 글이 둘이 되고 틀릴 기회도 둘이 된다.
  assert.equal(draft().description, jobPost);
});

test('공고 본문이 없으면 만들지 않는다', () => {
  assert.throws(
    () => buildCareerdayDraft({ runId: 'r', facts: facts(), jobPost: '  ', compensation }),
    /먼저 슬랙에 게시/
  );
});

// --- 상세주소: 슬랙과 커리어데이가 갈리는 지점 ----------------------------------

test('상세주소는 담당자 입력값이지 facts가 아니다', () => {
  // 슬랙 공고에는 `서울 강남구 인근`만 나가지만 커리어데이 폼은 상세주소를 받는다.
  const result = draft();
  assert.equal(result.detailedAddress, '서울시 강남구 테헤란로 123 5층');
  assert.equal(result.region, '서울');
});

test('상세주소를 안 넣으면 빠진 값으로 잡힌다 — 조용히 통과시키지 않는다', () => {
  const result = buildCareerdayDraft({
    runId: 'r', facts: facts(), jobPost, compensation, publishingInput: {}
  });
  assert.ok(result.missingFields.some((m) => m.field === 'detailedAddress'));
});

test('업무 지역을 커리어데이 어휘로 맞춘다', () => {
  assert.equal(extractRegion('서울 성동구 인근'), '서울');
  assert.equal(extractRegion('충청남도 천안시'), '충남', '정식 명칭도 축약형으로 바꿉니다');
  assert.equal(extractRegion('경기 성남시 분당구'), '경기');
  assert.equal(extractRegion('온라인'), null);
  assert.equal(extractRegion(null), null);
});

// --- 모순은 던지고, 빈 값은 돌려준다 --------------------------------------------

test('마감일이 시작일보다 늦으면 던진다', () => {
  // 사람이 고치기 전에는 폼을 열 이유가 없다.
  assert.throws(
    () => draft({ publishingInput: { ...publishingInput, deadline: '2026-09-10' } }),
    /마감일은 예상 업무 시작일보다 이전/
  );
});

test('모집 인원이 0이면 던진다', () => {
  assert.throws(() => draft({ facts: facts({ headcount: fact(0) }) }), CareerdayDraftError);
});

test('빠진 값은 목록으로 돌려준다 — 모달에서 채우면 된다', () => {
  const result = buildCareerdayDraft({
    runId: 'r',
    facts: facts({ deadline: fact(null), headcount: fact(null) }),
    jobPost,
    compensation,
    publishingInput: {}
  });
  const missing = result.missingFields.map((m) => m.field);
  assert.ok(missing.includes('recruitmentDeadline'));
  assert.ok(missing.includes('headcount'));
  assert.ok(missing.includes('detailedAddress'));
});

// --- 태그 --------------------------------------------------------------------

test('주제 키워드가 그대로 태그가 된다', () => {
  const tags = draft().tags;
  assert.ok(tags.includes('보조강사'));
  assert.ok(tags.includes('MCP 연동'));
});

test('문장형 주제는 태그로 쓰지 않는다', () => {
  const long = 'AI 코딩 도구를 활용한 업무 자동화 전반에 대한 이해와 실습';
  const tags = draft({ facts: facts({ topics: fact([long, '짧은주제']) }) }).tags;
  assert.ok(!tags.includes(long));
  assert.ok(tags.includes('짧은주제'));
});

// --- 폼 계획 ------------------------------------------------------------------

test('폼 계획은 문자열로 바꾼다', () => {
  const plan = buildCareerdayFormPlan(draft());
  assert.equal(plan.headcount, '1');
  assert.equal(plan.compensation.totalAmount, '2100000');
  assert.equal(plan.compensation.count, '3');
  assert.equal(plan.vatIncluded, undefined);
  assert.equal(plan.compensation.vatIncluded, false);
});

test('빠진 값이 있으면 폼을 열지 않는다', () => {
  const incomplete = buildCareerdayDraft({
    runId: 'r', facts: facts(), jobPost, compensation, publishingInput: {}
  });
  assert.throws(() => buildCareerdayFormPlan(incomplete), /상세 주소/);
});
