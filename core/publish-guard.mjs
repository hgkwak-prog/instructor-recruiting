/**
 * 게시 직전, **나가기로 한 그 글자 그대로**를 검사한다.
 *
 * 왜 이게 따로 있나. 원래 검산(`verify.mjs`)은 facts를 본다. "코드가 facts에서
 * 조립했으니 본문도 맞다"가 성립했기 때문이다. 그런데 담당자가 본문을 손으로
 * 고칠 수 있게 열면서 그 전제가 깨졌다 — 조립된 글과 나가는 글이 달라졌다.
 *
 * 그래서 검사 지점을 옮긴다. 코드가 쓴 것이 아니라 **나가는 것**을 본다.
 *
 * 다만 전부 막지는 않는다. 공고 실수는 사람이 내고 사람이 책임지는 일이고,
 * 기계가 사람의 판단을 대신할 자리가 아니다. 미완성만 막고 나머지는 알린다.
 * 모델은 부르지 않는다 — 정규식과 날짜 산술뿐이라 1000회에 7ms다.
 */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 2026년 9월 1일(화) — 날짜와 그 옆에 적힌 요일 */
const DATED_WEEKDAY = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*\(([일월화수목금토])\)/g;
/** 9월 8일(화) — 연도 없이 적힌 것 */
const SHORT_WEEKDAY = /(?<!\d년\s{0,3})(\d{1,2})월\s*(\d{1,2})일\s*\(([일월화수목금토])\)/g;

const BLANK = /_{3,}/;
const PENDING = /\[확인 필요(?::\s*([^\]]+))?\]/g;
const MONEY = /(\d{1,3}(?:,\d{3})+\s*원|\d+\s*만\s*원|\d{4,}\s*원)/g;

export function weekdayOf(year, month, day) {
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/**
 * 본문에 적힌 요일이 실제 달력과 맞는지 본다.
 *
 * 이 프로젝트가 존재하는 이유가 이 버그다. 초판에서 화요일을 `(월)`로 적은 공고가
 * 나갔다. 사람이 본문을 고치게 열어 준 이상, 사람도 같은 실수를 할 수 있다.
 */
export function checkWeekdays(post, { year } = {}) {
  const problems = [];
  const seenSpans = [];

  for (const match of post.matchAll(DATED_WEEKDAY)) {
    const [text, y, m, d, written] = match;
    seenSpans.push([match.index, match.index + text.length]);
    const actual = weekdayOf(Number(y), Number(m), Number(d));
    if (actual !== written) {
      problems.push(`${text} — 실제로는 ${actual}요일입니다`);
    }
  }

  if (year) {
    for (const match of post.matchAll(SHORT_WEEKDAY)) {
      const inside = seenSpans.some(([start, end]) => match.index >= start && match.index < end);
      if (inside) continue;
      const [text, m, d, written] = match;
      const actual = weekdayOf(year, Number(m), Number(d));
      if (actual !== written) {
        problems.push(`${text} — ${year}년 기준 실제로는 ${actual}요일입니다`);
      }
    }
  }

  return problems;
}

/**
 * 게시 가능한 글인가.
 *
 * 두 등급으로 나눈다.
 *
 * **errors — 막는다.** 빈칸과 `[확인 필요]`. 이건 실수가 아니라 미완성이다.
 * 요일이 틀린 공고는 창피하지만, 빈칸 공고는 지원자가 판단 자체를 못 한다.
 *
 * **warnings — 알리고 사람이 정한다.** 요일·금액·고객사명. 오탐이 난다
 * (`왕복 교통비 50,000원 지급`은 정당한 금액이다). 기계가 사람의 판단을
 * 대신할 자리가 아니고, 대신 **누가 경고를 보고도 눌렀는지는 남는다.**
 *
 * @param {string} post           나갈 본문 그대로
 * @param {object} context
 * @param {number|null} context.expectedTotal   담당자가 승인한 강사료 총액
 * @param {number|null} context.hourlyRate      시간당 단가 (본문에 나올 수 있다)
 * @param {string|null} context.customerLabel   고객사명
 * @param {boolean} context.customerHidden      고객사 비공개 여부
 * @param {number|null} context.year            연도 없는 날짜 해석 기준
 */
export function checkPostText(post, {
  expectedTotal = null,
  hourlyRate = null,
  customerLabel = null,
  customerHidden = true,
  year = null
} = {}) {
  const errors = [];

  const warnings = [];

  if (typeof post !== 'string' || post.trim().length === 0) {
    return { errors: ['본문이 비어 있습니다.'], warnings, postable: false };
  }

  // 1. 채우다 만 자리. 예전에는 사람이 복붙하며 채웠기 때문에 드러나지 않았고,
  //    `[확인 필요]`가 아니라서 승인 게이트를 그냥 통과했다.
  if (BLANK.test(post)) {
    errors.push('본문에 빈칸(______)이 남아 있습니다. 채우거나 문구로 바꾸세요.');
  }

  // 2. 막아 둔 항목
  for (const match of post.matchAll(PENDING)) {
    errors.push(`확인 필요 항목이 남아 있습니다: ${match[1] ?? '(항목 미상)'}`);
  }

  // 3. 요일 정합성 — 경고. 사람이 고친 글이면 사람이 판단한다.
  for (const problem of checkWeekdays(post, { year })) {
    warnings.push(`날짜와 요일이 어긋납니다 — ${problem}`);
  }

  // 4. 고객사명 노출 — 경고. 공개 여부는 계약 사정이라 코드가 단정할 수 없다.
  if (customerHidden && customerLabel && post.includes(customerLabel)) {
    warnings.push(`고객사명이 본문에 있습니다: ${customerLabel}. 공개가 승인됐는지 확인하세요.`);
  }

  // 5. 금액 — 경고. 승인한 강사료 외의 금액이 보이면 알린다.
  const allowed = new Set(
    [expectedTotal, hourlyRate].filter((n) => Number.isFinite(n) && n > 0).map(normalizeMoney)
  );
  for (const match of post.matchAll(MONEY)) {
    const value = normalizeMoney(parseMoneyToken(match[1]));
    if (value === null) continue;
    if (allowed.size === 0) {
      warnings.push(`승인된 강사료가 없는데 본문에 금액이 있습니다: ${match[1]}`);
    } else if (!allowed.has(value)) {
      // 교통비·부대비용처럼 정당한 금액일 수 있다. 막지 않고 눈에만 띄게 한다.
      warnings.push(
        `강사료 외의 금액이 본문에 있습니다: ${match[1]}. `
        + '원문의 고객사 예산을 옮겨 적은 것은 아닌지 확인하세요.'
      );
    }
  }

  return { errors, warnings, postable: errors.length === 0 };
}

function parseMoneyToken(token) {
  const cleaned = token.replace(/[\s원]/g, '');
  if (cleaned.endsWith('만')) return Number(cleaned.slice(0, -1).replace(/,/g, '')) * 10_000;
  const digits = cleaned.replace(/,/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

function normalizeMoney(value) {
  return value === null ? null : Math.round(value);
}
