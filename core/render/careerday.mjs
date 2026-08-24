/**
 * 커리어데이 폼값을 **facts에서 직접** 조립한다.
 *
 * 옛 코드는 완성된 슬랙 공고 문자열을 정규식으로 되읽어 날짜와 금액을 뽑았다.
 * 새 공고에는 금액이 없으니 그대로면 깨지고, 무엇보다 **되읽기는 잘못된 방향**이다 —
 * 사실은 facts에 있고, 문자열은 그 사실을 사람이 읽으라고 만든 것이다.
 *
 * ## 채널마다 노출이 다르다 (설계서 §6.3, 게시 프로파일)
 *
 * 슬랙 공고에는 금액도 상세주소도 없다. 그런데 커리어데이 폼은 둘 다 요구한다.
 * 여기서 갈린다.
 *
 * | 값 | 어디서 오나 |
 * |---|---|
 * | 보상금 | 담당자가 승인 화면에서 입력한 **강사 제시 금액** (`compensation`) |
 * | 상세주소 | 담당자가 커리어데이 단계에서 따로 입력 (`publishingInput.venueAddress`) |
 *
 * 커리큘럼 원문의 금액은 **고객사 예산**이고 여기 들어올 경로가 없다.
 * facts에 금액 필드 자체가 없다.
 *
 * 업무 내용은 **이미 승인된 슬랙 공고 본문을 그대로 쓴다.** 따로 조립하면
 * 유지할 글이 둘이 되고, 틀릴 기회도 둘이 된다.
 */

/** 커리어데이 업무 지역 선택지. 화면의 드롭다운과 같은 어휘여야 한다. */
const REGIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'
];

/** 축약형과 정식 명칭을 모두 받아 커리어데이 어휘로 맞춘다. */
const REGION_ALIASES = {
  충청북도: '충북', 충청남도: '충남',
  전라북도: '전북', 전라남도: '전남',
  경상북도: '경북', 경상남도: '경남'
};

export function extractRegion(location) {
  if (typeof location !== 'string') return null;
  for (const [full, short] of Object.entries(REGION_ALIASES)) {
    if (location.includes(full)) return short;
  }
  return REGIONS.find((region) => location.includes(region)) ?? null;
}

export class CareerdayDraftError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CareerdayDraftError';
  }
}

/**
 * @param {object} input
 * @param {string} input.runId
 * @param {object} input.facts            추출된 사실 (`{ key: { value } }`)
 * @param {string} input.jobPost          승인된 슬랙 공고 본문
 * @param {object} input.compensation     `{ total, hourlyRate, mode }`
 * @param {object} input.publishingInput  `{ venueAddress, deadline }` 담당자 입력
 */
export function buildCareerdayDraft({
  runId, facts, jobPost, compensation = null, publishingInput = {}
}) {
  const value = (key) => facts?.[key]?.value ?? null;
  const dates = (value('sessionDates') ?? []).filter(Boolean).slice().sort();

  const title = [value('courseTitle'), value('role')].filter(Boolean).join(' ')
    || '강사 모집';

  if (!jobPost?.trim()) {
    throw new CareerdayDraftError('승인된 공고 본문이 없습니다. 먼저 슬랙에 게시하세요.');
  }

  const draft = {
    runId,
    visibility: 'public',
    category: '강의/강연',
    title,
    // 승인·검사를 이미 통과한 글이다. 다시 만들지 않는다.
    description: jobPost.trim(),
    recruitmentDeadline: publishingInput.deadline ?? value('deadline') ?? null,
    workStartDate: dates.at(0) ?? null,
    workEndDate: dates.at(-1) ?? null,
    headcount: value('headcount'),
    region: extractRegion(value('location')),
    // 슬랙 공고에는 시·군·구까지만 나가지만 커리어데이 폼은 상세주소를 받는다.
    // 담당자가 이 단계에서 직접 넣는다. facts에서 끌어오지 않는다.
    detailedAddress: publishingInput.venueAddress ?? null,
    compensation: buildReward({ compensation, sessionCount: dates.length }),
    // 주제 키워드가 그대로 태그다. 교육명에서 단어를 주워 담던 옛 방식보다 정확하다.
    tags: buildTags({ role: value('role'), topics: value('topics') })
  };

  return validateCareerdayDraft(draft);
}

function buildReward({ compensation, sessionCount }) {
  if (!compensation?.total) {
    return { scheme: '기간별', count: sessionCount || null, unit: '일', totalAmount: null, vatIncluded: false };
  }
  return {
    scheme: '기간별',
    count: sessionCount || null,
    unit: '일',
    totalAmount: compensation.total,
    // 강사료는 원천징수 대상이지 부가세 대상이 아니다. 기본은 미포함.
    vatIncluded: false
  };
}

function buildTags({ role, topics }) {
  const unique = new Set();
  if (role) unique.add(role);
  for (const topic of topics ?? []) {
    // 태그는 짧아야 눈에 들어온다. 문장형 주제는 버린다.
    const trimmed = String(topic).trim();
    if (trimmed && trimmed.length <= 20) unique.add(trimmed);
  }
  return [...unique].slice(0, 10);
}

/**
 * 게시에 필요한 값이 다 있는지 본다.
 *
 * 모순(마감일이 시작일보다 늦다 같은 것)은 **던진다** — 사람이 고치기 전에는
 * 폼을 열 이유가 없다. 빠진 값은 `missingFields`로 돌려주어 모달에서 채우게 한다.
 */
export function validateCareerdayDraft(draft) {
  if (!draft || typeof draft !== 'object') {
    throw new CareerdayDraftError('커리어데이 초안은 객체여야 합니다.');
  }
  for (const field of ['runId', 'category', 'title', 'description']) {
    if (typeof draft[field] !== 'string' || !draft[field].trim()) {
      throw new CareerdayDraftError(`커리어데이 초안의 ${field}가 필요합니다.`);
    }
  }
  if (draft.headcount !== null && (!Number.isInteger(draft.headcount) || draft.headcount < 1)) {
    throw new CareerdayDraftError('커리어데이 모집 인원은 1명 이상이어야 합니다.');
  }
  if (draft.recruitmentDeadline && draft.workStartDate
      && draft.recruitmentDeadline >= draft.workStartDate) {
    throw new CareerdayDraftError('공고 마감일은 예상 업무 시작일보다 이전이어야 합니다.');
  }
  if (draft.workStartDate && draft.workEndDate && draft.workStartDate > draft.workEndDate) {
    throw new CareerdayDraftError('예상 업무 종료일은 시작일보다 빠를 수 없습니다.');
  }

  const missingFields = [];
  const required = {
    recruitmentDeadline: '공고 마감일',
    workStartDate: '예상 업무 시작일',
    workEndDate: '예상 업무 종료일',
    headcount: '모집 인원',
    region: '업무 지역',
    detailedAddress: '상세 주소'
  };
  for (const [field, label] of Object.entries(required)) {
    if (draft[field] === null || draft[field] === '') missingFields.push({ field, label });
  }
  for (const [field, label] of [['count', '보상 기간'], ['unit', '보상 단위'], ['totalAmount', '보상금']]) {
    const amount = draft.compensation?.[field];
    if (amount === null || amount === undefined) {
      missingFields.push({ field: `compensation.${field}`, label });
    }
  }

  return { ...draft, compensation: { ...draft.compensation }, missingFields };
}

/** 폼에 넣을 문자열로 바꾼다. 빠진 값이 있으면 열지 않는다. */
export function buildCareerdayFormPlan(draft) {
  const validated = validateCareerdayDraft(draft);
  if (validated.missingFields.length > 0) {
    throw new CareerdayDraftError(
      `커리어데이 필수값이 없습니다: ${validated.missingFields.map(({ label }) => label).join(', ')}`
    );
  }
  return {
    visibility: validated.visibility,
    category: validated.category,
    title: validated.title,
    description: validated.description,
    recruitmentDeadline: validated.recruitmentDeadline,
    workStartDate: validated.workStartDate,
    workEndDate: validated.workEndDate,
    headcount: String(validated.headcount),
    region: validated.region,
    detailedAddress: validated.detailedAddress,
    compensation: {
      scheme: validated.compensation.scheme,
      count: String(validated.compensation.count),
      unit: validated.compensation.unit,
      totalAmount: String(validated.compensation.totalAmount),
      vatIncluded: Boolean(validated.compensation.vatIncluded)
    },
    tags: validated.tags
  };
}
