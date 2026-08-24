/**
 * Facts that follow mechanically from other confirmed facts.
 *
 * These are not inferences in the risky sense -- there is exactly one correct
 * answer given the inputs, so code produces them instead of the model. That
 * keeps them reproducible and gives every derived line a traceable basis.
 *
 * Judgement-based qualifications (domain knowledge, tool experience) are NOT
 * derived here. Those must come from the source document or the operator.
 */

import { isValidIsoDate } from './render/job-post.mjs';

/**
 * 시/도 + 시/군/구 까지만 남긴다. 정확한 주소는 대외 공고에 나갈 필요가 없다.
 * "서울 성동구 성수이로 00, 가상캠퍼스 4층" -> "서울 성동구 인근"
 * 매칭에 실패하면 null. 원문을 그대로 흘리지 않는다.
 */
const REGION = /^\s*(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청북도|충북|충청남도|충남|전라북도|전북|전라남도|전남|경상북도|경북|경상남도|경남|제주)(?:특별자치시|특별자치도|특별시|광역시|도|시)?\s*([가-힣]+(?:시|군|구))?/;

export function generalizeLocation(location) {
  if (typeof location !== 'string') return null;
  const match = REGION.exec(location);
  if (!match) return null;
  return `${[match[1], match[2]].filter(Boolean).join(' ')} 인근`;
}

/**
 * Standard duties per role, used when the source document states none.
 *
 * Curricula are written for the client and rarely describe what an assistant
 * instructor does; the duties are the same every time. Code is a better source
 * than the model here -- same wording every run, and no invention. The reviewer
 * is told the defaults were used and can edit them.
 */
export const DEFAULT_RESPONSIBILITIES = {
  보조강사: [
    '실습 환경·계정 사전 점검',
    '실습 중 수강생 개별 지원',
    '오류·질문 1차 대응 및 주강사 에스컬레이션',
    '출결·교재 등 현장 운영 보조'
  ],
  주강사: [
    '교육 진행 및 강의',
    '실습 설계와 결과 피드백',
    '수강생 질문 대응',
    '교육 종료 후 결과 정리 및 공유'
  ]
};

/** Stated duties win; otherwise the role's standard set. */
export function deriveResponsibilities(facts) {
  const stated = facts?.responsibilities?.value ?? [];
  if (stated.length > 0) return { items: stated, fromDefaults: false };
  const role = facts?.role?.value;
  const fallback = DEFAULT_RESPONSIBILITIES[role];
  if (!fallback) return { items: [], fromDefaults: false };
  return { items: fallback, fromDefaults: true };
}

/** "09:30-17:30" -> minutes spanned, or null if unparseable. */
export function spanMinutes(range) {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(range ?? '');
  if (!match) return null;
  const [, h1, m1, h2, m2] = match.map(Number);
  const minutes = (h2 * 60 + m2) - (h1 * 60 + m1);
  return minutes > 0 ? minutes : null;
}

/**
 * A class block wider than the taught hours is a break, not a contradiction.
 * 10:00-17:00 spanning 7h against a stated 6h of teaching is one lunch hour.
 * Only an unexplained gap outside the plausible break range is a real conflict.
 */
export const MAX_PLAUSIBLE_BREAK_MINUTES = 90;

export function breakAnalysis({ dailySchedule, hoursPerSession }) {
  const span = spanMinutes(dailySchedule);
  if (span === null || hoursPerSession === null) return null;
  const taught = hoursPerSession * 60;
  const gap = span - taught;
  if (gap === 0) return { gap: 0, kind: 'none' };
  if (gap < 0) return { gap, kind: 'overrun' };            // 교육 시간이 시간대보다 김 -> 오류
  if (gap <= MAX_PLAUSIBLE_BREAK_MINUTES) return { gap, kind: 'break' };
  return { gap, kind: 'unexplained' };
}

/** Extra time the instructor is on site beyond the class block. */
export function setupAnalysis({ dailySchedule, workingHours }) {
  const classSpan = spanMinutes(dailySchedule);
  const workSpan = spanMinutes(workingHours);
  if (classSpan === null || workSpan === null) return null;
  return { extra: workSpan - classSpan, differs: workingHours !== dailySchedule };
}

/**
 * Logistics requirements every posting needs, written from confirmed facts.
 * Returns [] rather than guessing when the underlying fact is missing.
 */
export function deriveRequiredQualifications(facts) {
  const get = (key) => facts?.[key]?.value ?? null;
  const derived = [];

  // 공고는 짧아야 읽힌다. 날짜 목록은 위 개요에 이미 있으므로 일수만 쓴다.
  const dates = (get('sessionDates') ?? []).filter(isValidIsoDate);
  if (dates.length > 0) {
    derived.push({ text: `전체 교육일(${dates.length}일) 참여 가능`, basis: 'sessionDates' });
  }

  const area = generalizeLocation(get('location'));
  if (area && !/온라인|비대면/.test(get('format') ?? '')) {
    derived.push({ text: `${area} 교육장 출근 가능`, basis: 'location' });
  }

  const working = get('workingHours');
  const daily = get('dailySchedule');
  const hours = working ?? daily;
  if (hours) {
    derived.push({ text: `각 교육일 ${hours} 근무 가능`, basis: working ? 'workingHours' : 'dailySchedule' });
  }

  return derived;
}
