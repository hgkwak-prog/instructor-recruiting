/**
 * Assembles the Slack JD from confirmed facts, in the format defined by the
 * account skill `jd-writer`.
 *
 * The model does not write this text. Every date, weekday, hour total and fixed
 * phrase is produced here, so the class of error that shipped in the first
 * version (a Tuesday labelled 월요일) cannot occur -- there is no model prose
 * to correct.
 *
 * Two deliberate departures from the account skill:
 *   1. The customer is never named. jd-writer puts the real name in the header;
 *      our engagements are almost always confidential, so it is omitted entirely.
 *   2. The instructor fee amount is never printed, even when the source document
 *      states one. The curriculum goes to the client, the fee goes to the
 *      instructor -- the client's budget ceiling is not the instructor's offer.
 *   3. Course objectives and the day-by-day curriculum are extracted but NOT
 *      published. A job posting is a public document; our curriculum design is
 *      the product we sell. Only a topic line survives, so an applicant can tell
 *      whether the subject fits them.
 *   4. The venue is generalised to city + district. An applicant needs to know
 *      the commute, not the floor number.
 *
 * Extraction and publication are separate concerns: the review report shows
 * everything, the posting shows only what an applicant needs.
 */

import { deriveRequiredQualifications, deriveResponsibilities, generalizeLocation } from '../derive.mjs';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const OPENING_TEMPLATE = (first, last) =>
  `🗓️ 예상 업무 일정은 ${first}~ ${last} 이고 지원 후 조율할 수 있어요.`;
export const CLOSING_LINE = '많은 연락 부탁드립니다. 감사합니다.';

export const NEEDS_INPUT = (label) => `[확인 필요: ${label}]`;

export function weekdayKo(isoDate) {
  return WEEKDAYS[new Date(`${isoDate}T00:00:00.000Z`).getUTCDay()];
}

export function isValidIsoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

export function formatDateKo(isoDate, { year = true, weekday = true } = {}) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const head = year ? `${y}년 ${m}월 ${d}일` : `${m}월 ${d}일`;
  return weekday ? `${head}(${weekdayKo(isoDate)})` : head;
}

/** Year repeated only when it changes. */
function formatDateList(dates) {
  let lastYear = null;
  return dates.map((date) => {
    const year = date.slice(0, 4);
    const withYear = year !== lastYear;
    lastYear = year;
    return formatDateKo(date, { year: withYear });
  }).join(', ');
}

function bullets(items) {
  return items.map((item) => `• ${item}`);
}

export function renderJobPost(facts) {
  const get = (key) => facts?.[key]?.value ?? null;
  const lines = [];

  const dates = (get('sessionDates') ?? []).filter(isValidIsoDate);
  const role = get('role');
  const roleLabel = role ?? NEEDS_INPUT('역할 구분');

  // 최상단 고정 문구 -- 첫 교육일 ~ 마지막 교육일
  if (dates.length > 0) {
    lines.push(OPENING_TEMPLATE(
      formatDateKo(dates[0], { weekday: false }),
      formatDateKo(dates[dates.length - 1], { weekday: false })
    ));
  } else {
    lines.push(OPENING_TEMPLATE(NEEDS_INPUT('교육 시작일'), NEEDS_INPUT('교육 종료일')));
  }
  lines.push('');

  // 1. 헤더 -- 고객사는 표기하지 않는다 (기밀 기본)
  const title = get('courseTitle') ?? NEEDS_INPUT('교육 과정명');
  lines.push(`*${title} ${roleLabel} 모집*`);
  lines.push('');

  // 2. 교육 개요
  lines.push('*교육 개요*');
  lines.push(`• 대상 : ${get('audience') ?? NEEDS_INPUT('수강 대상')}`);
  lines.push(`• 형태 : ${get('format') ?? NEEDS_INPUT('교육 형태')}`);
  const online = /온라인|비대면/.test(get('format') ?? '');
  if (!online) {
    const area = generalizeLocation(get('location'));
    lines.push(`• 장소 : ${area ?? NEEDS_INPUT('장소')}`);
  }

  const hours = get('hoursPerSession');
  const total = get('totalHours');
  const schedule = dates.length > 0 ? formatDateList(dates) : NEEDS_INPUT('교육 일정');
  const spec = hours !== null && dates.length > 0 && total !== null
    ? ` [하루 ${hours}시간 × ${dates.length}일, 총 ${total}시간]`
    : ` [${NEEDS_INPUT('시간 구성')}]`;
  lines.push(`• 일정 : ${schedule}${spec}`);

  // 교육 시간과 근무 시간은 한 줄에 붙인다. 다를 때만 둘 다 쓴다.
  const daily = get('dailySchedule');
  const working = get('workingHours');
  if (daily && working && working !== daily) {
    lines.push(`• 시간 : 교육 ${daily} / 근무 ${working}`);
  } else if (daily || working) {
    lines.push(`• 시간 : ${daily ?? working}`);
  }

  const headcount = get('headcount');
  if (headcount !== null) lines.push(`• 모집 인원 : ${headcount}명`);
  lines.push('');

  // 3. 주요 주제만 노출한다. 교육 목표와 일차별 커리큘럼은 추출은 하되 게시하지 않는다.
  //    공고는 공개 문서이고, 커리큘럼 설계는 우리가 파는 상품이다.
  const topics = get('topics') ?? [];
  lines.push('*주요 주제*');
  lines.push(topics.length > 0 ? topics.join(' · ') : NEEDS_INPUT('주요 주제'));
  lines.push('');

  const constraints = get('environmentConstraints') ?? [];
  if (constraints.length > 0) {
    lines.push('*실습 환경*');
    lines.push(constraints.join(', '));
    lines.push('');
  }

  // 5. 담당 업무 -- 원문에 없으면 역할별 표준 세트를 쓴다
  const duties = deriveResponsibilities(facts).items;
  lines.push('*담당 업무*');
  lines.push(...(duties.length > 0 ? bullets(duties) : [`• ${NEEDS_INPUT('담당 업무')}`]));
  lines.push('');

  // 6. 강사 지원 자격 -- 물류 조건은 코드가 도출, 역량 조건은 사람이 채운다
  const derived = deriveRequiredQualifications(facts).map((item) => item.text);
  const stated = (get('requiredQualifications') ?? []).map((item) => item.text);
  lines.push('*강사 지원 자격*');
  lines.push(...bullets(derived));
  lines.push(...(stated.length > 0 ? bullets(stated) : [`• ${NEEDS_INPUT('역량 조건')}`]));

  const preferred = (get('preferredQualifications') ?? []).map((item) => item.text);
  if (preferred.length > 0) {
    lines.push('');
    lines.push('*우대 사항*');
    lines.push(...bullets(preferred));
  }
  lines.push('');

  // 7. 강사료 -- 금액은 절대 인쇄하지 않는다. 담당자가 직접 채운다.
  const suffix = get('travelExpenseIncluded') === true
    ? '(원천징수 후 지급, 출장비 포함)'
    : '(원천징수 후 지급)';
  lines.push('*강사료*');
  lines.push(`강사료(${roleLabel}) : 총 ______ 원 ${suffix}`);
  lines.push('');

  // 8. 지원 안내
  const deadline = get('deadline');
  const deadlineTime = get('deadlineTime');
  const method = get('applicationMethod');
  lines.push('*지원 안내*');
  if (deadline !== null) {
    const shown = isValidIsoDate(deadline) ? formatDateKo(deadline) : deadline;
    lines.push(`• 모집 마감 : ${shown}${deadlineTime ? ` ${deadlineTime}` : ''}`);
  }
  lines.push(`• 지원 방법 : ${method ?? NEEDS_INPUT('지원 방법')}`);
  lines.push('');

  lines.push(CLOSING_LINE);
  return lines.join('\n');
}

export function pendingMarkers(post) {
  return [...post.matchAll(/\[확인 필요: ([^\]]+)\]/g)].map((match) => match[1]);
}
