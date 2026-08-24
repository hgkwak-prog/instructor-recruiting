/**
 * 강사료 줄을 만든다.
 *
 * 원문(커리큘럼·제안서)의 금액은 **고객사 예산**이지 강사에게 제시할 금액이 아니다.
 * 그래서 facts에는 금액 필드가 아예 없고, 여기 들어오는 값은 오로지 담당자가
 * 승인 화면에서 직접 친 것이다. 모델이 만질 수 없다.
 *
 * 계산은 코드가 한다. 시간당 단가를 받으면 확정된 총 시수를 곱하고 **산식을 보여준다** —
 * 지원자가 검산할 수 있어야 하고, 우리도 나중에 왜 이 금액인지 알 수 있어야 한다.
 */

const FEE_LINE = /^강사료\(.*?\)\s*:.*$/m;

export class CompensationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CompensationError';
  }
}

/** "1,200,000" · "120만" · "1200000" → 1200000 */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : null;
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[\s원]/g, '').replace(/,/g, '');
  if (!cleaned) return null;

  const man = /^(\d+(?:\.\d+)?)만$/.exec(cleaned);
  if (man) return Math.round(Number(man[1]) * 10_000);

  if (!/^\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function formatWon(amount) {
  return `${amount.toLocaleString('ko-KR')}원`;
}

/**
 * @param {object} input
 * @param {'hourly'|'total'} input.mode
 * @param {string|number} input.amount   시간당 단가 또는 총액
 * @param {number|null} input.totalHours 확정된 총 시수 (hourly일 때 필수)
 * @param {string} input.roleLabel       '주강사' | '보조강사'
 * @param {boolean} input.travelExpenseIncluded
 */
export function buildCompensationLine({
  mode, amount, totalHours, roleLabel, travelExpenseIncluded = false
}) {
  const value = parseAmount(amount);
  if (value === null || value <= 0) {
    throw new CompensationError(`금액을 읽지 못했습니다: ${amount}. 숫자로 적어 주세요 (예: 1,200,000 또는 120만).`);
  }

  const suffix = travelExpenseIncluded
    ? '(원천징수 후 지급, 출장비 포함)'
    : '(원천징수 후 지급)';

  if (mode === 'hourly') {
    if (!Number.isFinite(totalHours) || totalHours <= 0) {
      throw new CompensationError(
        '총 시수가 확정되지 않아 시간당 단가로 계산할 수 없습니다. 총액으로 입력하세요.'
      );
    }
    const total = Math.round(value * totalHours);
    // 산식을 남긴다. 모델이 아니라 코드가 곱했다는 사실이 여기서 드러난다.
    return {
      line: `강사료(${roleLabel}) : 시간당 ${formatWon(value)} × ${totalHours}시간 = 총 ${formatWon(total)} ${suffix}`,
      total,
      hourlyRate: value
    };
  }

  if (mode === 'total') {
    return {
      line: `강사료(${roleLabel}) : 총 ${formatWon(value)} ${suffix}`,
      total: value,
      hourlyRate: Number.isFinite(totalHours) && totalHours > 0
        ? Math.round(value / totalHours)
        : null
    };
  }

  throw new CompensationError(`알 수 없는 강사료 입력 방식입니다: ${mode}`);
}

/**
 * 공고 본문의 강사료 줄을 갈아끼운다.
 *
 * 담당자가 본문을 자유롭게 고쳤더라도 **금액 줄만은 코드가 만든 것을 넣는다.**
 * 손으로 적으면 곱셈이 틀려도 아무도 모른다.
 */
export function applyCompensationLine(post, line) {
  if (!FEE_LINE.test(post)) {
    throw new CompensationError(
      '본문에서 강사료 줄을 찾지 못했습니다. `강사료(보조강사) : …` 형태의 줄이 있어야 합니다.'
    );
  }
  return post.replace(FEE_LINE, line);
}

export function hasFeeLine(post) {
  return FEE_LINE.test(post);
}
