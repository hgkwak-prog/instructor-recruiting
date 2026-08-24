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
    totalHours: fact(21),
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
});

test('커리어데이가 권하는 시간 단위를 1순위로 쓴다', () => {
  // 화면이 직접 권한다: "1개월에 300,000원"보다 "12시간에 300,000원".
  // 우리는 확정 시수를 갖고 있으니 그 권고에 정확히 맞출 수 있다.
  const result = draft();
  assert.equal(result.compensation.unit, '시간');
  assert.equal(result.compensation.count, 21);
});

test('단위 후보는 횟수와 짝으로 준비된다', () => {
  // 단위만 갈아끼우고 숫자를 두면 21개월이 된다. 짝으로 움직여야 한다.
  const candidates = draft().compensation.unitCandidates;
  assert.deepEqual(candidates, [
    { unit: '시간', count: 21 },
    { unit: '일', count: 3 },
    { unit: '개월', count: 1 }
  ]);
});

test('총 시수를 모르면 일 단위로 내려간다', () => {
  const result = draft({ facts: facts({ totalHours: fact(null) }) });
  assert.equal(result.compensation.unit, '일');
  assert.equal(result.compensation.count, 3);
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

test('상세주소가 없어도 폼은 열린다 — 커리어데이에서 (선택)이다', () => {
  // 2026-08-24 화면 확인: `상세 주소 입력하기 (선택)` 링크를 눌러야 나타나고
  // 자동입력 대상도 아니다. 필수로 걸면 있지도 않은 값 때문에 폼이 안 열린다.
  const result = buildCareerdayDraft({
    runId: 'r', facts: facts(), jobPost, compensation, publishingInput: {}
  });
  assert.ok(!result.missingFields.some((m) => m.field === 'detailedAddress'));
  assert.doesNotThrow(() => buildCareerdayFormPlan(result));
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
  assert.equal(plan.compensation.count, '21');
  assert.equal(plan.vatIncluded, undefined);
  assert.equal(plan.compensation.vatIncluded, false);
});

test('빠진 값이 있으면 폼을 열지 않는다', () => {
  const incomplete = buildCareerdayDraft({
    runId: 'r', facts: facts({ headcount: fact(null) }), jobPost, compensation, publishingInput
  });
  assert.throws(() => buildCareerdayFormPlan(incomplete), /모집 인원/);
});
