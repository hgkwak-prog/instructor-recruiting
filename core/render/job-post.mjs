/**
 * Assembles the Slack JD from confirmed facts, in the format actually used in
 * recent postings (2026-09 실사례 5건 기준 — 실제로 올라간 공고는 계정 스킬
 * `jd-writer`의 정의된 서식과도, 이전 버전의 이 파일과도 다르다).
 *
 * The model does not write this text. Every date, weekday, hour total and fixed
 * phrase is produced here, so the class of error that shipped in the first
 * version (a Tuesday labelled 월요일) cannot occur -- there is no model prose
 * to correct.
 *
 * Deliberate departures from a literal "everything the model saw" dump:
 *   1. The customer is never named. Our engagements are almost always
 *      confidential, so it is omitted entirely regardless of disclosure.
 *   2. The instructor fee amount is never printed, even when the source
 *      document states one. The curriculum goes to the client, the fee goes to
 *      the instructor -- the client's budget ceiling is not the instructor's
 *      offer.
 *   3. The day-by-day curriculum design (`curriculumOutline`) is extracted but
 *      NOT published -- that is the product we sell, and a competitor should
 *      not be able to read it off a public job posting. Course objectives
 *      (`objectives`), by contrast, ARE published (2026-09 실사례에서 확인:
 *      실제로 올라간 공고들은 학습 목표를 밝힌다) -- a goal statement doesn't
 *      leak the pedagogical design the way a session-by-session breakdown does.
 *   4. The venue is generalised to city + district. An applicant needs to know
 *      the commute, not the floor number.
 *
 * 2026-09 실사례에는 상단 고정 문구("🗓️ 예상 업무 일정은 ~")가 없었다 --
 * 이전 버전은 매번 붙였는데, 실제 운영에서는 쓰이지 않아 뺐다.
 *
 * Extraction and publication are separate concerns: `facts`/`missingFields`
 * carries everything, the posting shows only what an applicant needs.
 */

import { deriveRequiredQualifications, deriveResponsibilities, generalizeLocation } from '../derive.mjs';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

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

  // 1. 헤더 -- 고객사는 표기하지 않는다 (기밀 기본)
  const title = get('courseTitle') ?? NEEDS_INPUT('교육 과정명');
  lines.push(`*[${roleLabel} 모집] ${title}*`);
  lines.push('');

  // 2. 교육 개요
  lines.push('📌 *교육 개요*');
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

  // 3. 교육 목표 -- 일차별 설계(curriculumOutline)와 달리 이건 공개한다.
  //    "무엇을 갖추게 되는가"는 지원자가 자기 역량과 맞는지 판단하는 정보지,
  //    커리큘럼 설계 그 자체는 아니다.
  // 목표·내용이 한두 개일 때는 join으로도 괜찮아 보였지만, 여러 개가 되는 순간
  // 한 줄에 다 붙어 읽기 어려워진다(2026-09 실사용 재현) — 다른 섹션과 같은
  // 불릿+줄바꿈으로 통일한다.
  const objectives = get('objectives') ?? [];
  if (objectives.length > 0) {
    lines.push('🎯 *교육 목표*');
    lines.push(...bullets(objectives));
    lines.push('');
  }

  // 4. 주요 내용만 노출한다. 일차별 커리큘럼 설계는 추출은 하되 게시하지 않는다.
  //    공고는 공개 문서이고, 커리큘럼 설계는 우리가 파는 상품이다.
  const topics = get('topics') ?? [];
  lines.push('📖 *주요 내용*');
  lines.push(...(topics.length > 0 ? bullets(topics) : [`• ${NEEDS_INPUT('주요 내용')}`]));
  lines.push('');

  // 스키마 description이 "최대 4개, 짧게"를 요구하지만 모델이 지키지 않을 수 있으니
  // 방어적으로도 잘라낸다 — 실습 환경은 지원 여부 판단용이지 스펙 목록이 아니다.
  const constraints = (get('environmentConstraints') ?? []).slice(0, 4);
  if (constraints.length > 0) {
    lines.push('*실습 환경*');
    lines.push(...bullets(constraints));
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
  lines.push('✅ *강사 지원 자격*');
  lines.push(...bullets(derived));
  lines.push(...(stated.length > 0 ? bullets(stated) : [`• ${NEEDS_INPUT('역량 조건')}`]));

  // 고객사가 명시적으로 요구한 조건(경력 연차, 도메인 경력 등) -- 모델이 지어낼
  // 수 없는 종류라 담당자가 운영사항 모달에서 직접 적는다(core/conditions.mjs).
  // 모델 스키마에 없는 값이라 get()이 아니라 이 필드 자체가 아예 없을 수 있다.
  const explicitRequirements = get('explicitRequirements') ?? [];
  lines.push(...bullets(explicitRequirements));

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
  lines.push('💰 *강사료*');
  lines.push(`• 강사료(${roleLabel}) : 총 ______ 원 ${suffix}`);
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
