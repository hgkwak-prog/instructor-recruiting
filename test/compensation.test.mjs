import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CompensationError,
  applyCompensationLine,
  buildCompensationLine,
  hasFeeLine,
  parseAmount
} from '../core/compensation.mjs';

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
