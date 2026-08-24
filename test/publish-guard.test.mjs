import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CompensationError,
  applyCompensationLine,
  buildCompensationLine,
  hasFeeLine,
  parseAmount
} from '../core/compensation.mjs';
import { checkPostText, checkWeekdays, weekdayOf } from '../core/publish-guard.mjs';

const post = (fee = '강사료(보조강사) : 총 ______ 원 (원천징수 후 지급)') => [
  '*AI 코딩 기초 교육 보조강사 모집*',
  '• 일정 : 2026년 9월 1일(화), 9월 8일(화), 9월 15일(화)',
  '',
  '*강사료*',
  fee
].join('\n');

// --- 금액 파싱 ---------------------------------------------------------------

test('사람이 적는 여러 형태를 받는다', () => {
  assert.equal(parseAmount('1,200,000'), 1_200_000);
  assert.equal(parseAmount('1200000'), 1_200_000);
  assert.equal(parseAmount('120만'), 1_200_000);
  assert.equal(parseAmount('1,200,000원'), 1_200_000);
  assert.equal(parseAmount(1_200_000), 1_200_000);
});

test('숫자가 아니면 받지 않는다', () => {
  for (const bad of ['협의', '', 'abc', null, undefined]) {
    assert.equal(parseAmount(bad), null, String(bad));
  }
});

// --- 강사료 줄 조립 ----------------------------------------------------------

test('시간당 단가를 받으면 코드가 곱하고 산식을 보여준다', () => {
  // 손으로 적으면 곱셈이 틀려도 아무도 모른다.
  const { line, total } = buildCompensationLine({
    mode: 'hourly', amount: '100,000', totalHours: 21, roleLabel: '보조강사'
  });
  assert.equal(total, 2_100_000);
  assert.equal(line, '강사료(보조강사) : 시간당 100,000원 × 21시간 = 총 2,100,000원 (원천징수 후 지급)');
});

test('총액을 직접 받을 수도 있다', () => {
  const { line, total, hourlyRate } = buildCompensationLine({
    mode: 'total', amount: '2,100,000', totalHours: 21, roleLabel: '주강사'
  });
  assert.equal(total, 2_100_000);
  assert.equal(hourlyRate, 100_000, '역산한 단가는 검토용으로 남긴다');
  assert.match(line, /^강사료\(주강사\) : 총 2,100,000원 \(원천징수 후 지급\)$/);
});

test('출장이 있으면 문구가 바뀐다', () => {
  const { line } = buildCompensationLine({
    mode: 'total', amount: 1_000_000, roleLabel: '보조강사', travelExpenseIncluded: true
  });
  assert.match(line, /출장비 포함/);
});

test('총 시수가 없으면 시간당 단가로 계산하지 않는다', () => {
  // 모르는 수를 0이나 1로 가정해 곱하면 조용히 틀린 금액이 나간다.
  assert.throws(
    () => buildCompensationLine({ mode: 'hourly', amount: 100_000, totalHours: null, roleLabel: '보조강사' }),
    /총액으로 입력/
  );
});

test('읽을 수 없는 금액은 거부한다', () => {
  assert.throws(
    () => buildCompensationLine({ mode: 'total', amount: '협의 후 결정', roleLabel: '보조강사' }),
    CompensationError
  );
});

// --- 본문에 끼워 넣기 ---------------------------------------------------------

test('빈칸 줄을 코드가 만든 줄로 갈아끼운다', () => {
  const { line } = buildCompensationLine({ mode: 'total', amount: 1_000_000, roleLabel: '보조강사' });
  const filled = applyCompensationLine(post(), line);
  assert.ok(!filled.includes('______'));
  assert.ok(filled.includes('총 1,000,000원'));
});

test('강사료 줄이 없으면 조용히 넘기지 않는다', () => {
  assert.ok(!hasFeeLine('*모집*\n내용만 있음'));
  assert.throws(() => applyCompensationLine('*모집*\n내용만 있음', 'x'), /강사료 줄을 찾지 못했/);
});

// --- 게시 직전 검사 ----------------------------------------------------------

test('빈칸이 남으면 게시할 수 없다', () => {
  // 이것이 원래 구멍이었다. `______`는 [확인 필요]가 아니라서 게이트를 그냥 지났다.
  const { errors, postable } = checkPostText(post());
  assert.equal(postable, false);
  assert.ok(errors.some((e) => e.includes('빈칸')));
});

test('[확인 필요]가 남아도 게시할 수 없다', () => {
  const { errors } = checkPostText('*모집*\n• 장소 : [확인 필요: 교육장 주소]\n강사료(보조강사) : 총 100,000원');
  assert.ok(errors.some((e) => e.includes('교육장 주소')));
});

test('요일이 틀리면 알리되 막지는 않는다', () => {
  // 공고 실수는 사람이 내고 사람이 책임진다. 기계가 판단을 대신할 자리가 아니다.
  // 다만 눈앞에는 띄워 준다 — 그래야 "못 찾은 사람 책임"이 성립한다.
  const edited = post('강사료(보조강사) : 총 1,000,000원')
    .replace('9월 8일(화)', '9월 8일(월)');
  const { errors, warnings, postable } = checkPostText(edited, { expectedTotal: 1_000_000, year: 2026 });
  assert.equal(postable, true, '요일 실수로 게시를 막지는 않습니다');
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('9월 8일(월)') && w.includes('화요일')));
});

test('요일이 맞으면 통과한다', () => {
  const clean = post('강사료(보조강사) : 총 1,000,000원');
  const { postable } = checkPostText(clean, { expectedTotal: 1_000_000, year: 2026 });
  assert.equal(postable, true);
});

test('요일 계산 자체를 확인한다', () => {
  assert.equal(weekdayOf(2026, 9, 1), '화');
  assert.equal(weekdayOf(2026, 9, 8), '화');
  assert.deepEqual(checkWeekdays('2026년 9월 1일(화)'), []);
  assert.equal(checkWeekdays('2026년 9월 1일(수)').length, 1);
});

test('비공개 고객사명이 보이면 경고한다', () => {
  const { warnings, postable } = checkPostText(
    '*모집*\n삼성전자 임직원 대상\n강사료(보조강사) : 총 100,000원',
    { expectedTotal: 100_000, customerLabel: '삼성전자', customerHidden: true }
  );
  assert.equal(postable, true);
  assert.ok(warnings.some((w) => w.includes('삼성전자')));
});

test('공개가 승인됐으면 고객사명이 있어도 된다', () => {
  const { postable } = checkPostText(
    '*모집*\n삼성전자 임직원 대상\n강사료(보조강사) : 총 100,000원',
    { expectedTotal: 100_000, customerLabel: '삼성전자', customerHidden: false }
  );
  assert.equal(postable, true);
});

test('강사료 외의 금액은 경고한다 — 막지는 않는다', () => {
  // `왕복 교통비 50,000원 지급`처럼 정당한 금액도 걸리기 때문이다.
  // 원문의 고객사 예산을 옮겨 적었는지는 사람이 본다.
  const { warnings, postable } = checkPostText(
    '*모집*\n왕복 교통비 50,000원 지급\n강사료(보조강사) : 총 1,000,000원',
    { expectedTotal: 1_000_000 }
  );
  assert.equal(postable, true);
  assert.ok(warnings.some((w) => w.includes('50,000')));
  assert.ok(!warnings.some((w) => w.includes('1,000,000')), '승인한 금액은 문제 삼지 않아야 합니다');
});

test('시간당 단가와 총액이 함께 적힌 산식을 허용한다', () => {
  const { postable } = checkPostText(
    '강사료(보조강사) : 시간당 100,000원 × 21시간 = 총 2,100,000원',
    { expectedTotal: 2_100_000, hourlyRate: 100_000 }
  );
  assert.equal(postable, true);
});

test('승인된 강사료가 없는데 금액이 있으면 경고한다', () => {
  const { warnings, postable } = checkPostText('강사료(보조강사) : 총 3,000,000원');
  assert.equal(postable, true);
  assert.ok(warnings.some((w) => w.includes('승인된 강사료가 없는데')));
});

test('막는 것은 미완성뿐이다', () => {
  // 등급 구분 자체를 고정한다. 나중에 무심코 경고를 에러로 올리지 못하게.
  const 미완성 = checkPostText('강사료(보조강사) : 총 ______ 원\n[확인 필요: 장소]');
  assert.equal(미완성.postable, false);
  assert.equal(미완성.errors.length, 2);

  const 실수투성이 = checkPostText(
    '2026년 9월 1일(수) 진행\n삼성전자 대상\n교통비 50,000원\n강사료(보조강사) : 총 100,000원',
    { expectedTotal: 100_000, customerLabel: '삼성전자', year: 2026 }
  );
  assert.equal(실수투성이.postable, true, '실수가 많아도 사람이 판단한다');
  assert.equal(실수투성이.errors.length, 0);
  assert.ok(실수투성이.warnings.length >= 3);
});

test('빈 본문은 게시할 수 없다', () => {
  assert.equal(checkPostText('   ').postable, false);
  assert.equal(checkPostText(null).postable, false);
});
