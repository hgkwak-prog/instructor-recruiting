/** 자격 조건 한 줄. sourced=true면 원문 근거, false면 모델 제안. */
export function qual(text, sourced = true) {
  return { text, sourced };
}

export function fact(value, evidence = '커리큘럼') {
  const empty = value === null || (Array.isArray(value) && value.length === 0);
  return { value, evidence: empty ? null : evidence };
}

/** A complete, postable result for the example curriculum. */
export function baseFacts(overrides = {}) {
  return {
    role: fact('보조강사', '운영 조건 instructorRole'),
    courseTitle: fact('AI 코딩 기초 교육'),
    customerLabel: fact('A사', '운영 조건'),
    customerDisclosure: fact('hidden', '운영 조건'),
    audience: fact('관계사 개발자 30~35명 (백엔드·프론트엔드·풀스택)'),
    format: fact('오프라인 실습형'),
    location: fact('서울시 내 교육장', '운영 조건'),
    sessionDates: fact(['2026-09-01', '2026-09-08', '2026-09-15']),
    dailySchedule: fact('10:00-17:00'),
    workingHours: fact('09:30-17:30'),
    hoursPerSession: fact(7),
    totalHours: fact(21),
    headcount: fact(1, '운영 조건'),
    objectives: fact(['AI 코딩 도구로 실무 코드를 작성할 수 있다']),
    curriculumOutline: fact([
      { label: '1일차', content: 'Claude Code와 Codex CLI 기초', kind: '실습' },
      { label: '2일차', content: '하네스 엔지니어링', kind: '실습' },
      { label: '3일차', content: 'MCP와 Agentic Coding', kind: '프로젝트' }
    ]),
    topics: fact(['AI 코딩 기초', 'Claude Code', 'MCP', 'Agentic Coding']),
    environmentConstraints: fact(['개인 노트북', 'Python 3.11 이상', 'Node.js 20 이상', '외부망 접속']),
    responsibilities: fact(['실습 중 수강생 개별 지원', '환경 설정 오류 대응']),
    requiredQualifications: fact([qual('Python·Node.js 기초 이해')]),
    preferredQualifications: fact([]),
    travelExpenseIncluded: fact(false, '운영 조건'),
    applicationMethod: fact('recruit@example.com으로 이력서 발송', '운영 조건'),
    deadline: fact('2026-08-25', '운영 조건'),
    deadlineTime: fact('18:00', '운영 조건'),
    ...overrides
  };
}

export function baseResult(overrides = {}) {
  return {
    facts: baseFacts(overrides.facts),
    missingFields: [],
    conflicts: [],
    warnings: [],
    ...overrides,
    ...(overrides.facts ? { facts: baseFacts(overrides.facts) } : {})
  };
}
