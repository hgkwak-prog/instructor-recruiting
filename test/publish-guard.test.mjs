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

test('사람이 고친 뒤에도 요일이 틀리면 막는다', () => {
  // 이 프로젝트가 존재하는 이유가 이 버그다. 본문 편집을 열었으니 사람도 낼 수 있다.
  const edited = post('강사료(보조강사) : 총 1,000,000원')
    .replace('9월 8일(화)', '9월 8일(월)');
  const { errors } = checkPostText(edited, { expectedTotal: 1_000_000, year: 2026 });
  assert.ok(errors.some((e) => e.includes('9월 8일(월)') && e.includes('화요일')));
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

test('비공개 고객사명이 본문에 있으면 막는다', () => {
  const { errors } = checkPostText(
    '*모집*\n삼성전자 임직원 대상\n강사료(보조강사) : 총 100,000원',
    { expectedTotal: 100_000, customerLabel: '삼성전자', customerHidden: true }
  );
  assert.ok(errors.some((e) => e.includes('삼성전자')));
});

test('공개가 승인됐으면 고객사명이 있어도 된다', () => {
  const { postable } = checkPostText(
    '*모집*\n삼성전자 임직원 대상\n강사료(보조강사) : 총 100,000원',
    { expectedTotal: 100_000, customerLabel: '삼성전자', customerHidden: false }
  );
  assert.equal(postable, true);
});

test('승인한 금액과 다른 금액이 본문에 있으면 막는다', () => {
  // 원문의 고객사 예산을 손으로 옮겨 적는 경로를 막는 것이 목적이다.
  const { errors } = checkPostText(
    '*모집*\n총 예산 5,000,000원 규모\n강사료(보조강사) : 총 1,000,000원',
    { expectedTotal: 1_000_000 }
  );
  assert.ok(errors.some((e) => e.includes('5,000,000')));
  assert.ok(!errors.some((e) => e.includes('1,000,000원.')), '승인한 금액은 문제 삼지 않아야 합니다');
});

test('시간당 단가와 총액이 함께 적힌 산식을 허용한다', () => {
  const { postable } = checkPostText(
    '강사료(보조강사) : 시간당 100,000원 × 21시간 = 총 2,100,000원',
    { expectedTotal: 2_100_000, hourlyRate: 100_000 }
  );
  assert.equal(postable, true);
});

test('승인된 강사료가 없는데 금액이 있으면 막는다', () => {
  const { errors } = checkPostText('강사료(보조강사) : 총 3,000,000원');
  assert.ok(errors.some((e) => e.includes('승인된 강사료가 없는데')));
});

test('빈 본문은 게시할 수 없다', () => {
  assert.equal(checkPostText('   ').postable, false);
  assert.equal(checkPostText(null).postable, false);
});
