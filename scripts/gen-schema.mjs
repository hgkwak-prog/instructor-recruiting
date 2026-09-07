import { writeFileSync } from 'node:fs';

const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const TIME = '^([01]\\d|2[0-3]):[0-5]\\d$';
const TIME_RANGE = '^([01]\\d|2[0-3]):[0-5]\\d-([01]\\d|2[0-3]):[0-5]\\d$';

/**
 * 항목별 추출 기준은 **여기 description에** 산다. 필드와 같은 파일에 두는 것이 요점이다.
 *
 * 예전에는 24개 필드 설명이 SKILL.md라는 딴 파일에 있었고, 코드가 바뀌어도
 * 따라오지 않아 없는 파일 경로를 가리키는 문장이 오래 남아 있었다. SKILL.md에는
 * 한 필드에 붙일 수 없는 규칙(금액 금지, 출력 규약)만 남긴다.
 *
 * description을 필수 인자로 둔 건 실수 방지다 — 설명 없이 필드를 추가할 수 없다.
 */
function fact(description, valueSchema) {
  if (!description) throw new Error('fact()에는 description이 필요합니다.');
  return {
    description,
    type: 'object',
    additionalProperties: false,
    required: ['value', 'evidence'],
    properties: { value: valueSchema, evidence: { type: ['string', 'null'] } }
  };
}

const nStr = { type: ['string', 'null'] };
const nNum = { type: ['number', 'null'] };
const nInt = { type: ['integer', 'null'] };
const nBool = { type: ['boolean', 'null'] };
const strArr = { type: 'array', items: { type: 'string' } };

// 자격 조건은 원문 근거(sourced: true)와 모델 제안(false)을 구분한다.
// 제안도 허용하되, 검토자가 무엇을 확인해야 하는지 알 수 있어야 한다.
const qualArr = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'sourced'],
    properties: { text: { type: 'string' }, sourced: { type: 'boolean' } }
  }
};

// 키는 JD 서식의 필수 구성 요소와 일대일로 맞춘다. 어떤 섹션도 소비하지 않는
// 사실은 뽑을 이유가 없고, 섹션이 있는데 사실이 없으면 [확인 필요]가 남는다.
const factProperties = {
  // 1. 헤더
  role: fact(
    '주강사인지 보조강사인지. 문서만으로 판단되지 않으면 missingFields에 blocking: true로 넣는다. '
    + '역할이 정해지지 않으면 자격 요건도 강사료 표기도 결정할 수 없다.',
    { enum: ['주강사', '보조강사'] }
  ),
  courseTitle: fact('교육 과정명. 공고 제목이 된다.', nStr),
  customerLabel: fact(
    '고객사 표기. 공고에 고객사는 나가지 않으므로 원문에 실명이 있어도 넣지 않는다. null이 기본이다.',
    nStr
  ),
  customerDisclosure: fact(
    '고객사 공개 여부. hidden으로 둔다. approved는 담당자가 운영 조건으로 넘길 때만 들어간다 '
    + '— 원문에 고객사명이 적혀 있다는 것은 공개 승인이 아니다.',
    { enum: ['hidden', 'approved'] }
  ),
  // 2. 교육 개요
  audience: fact('수강생이 누구인지. 직군·소속·수준을 포함한다.', nStr),
  format: fact('온라인 / 오프라인 / 병행. 문서 표현을 그대로 쓴다.', nStr),
  location: fact(
    '교육 장소. 층수까지 적혀 있으면 그대로 넣는다 — 공고에는 시/군/구까지만 잘려 나가고, '
    + '정확한 값은 내부 확인용이다. 오프라인인데 없으면 blocking: true.',
    nStr
  ),
  sessionDates: fact(
    '실제 교육일을 전부 나열한다. 요일은 쓰지 않는다. "매주 화요일 3회"처럼 실제 날짜가 없으면 '
    + '빈 배열로 두고 missingFields에 넣는다. 추론해서 날짜를 만들지 않는다. '
    + '공고 최상단의 예상 업무 일정 문구가 이 배열의 첫날·마지막날로 만들어진다.',
    { type: 'array', items: { type: 'string', pattern: DATE } }
  ),
  dailySchedule: fact(
    '하루 교육 시간대를 시간표에 적힌 그대로. 이 범위가 hoursPerSession보다 넓은 것은 '
    + '휴게시간이지 불일치가 아니다 — conflicts에 넣지 마라. 차이가 90분 이내면 휴게시간으로 '
    + '처리되고, 그보다 크면 경고가, 음수면 오류가 난다.',
    { type: ['string', 'null'], pattern: TIME_RANGE }
  ),
  workingHours: fact(
    '강사 근무 시간대. 교육 시간보다 넓은 근무 시간이 문서에 따로 있을 때만 채운다. '
    + '교육 전후 준비·정리 시간이며 지원자가 반드시 알아야 할 조건이다. '
    + '없으면 null이며 dailySchedule을 복사하지 않는다.',
    { type: ['string', 'null'], pattern: TIME_RANGE }
  ),
  hoursPerSession: fact(
    '하루 순 교육시간. 문서에 적힌 값만 넣는다. totalHours를 회차로 나눠 채우지 않는다.',
    nNum
  ),
  totalHours: fact(
    '총 교육 시수. 문서에 적힌 값만 넣는다. hoursPerSession × 회차로 계산해 채우지 않는다 '
    + '— 코드가 검산한다.',
    nNum
  ),
  headcount: fact('모집 인원.', nInt),
  // 3. 교육 목표 (추출하되 공고에는 나가지 않는다)
  objectives: fact(
    '수강생이 이 과정으로 갖추게 될 역량·결과물. 각 항목은 한 문장. '
    + '정확히 추출하되 공고 본문에는 나가지 않는다(검토 리포트 전용).',
    strArr
  ),
  // 4. 교육 내용 (설계는 영업비밀 -> topics만 공개된다)
  curriculumOutline: fact(
    '일차별 또는 주차별 세부 내용. label은 문서가 쓰는 구분 단위를 그대로 따른다(1일차, 2주차). '
    + '정확히 추출하되 공고 본문에는 나가지 않는다 — 커리큘럼 설계는 우리가 파는 상품이라 '
    + '경쟁사가 공고만 읽고 베낄 수 있으면 안 된다.',
    {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'content', 'kind'],
        properties: {
          label: { type: 'string' },
          content: { type: 'string' },
          kind: { enum: ['이론', '실습', '프로젝트', '혼합'] }
        }
      }
    }
  ),
  topics: fact(
    '공고에 나갈 주제 키워드 4~6개. curriculumOutline을 주제어로 압축한다. 커리큘럼 문장을 '
    + '그대로 옮기지 않는다. 과정 내용 중 공개되는 유일한 항목이므로, 지원자가 자기 분야인지 '
    + '판단할 정도면 충분하고 설계는 드러나지 않아야 한다.',
    strArr
  ),
  environmentConstraints: fact(
    '실습·프로젝트가 있을 때 지원자가 지원 여부를 판단하는 데 필요한 최소 조건만 담는다 '
    + '(예: 노트북 지참, 특정 OS, 외부망 접속 필요, 사용할 핵심 언어·툴 이름). '
    + '패키지 버전·API 키 종류·사내 시스템명·데이터셋 출처 같은 세부 스펙은 담지 않는다 '
    + '— 그건 채용 후 실무에서 안내할 정보지 공고 단계에서 지원자가 알 필요는 없다. '
    + '최대 4개, 각 항목은 짧은 명사구 하나로(괄호 부연 설명 없이). 없으면 빈 배열.',
    strArr
  ),
  // 5. 담당 업무 / 강사 지원 자격
  responsibilities: fact(
    '담당 업무. 문서에 "예상 역할", "강사 역할" 같은 항목이 있으면 그대로 옮긴다. '
    + '없으면 빈 배열로 둔다 — 역할별 표준 세트가 채워진다. 비슷한 걸 지어 쓰면 매번 표현만 '
    + '달라진다. 있을 때는 4~5개, 각 한 줄.',
    strArr
  ),
  requiredQualifications: fact(
    '역량 조건만 쓴다. 일정 참여 가능·교육장 출근 가능·근무 시간 가능 같은 물류 조건은 넣지 마라 '
    + '— 확정된 사실에서 자동으로 붙는다. 원문에 없으면 제안해도 되지만, 문서에서 한 단계 안에 '
    + '따라올 수 있는 것만 3개까지다(다루는 도구를 쓸 줄 알 것, 수강 대상 눈높이로 설명할 수 있을 것, '
    + '해당 도메인을 이해할 것). 연차·학력·자격증·특정 회사 경력처럼 문서에서 나올 수 없는 기준은 '
    + '만들지 마라. 보조강사면 기초 지식과 실습 지원 능력까지만 요구한다. '
    + 'sourced는 원문이나 운영 조건에 명시됐으면 true, 네 제안이면 false.',
    qualArr
  ),
  preferredQualifications: fact(
    '우대 조건. 제안하지 않는다. 원문에 명시된 것만 sourced: true로 넣고, 없으면 빈 배열로 둔다.',
    qualArr
  ),
  // 6. 강사료 (금액은 항상 담당자가 직접 기입 -> 출장비 포함 여부만 사실로 다룬다)
  travelExpenseIncluded: fact(
    '타 지역 출장이 발생하는 건일 때만 true. 그 외에는 false 또는 null. '
    + 'true면 강사료 줄에 "출장비 포함"이 붙는다.',
    nBool
  ),
  // 7. 마감 기한 / 지원 안내
  applicationMethod: fact(
    '지원 방법(이메일·폼·DM 등). 없으면 blocking: true — 지원 경로가 없으면 아무도 지원할 수 없다.',
    nStr
  ),
  deadline: fact('모집 마감일.', { type: ['string', 'null'], pattern: DATE }),
  deadlineTime: fact(
    '모집 마감 시각. 원문에 "2026-09-30 18:00"처럼 시각까지 있으면 버리지 말고 여기 나눠 넣는다. '
    + '날짜만 나가면 지원자가 자정까지로 오해한다.',
    { type: ['string', 'null'], pattern: TIME }
  )
};

const keys = Object.keys(factProperties);

const schema = {
  // $schema는 넣지 않는다. Claude CLI의 --json-schema 검증기가
  // "no schema with key or ref https://json-schema.org/draft/2020-12/schema" 로
  // 거부한다 (메타스키마를 오프라인에서 해석하지 못함).
  title: 'InstructorRecruitmentFacts',
  description: '강사 구인 공고에 필요한 사실만 담는다. 공고 본문은 코드가 이 사실들로 조립하므로 모델이 문장을 쓰지 않는다.',
  type: 'object',
  additionalProperties: false,
  required: ['facts', 'missingFields', 'conflicts', 'warnings'],
  properties: {
    facts: {
      description: '각 항목은 { value, evidence } 다. 근거가 있으면 value와 함께 evidence에 원문 인용을 넣고, '
        + '없으면 value를 null(배열이면 빈 배열)로 두고 missingFields에 넣는다. 지어내지 않는다.',
      type: 'object',
      additionalProperties: false,
      required: keys,
      properties: factProperties
    },
    missingFields: {
      description: '값을 못 채운 항목. blocking: true는 그 값이 없으면 공고를 낼 수 없다는 뜻이다. '
        + 'question은 담당자에게 한 번에 모아 물을 문장이다.',
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'blocking', 'question'],
        properties: {
          field: { enum: keys },
          blocking: { type: 'boolean' },
          question: { type: 'string' }
        }
      }
    },
    conflicts: {
      description: '문서가 같은 항목에 서로 다른 값을 말할 때. 네가 고르지 말고 여기 담는다.',
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'values', 'note'],
        properties: {
          field: { enum: keys },
          values: strArr,
          note: { type: 'string' }
        }
      }
    },
    warnings: { description: '위 어디에도 안 맞지만 사람이 알아야 할 것.', ...strArr }
  }
};

const target = process.argv[2]
  ?? new URL('../schemas/recruitment-result.schema.json', import.meta.url).pathname;
writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`wrote ${target}`);
console.log(`fact keys (${keys.length}): ${keys.join(', ')}`);
