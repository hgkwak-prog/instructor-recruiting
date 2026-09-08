/**
 * Operating conditions are the operator's own declaration, so they are
 * authoritative. The model reads them in the prompt and usually copies them
 * correctly, but "usually" is not a contract: a field the operator declared
 * must never end up empty because the model overlooked it.
 *
 * This fills any fact the model left null from the matching condition, before
 * verification. A value the model *did* fill is left alone -- verify.mjs
 * compares those and errors on a mismatch rather than silently overwriting.
 */

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

/** condition key -> fact key. Only operational facts; never course content. */
export const CONDITION_TO_FACT = {
  instructorRole: 'role',
  customerDisclosure: 'customerDisclosure',
  customerLabel: 'customerLabel',
  location: 'location',
  headcount: 'headcount',
  dailySchedule: 'dailySchedule',
  workingHours: 'workingHours',
  travelExpenseIncluded: 'travelExpenseIncluded',
  applicationMethod: 'applicationMethod',
  deadline: 'deadline',
  deadlineTime: 'deadlineTime',
  // 고객사가 명시적으로 요구한 조건(경력 연차, 도메인 경력 등)은 모델이 지어내면
  // 안 되는 종류라(requiredQualifications 설명 참고) 담당자가 직접 적는다.
  // 모델 스키마(core/schema.mjs)에는 없는, 운영 조건 전용 사실이다.
  explicitRequirements: 'explicitRequirements'
};

const NORMALIZERS = {
  role: normalizeRole,
  customerDisclosure: normalizeDisclosure
};

/**
 * Returns a new facts object plus the fact keys that were filled, so the CLI
 * and the review report can say which values came from the operator rather
 * than from the document.
 */
export function applyConditions(facts, conditions = {}, { override = false } = {}) {
  const filled = [];
  const overridden = [];
  const next = { ...facts };

  for (const [conditionKey, factKey] of Object.entries(CONDITION_TO_FACT)) {
    const raw = conditions[conditionKey];
    if (raw === undefined || raw === null || raw === '') continue;

    const current = next[factKey];
    const isEmpty = !current
      || current.value === null
      || (Array.isArray(current.value) && current.value.length === 0);

    const normalize = NORMALIZERS[factKey];
    const value = normalize ? normalize(raw) : raw;

    if (!isEmpty) {
      // 커리큘럼은 제안서 단계 산출물이라 실제 운영과 다를 수 있다.
      // 장소가 바뀌고 인원이 조정되는 것은 사고가 아니라 정상이다.
      // 사람이 지금 상황을 보고 넣은 값이 몇 달 전 문서를 이긴다.
      if (!override) continue;
      if (JSON.stringify(current.value) === JSON.stringify(value)) continue;
      overridden.push({ key: factKey, from: current.value, to: value });
      next[factKey] = { value, evidence: `담당자 입력 (${conditionKey}). 원문에는 "${current.value}"` };
      continue;
    }

    next[factKey] = {
      value,
      evidence: `운영 조건 ${conditionKey}: ${raw}`
    };
    filled.push(factKey);
  }

  return { facts: next, filled, overridden };
}
