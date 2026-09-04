/**
 * Checks the model's extracted facts against arithmetic, the calendar, and the
 * operating conditions.
 *
 * The Slack post itself is no longer verified -- render.mjs builds it from these
 * same facts, so verifying the facts covers the post by construction.
 *
 * errors block the run and keep it out of the database.
 * warnings are shown to the reviewer and stored with the result.
 */

import { isValidIsoDate, renderJobPost, pendingMarkers } from './render/job-post.mjs';
import {
  breakAnalysis, setupAnalysis, spanMinutes, generalizeLocation, deriveResponsibilities
} from './derive.mjs';

const BUDGET_TERMS = /(내부\s*예산|상한가|협상\s*전략|마진|원가)/;

/**
 * Any currency figure. The fee amount must never reach the posting: the
 * curriculum is written for the client, the fee is what we offer the
 * instructor, and the client's budget is not the instructor's offer.
 */
const MONEY = /(\d{1,3}(,\d{3})+\s*원|\d+\s*만\s*원|[일시간회당]\s*\d[\d,]*\s*원|\d[\d,]{3,}\s*원)/;

/**
 * Qualification fields carry per-item provenance, so the evidence rule applies
 * per item, not to the field as a whole: a proposed condition (sourced: false)
 * has no source to cite by definition.
 */
const QUAL_FIELDS = ['requiredQualifications', 'preferredQualifications'];

/** Money has no legitimate place in these fields. */
const MONEY_FORBIDDEN = [
  'responsibilities', 'requiredQualifications', 'preferredQualifications',
  'environmentConstraints', 'audience', 'format', 'location', 'courseTitle'
];

/** Operating conditions may arrive from a spreadsheet in either vocabulary. */
export function normalizeRole(value) {
  const text = String(value).trim().toLowerCase();
  if (['assistant', 'ta', '보조', '보조강사'].includes(text)) return '보조강사';
  if (['lead', 'main', 'instructor', '주강사', '메인'].includes(text)) return '주강사';
  return String(value).trim();
}

export function normalizeDisclosure(value) {
  const text = String(value).trim().toLowerCase();
  if (['approved', 'public', 'open', '공개'].includes(text)) return 'approved';
  if (['hidden', 'private', 'anonymous', '비공개'].includes(text)) return 'hidden';
  return String(value).trim();
}

export function verifyResult({ result, conditions = {} }) {
  const errors = [];
  const warnings = [];
  const facts = result.facts ?? {};
  const get = (key) => facts[key]?.value ?? null;

  // 1. Evidence is required for anything the model claims to have read.
  for (const [key, fact] of Object.entries(facts)) {
    if (QUAL_FIELDS.includes(key)) continue;   // 항목 단위로 아래에서 검사한다
    const empty = fact?.value === null
      || (Array.isArray(fact?.value) && fact.value.length === 0);
    if (!empty && !fact?.evidence) errors.push(`facts.${key}에 근거(evidence)가 없습니다`);
  }

  // 1-b. 자격 조건은 항목마다 출처가 다르다. 원문 인용(sourced: true)이 하나라도
  //      있을 때만 근거를 요구한다. 전부 제안이면 인용할 원문이 없다.
  for (const key of QUAL_FIELDS) {
    const items = facts[key]?.value ?? [];
    if (items.some((item) => item?.sourced === true) && !facts[key]?.evidence) {
      errors.push(`facts.${key}에 원문 근거 항목이 있는데 evidence가 없습니다`);
    }
  }

  // 2. Dates must be real calendar dates, in order, without duplicates.
  const dates = get('sessionDates') ?? [];
  for (const date of dates) {
    if (!isValidIsoDate(date)) errors.push(`sessionDates에 실재하지 않는 날짜가 있습니다: ${date}`);
  }
  if (new Set(dates).size !== dates.length) errors.push('sessionDates에 중복된 날짜가 있습니다');
  const sorted = [...dates].sort();
  if (dates.join() !== sorted.join()) warnings.push('sessionDates가 날짜순이 아닙니다. 정렬해 표기했습니다.');

  const deadline = get('deadline');
  if (deadline !== null && !isValidIsoDate(deadline)) {
    errors.push(`deadline이 실재하지 않는 날짜입니다: ${deadline}`);
  }
  if (deadline !== null && isValidIsoDate(deadline) && dates.length > 0 && deadline > sorted[0]) {
    errors.push(`모집 마감일(${deadline})이 첫 교육일(${sorted[0]})보다 늦습니다`);
  }

  // 3. Arithmetic is recomputed, never accepted.
  const hours = get('hoursPerSession');
  const total = get('totalHours');
  if (hours !== null && total !== null && dates.length > 0) {
    const expected = hours * dates.length;
    if (Math.abs(expected - total) > 1e-9) {
      errors.push(
        `총 시간 불일치: ${hours}시간 × ${dates.length}회 = ${expected}시간인데 totalHours는 ${total}시간입니다`
      );
    }
  }
  if (hours !== null && total === null && dates.length > 0) {
    warnings.push(`totalHours가 비어 있습니다. ${hours}시간 × ${dates.length}회 기준을 담당자가 확인해 주세요.`);
  }

  // 4. 운영 조건이 모델 추론을 이긴다.
  //    **불일치는 오류가 아니라 경고다.** 커리큘럼은 제안서 단계 산출물이라
  //    실제 운영과 다른 것이 정상이고, 담당자가 넣은 값이 최신이다.
  //    예전에는 여기서 막혀 DB에도 못 들어갔다 — 맞는 값을 넣었는데도.
  const checks = [
    ['role', 'instructorRole', normalizeRole],
    ['customerDisclosure', 'customerDisclosure', normalizeDisclosure],
    ['location', 'location', (value) => value],
    ['headcount', 'headcount', (value) => value],
    ['dailySchedule', 'dailySchedule', (value) => value],
    ['workingHours', 'workingHours', (value) => value]
  ];
  for (const [factKey, conditionKey, normalize] of checks) {
    const raw = conditions[conditionKey];
    if (raw === undefined || raw === null) continue;
    const expected = normalize(raw);
    const actual = get(factKey);
    if (actual !== null && normalize(actual) !== expected) {
      warnings.push(`${factKey}: 원문은 "${actual}", 담당자 입력은 "${raw}" — 입력값을 씁니다.`);
    }
  }

  // 5. Confidentiality.
  const disclosure = get('customerDisclosure');
  if (disclosure !== 'approved') {
    const label = get('customerLabel');
    if (label && conditions.customerName && label.includes(conditions.customerName)) {
      errors.push('고객사 공개가 승인되지 않았는데 customerLabel에 실명이 들어 있습니다');
    }
  }
  const serialized = JSON.stringify(facts);
  if (BUDGET_TERMS.test(serialized)) {
    errors.push('내부 예산·협상 관련 표현이 사실 항목에 포함되어 있습니다');
  }

  // 5-b. A fee figure must never reach the posting, even when the source states one.
  for (const [key, fact] of Object.entries(facts)) {
    const text = JSON.stringify(fact?.value ?? '');
    if (!MONEY.test(text)) continue;
    if (MONEY_FORBIDDEN.includes(key)) {
      errors.push(`facts.${key}에 금액이 들어 있습니다. 강사료 금액은 공고에 나가지 않습니다.`);
    } else {
      warnings.push(`facts.${key}에 금액 표현이 있습니다. 강사료가 아닌지 확인하세요.`);
    }
  }

  // 5-c. Working hours are not arithmetic -- a wider class block is a break.
  const daily = get('dailySchedule');
  const working = get('workingHours');
  if (daily && spanMinutes(daily) === null) errors.push(`dailySchedule 형식이 잘못됐습니다: ${daily}`);
  if (working && spanMinutes(working) === null) errors.push(`workingHours 형식이 잘못됐습니다: ${working}`);

  const breaks = breakAnalysis({ dailySchedule: daily, hoursPerSession: hours });
  if (breaks?.kind === 'overrun') {
    errors.push(
      `교육 시간대(${daily})가 하루 교육시간 ${hours}시간보다 짧습니다 (${-breaks.gap}분 부족)`
    );
  } else if (breaks?.kind === 'break') {
    warnings.push(`교육 시간대 ${daily}에서 ${breaks.gap}분은 휴게시간으로 봤습니다 (교육 ${hours}시간).`);
  } else if (breaks?.kind === 'unexplained') {
    errors.push(
      `교육 시간대(${daily})와 교육시간 ${hours}시간의 차이가 ${breaks.gap}분입니다. 휴게시간으로 보기에 큽니다.`
    );
  }

  const setup = setupAnalysis({ dailySchedule: daily, workingHours: working });
  if (setup && setup.extra < 0) {
    errors.push(`근무 시간(${working})이 교육 시간(${daily})보다 짧습니다`);
  } else if (setup && setup.extra > 0) {
    warnings.push(`보조 근무 ${setup.extra}분(교육 전후 준비·정리)이 자격 조건에 반영됐습니다.`);
  }

  // 6. Proposed qualifications are allowed but must be visible to the reviewer.
  const required = get('requiredQualifications') ?? [];
  const preferred = get('preferredQualifications') ?? [];
  const proposed = required.filter((item) => item.sourced === false);
  if (proposed.length > 3) {
    errors.push(`제안한 자격 조건이 ${proposed.length}건입니다. 3건을 넘길 수 없습니다.`);
  } else if (proposed.length > 0) {
    warnings.push(`원문 근거 없이 제안된 자격 ${proposed.length}건: ${proposed.map((q) => q.text).join(' / ')}`);
  }
  const proposedPreferred = preferred.filter((item) => item.sourced === false);
  if (proposedPreferred.length > 0) {
    errors.push(`우대 사항은 제안할 수 없습니다: ${proposedPreferred.map((q) => q.text).join(' / ')}`);
  }

  // 7. Qualifications that could not come from any curriculum.
  const UNGROUNDED = /(\d+\s*년\s*이상|경력\s*\d|학위|학사|석사|박사|자격증)/;
  for (const item of [...required, ...preferred]) {
    if (UNGROUNDED.test(item.text)) {
      errors.push(`문서에서 도출될 수 없는 기준입니다: "${item.text}"`);
    }
  }

  // 8. Assistant-instructor boundary.
  if (get('role') === '보조강사') {
    const overreach = required
      .filter((item) => /(아키텍처|연구\s*경험|강의\s*경력|강의\s*경험)/.test(item.text))
      .map((item) => item.text);
    if (overreach.length > 0) {
      warnings.push(`보조강사에게 과한 요건일 수 있습니다: ${overreach.join(' / ')}`);
    }
  }

  // 8-b. Standard duties are fine, but the reviewer should know they are standard.
  const duties = deriveResponsibilities(facts);
  if (duties.fromDefaults) {
    warnings.push(`담당 업무를 ${get('role')} 표준 세트로 채웠습니다. 과정 특이사항이 있으면 수정하세요.`);
  } else if (duties.items.length === 0) {
    warnings.push('담당 업무가 비어 있고 역할도 정해지지 않아 표준 세트를 쓸 수 없습니다.');
  }

  // 9. The venue must reduce to a city/district, or the exact address would leak.
  const rawLocation = get('location');
  const offline = !/온라인|비대면/.test(get('format') ?? '');
  if (rawLocation && offline && generalizeLocation(rawLocation) === null) {
    warnings.push(`장소 "${rawLocation}"를 시/군/구 수준으로 줄이지 못했습니다. 공고에는 표시되지 않습니다.`);
  }

  // 10. Declared conflicts always block.
  for (const conflict of result.conflicts ?? []) {
    errors.push(`충돌: ${conflict.field} — ${conflict.note}`);
  }

  // 11. Render, then confirm every blocking gap is visible to the reviewer.
  const slackJobPost = renderJobPost(facts);
  const pending = pendingMarkers(slackJobPost);
  const blocking = (result.missingFields ?? []).filter((item) => item.blocking);

  return {
    errors,
    warnings,
    slackJobPost,
    pendingMarkers: pending,
    blockingFields: blocking.map((item) => item.field),
    /** Ready to post only when nothing is left for a human to fill in. */
    postable: errors.length === 0 && pending.length === 0 && blocking.length === 0
  };
}
