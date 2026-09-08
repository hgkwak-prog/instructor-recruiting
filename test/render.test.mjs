import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderJobPost, weekdayKo, formatDateKo, pendingMarkers, CLOSING_LINE
} from '../core/render/job-post.mjs';
import { baseFacts, fact, qual } from './fixtures.mjs';

/** 이모지 접두가 붙은 섹션 헤더 뒤의 본문 블록을 잘라낸다. */
function section(post, header) {
  return post.split(`${header}\n`)[1]?.split('\n\n')[0] ?? '';
}

test('weekday comes from the calendar, not from the model', () => {
  // The first shipped version wrote (월) for all three of these.
  assert.equal(weekdayKo('2026-09-01'), '화');
  assert.equal(weekdayKo('2026-09-08'), '화');
  assert.equal(weekdayKo('2026-09-15'), '화');
  assert.equal(formatDateKo('2026-09-01'), '2026년 9월 1일(화)');
  assert.equal(formatDateKo('2026-09-01', { weekday: false }), '2026년 9월 1일');
});

test('renders the [역할 모집] header and the fixed closing line', () => {
  // 2026-09 실사례 5건 기준 -- 상단 고정 문구("🗓️ 예상 업무 일정은 ~")는 어디에도 없었다.
  const post = renderJobPost(baseFacts());
  assert.ok(post.startsWith('*[보조강사 모집] AI 코딩 기초 교육*'));
  assert.ok(!post.includes('예상 업무 일정은'));
  assert.ok(post.endsWith(CLOSING_LINE));
});

test('every weekday in the rendered post is correct', () => {
  const post = renderJobPost(baseFacts());
  for (const [, y, m, d, weekday] of post.matchAll(/(\d{4})?년?\s*(\d{1,2})월 (\d{1,2})일\((.)\)/g)) {
    const iso = `${y ?? '2026'}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    assert.equal(weekday, weekdayKo(iso), `${iso} 요일이 틀렸습니다`);
  }
  assert.match(post, /2026년 9월 1일\(화\), 9월 8일\(화\), 9월 15일\(화\)/);
});

test('hour spec is computed, never restated', () => {
  const post = renderJobPost(baseFacts());
  assert.match(post, /\[하루 7시간 × 3일, 총 21시간\]/);
});

test('the customer is never named, even when disclosure is approved', () => {
  const hidden = renderJobPost(baseFacts());
  assert.match(hidden, /\*\[보조강사 모집\] AI 코딩 기초 교육\*/);
  assert.ok(!hidden.includes('A사'), '익명 라벨조차 공고에 나가지 않습니다');

  // 공개가 승인되어도 헤더에 넣지 않는다 -- 고객사는 공고에서 통째로 뺐다.
  const approved = renderJobPost(baseFacts({
    customerDisclosure: fact('approved', '운영 조건'),
    customerLabel: fact('모두컴퍼니', '운영 조건')
  }));
  assert.ok(!approved.includes('모두컴퍼니'), '고객사 실명이 공고에 나가면 안 됩니다');
});

test('the fee amount is never printed, even when the source states one', () => {
  const post = renderJobPost(baseFacts());
  assert.match(post, /• 강사료\(보조강사\) : 총 ______ 원 \(원천징수 후 지급\)/);
  assert.ok(!/\d{1,3}(,\d{3})+\s*원/.test(post), '공고에 금액이 찍히면 안 됩니다');
});

test('responsibilities get their own section', () => {
  const post = renderJobPost(baseFacts());
  assert.match(post, /\*담당 업무\*\n• 실습 중 수강생 개별 지원\n• 환경 설정 오류 대응/);
});

test('missing responsibilities fall back to the role standard set', () => {
  // 커리큘럼에 강사 업무가 적힌 경우가 드물어 매번 막히면 운영이 안 된다.
  const post = renderJobPost(baseFacts({ responsibilities: fact([]) }));
  assert.ok(!pendingMarkers(post).includes('담당 업무'));
  assert.match(post, /\*담당 업무\*\n• 실습 환경·계정 사전 점검/);
});

test('duties still show a marker when the role is unknown', () => {
  const post = renderJobPost(baseFacts({ responsibilities: fact([]), role: fact(null) }));
  assert.ok(pendingMarkers(post).includes('담당 업무'));
});

test('logistics qualifications are derived, and stay short', () => {
  const post = renderJobPost(baseFacts());
  assert.match(post, /• 전체 교육일\(3일\) 참여 가능/);
  assert.match(post, /• 서울 인근 교육장 출근 가능/);
  assert.match(post, /• 각 교육일 09:30-17:30 근무 가능/);
  assert.match(post, /• Python·Node\.js 기초 이해/);
  // 날짜 목록은 개요에 이미 있다. 자격에서 되풀이하지 않는다.
  assert.ok(!/참여 가능 \(2026년/.test(post));

  // 개요의 일정 줄은 날짜라 길 수밖에 없다. 길이를 재는 건 자격·업무 항목이다.
  for (const [title, header] of [
    ['담당 업무', '*담당 업무*'],
    ['강사 지원 자격', '✅ *강사 지원 자격*']
  ]) {
    for (const line of section(post, header).split('\n').filter((l) => l.startsWith('• '))) {
      assert.ok(line.length <= 45, `${title} 줄이 깁니다 (${line.length}자): ${line}`);
    }
  }
});

test('competence qualifications still block when absent', () => {
  const post = renderJobPost(baseFacts({ requiredQualifications: fact([]) }));
  assert.ok(pendingMarkers(post).includes('역량 조건'));
  assert.match(post, /전체 교육일\(3일\) 참여 가능/);
});

test('a proposed qualification renders the same as a sourced one', () => {
  // 지원자에게는 구분이 보이지 않는다. 구분은 검토 리포트의 몫이다.
  const post = renderJobPost(baseFacts({
    requiredQualifications: fact([qual('CS·VOC 업무 흐름 이해', false)])
  }));
  assert.match(post, /• CS·VOC 업무 흐름 이해/);
  assert.ok(!post.includes('제안'));
});

test('a separate 근무 시간 line appears only when it differs from class hours', () => {
  // 개요의 "교육 시간"과 자격의 "근무 가능"은 역할이 달라 둘 다 필요하다.
  // 중복으로 보아야 할 것은 교육 시간과 똑같은 별도 "근무 시간" 줄이다.
  const same = renderJobPost(baseFacts({ workingHours: fact('10:00-17:00') }));
  assert.match(same, /• 시간 : 10:00-17:00\n/, '같으면 한 번만 씁니다');
  assert.ok(!same.includes('교육 10:00-17:00 / 근무'));

  const differs = renderJobPost(baseFacts());
  assert.match(differs, /• 시간 : 교육 10:00-17:00 \/ 근무 09:30-17:30/);
});

test('the deadline keeps its time of day', () => {
  const post = renderJobPost(baseFacts());
  assert.match(post, /• 모집 마감 : 2026년 8월 25일\(화\) 18:00/);
  const noTime = renderJobPost(baseFacts({ deadlineTime: fact(null) }));
  assert.match(noTime, /• 모집 마감 : 2026년 8월 25일\(화\)\n/);
});

test('compensation amount is always left blank for the reviewer', () => {
  const post = renderJobPost(baseFacts());
  assert.match(post, /• 강사료\(보조강사\) : 총 ______ 원 \(원천징수 후 지급\)/);
});

test('travel expense note appears only when travel is confirmed', () => {
  const post = renderJobPost(baseFacts({ travelExpenseIncluded: fact(true, '운영 조건') }));
  assert.match(post, /\(원천징수 후 지급, 출장비 포함\)/);
});

test('preferred qualification section is omitted when none are sourced', () => {
  assert.ok(!renderJobPost(baseFacts()).includes('우대'));
  const withPreferred = renderJobPost(baseFacts({
    preferredQualifications: fact([qual('교육 보조 경험'), qual('AI 도구 사용 경험')])
  }));
  assert.match(withPreferred, /\*우대 사항\*\n• 교육 보조 경험/);
});

test('course objectives are published, but the day-by-day curriculum design is not', () => {
  // 2026-09 실사례에서 확인: 실제로 올라간 공고는 학습 목표를 밝힌다.
  // 목표 한 줄은 커리큘럼 설계가 아니라 "지원자가 뭘 갖추게 되는가"이므로 공개해도 된다.
  // 반면 일차별 설계(curriculumOutline)는 여전히 우리가 파는 상품이라 새면 안 된다.
  const post = renderJobPost(baseFacts());
  assert.match(post, /🎯 \*교육 목표\*\n• AI 코딩 도구로 실무 코드를 작성할 수 있다/);
  assert.ok(!post.includes('*교육 내용*'));
  assert.ok(!post.includes('하네스 엔지니어링'), '일차별 내용이 새면 안 됩니다');
  assert.ok(!post.includes('1일차'));
  // 지원자가 분야를 판단할 만큼은 나가야 한다 -- 여러 개일 때도 불릿으로 읽기 쉬워야 한다
  assert.match(post, /📖 \*주요 내용\*\n• AI 코딩 기초\n• Claude Code\n• MCP\n• Agentic Coding/);
});

test('objectives section is omitted when there is nothing to say', () => {
  const post = renderJobPost(baseFacts({ objectives: fact([]) }));
  assert.ok(!post.includes('*교육 목표*'));
});

test('the venue is generalised to city and district', () => {
  const post = renderJobPost(baseFacts({
    location: fact('서울 성동구 성수이로 00, 가상캠퍼스 4층')
  }));
  assert.match(post, /• 장소 : 서울 성동구 인근/);
  assert.ok(!post.includes('성수이로'), '정확한 주소가 새면 안 됩니다');
  assert.ok(!post.includes('4층'));
});

test('an unparseable venue is blocked rather than leaked verbatim', () => {
  const post = renderJobPost(baseFacts({ location: fact('본사 지하 1층 대강당') }));
  assert.ok(!post.includes('본사 지하 1층 대강당'), '원문을 그대로 흘리면 안 됩니다');
  assert.ok(pendingMarkers(post).includes('장소'));
});

test('online courses drop the venue line entirely', () => {
  const post = renderJobPost(baseFacts({ format: fact('온라인 실시간') }));
  assert.ok(!post.includes('• 장소'));
  assert.ok(!post.includes('교육장 출근 가능'));
});

test('practice environment survives -- the instructor needs it beforehand -- as bullets, capped at four', () => {
  const post = renderJobPost(baseFacts());
  assert.match(post, /\*실습 환경\*\n• 개인 노트북\n• Python 3\.11 이상\n• Node\.js 20 이상\n• 외부망 접속/);

  const many = renderJobPost(baseFacts({
    environmentConstraints: fact(['노트북', 'OS', '언어', '툴', '다섯 번째 항목'])
  }));
  assert.ok(!many.includes('다섯 번째 항목'), '방어적으로 4개까지만 보여줍니다');
});

test('missing values surface as visible markers instead of guesses', () => {
  const post = renderJobPost(baseFacts({
    applicationMethod: fact(null),
    location: fact(null),
    sessionDates: fact([])
  }));
  const pending = pendingMarkers(post);
  assert.ok(pending.includes('지원 방법'));
  assert.ok(pending.includes('장소'));
  assert.ok(pending.includes('교육 일정'));
  assert.ok(!/undefined|null|NaN/.test(post), '빈 값이 그대로 새어 나오면 안 됩니다');
});

test('no section is rendered empty', () => {
  const post = renderJobPost(baseFacts({ environmentConstraints: fact([]) }));
  assert.ok(!post.includes('*실습 환경*'));
});
