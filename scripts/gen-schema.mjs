import { writeFileSync } from 'node:fs';

const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const TIME = '^([01]\\d|2[0-3]):[0-5]\\d$';
const TIME_RANGE = '^([01]\\d|2[0-3]):[0-5]\\d-([01]\\d|2[0-3]):[0-5]\\d$';

function fact(valueSchema) {
  return {
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

// Keys follow jd-writer's required JD sections one-to-one.
const factProperties = {
  // 1. 헤더
  role: fact({ enum: ['주강사', '보조강사'] }),
  courseTitle: fact(nStr),
  customerLabel: fact(nStr),
  customerDisclosure: fact({ enum: ['hidden', 'approved'] }),
  // 2. 교육 개요
  audience: fact(nStr),
  format: fact(nStr),
  location: fact(nStr),
  sessionDates: fact({ type: 'array', items: { type: 'string', pattern: DATE } }),
  dailySchedule: fact({ type: ['string', 'null'], pattern: TIME_RANGE }),
  workingHours: fact({ type: ['string', 'null'], pattern: TIME_RANGE }),
  hoursPerSession: fact(nNum),
  totalHours: fact(nNum),
  headcount: fact(nInt),
  // 3. 교육 목표
  objectives: fact(strArr),
  // 4. 교육 내용
  curriculumOutline: fact({
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
  }),
  topics: fact(strArr),
  environmentConstraints: fact(strArr),
  // 5. 담당 업무 / 강사 지원 자격
  responsibilities: fact(strArr),
  requiredQualifications: fact(qualArr),
  preferredQualifications: fact(qualArr),
  // 6. 강사료 (금액은 항상 담당자가 직접 기입 -> 출장비 포함 여부만 사실로 다룬다)
  travelExpenseIncluded: fact(nBool),
  // 7. 마감 기한 / 지원 안내
  applicationMethod: fact(nStr),
  deadline: fact({ type: ['string', 'null'], pattern: DATE }),
  deadlineTime: fact({ type: ['string', 'null'], pattern: TIME })
};

const keys = Object.keys(factProperties);

const schema = {
  // $schema는 넣지 않는다. Claude CLI의 --json-schema 검증기가
  // "no schema with key or ref https://json-schema.org/draft/2020-12/schema" 로
  // 거부한다 (메타스키마를 오프라인에서 해석하지 못함).
  title: 'InstructorRecruitmentFacts',
  description: 'jd-writer 서식에 필요한 사실만 담는다. 공고 본문은 코드(render.mjs)가 조립하므로 모델이 만들지 않는다.',
  type: 'object',
  additionalProperties: false,
  required: ['facts', 'missingFields', 'conflicts', 'warnings'],
  properties: {
    facts: {
      type: 'object',
      additionalProperties: false,
      required: keys,
      properties: factProperties
    },
    missingFields: {
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
    warnings: strArr
  }
};

const target = process.argv[2]
  ?? new URL('../schemas/recruitment-result.schema.json', import.meta.url).pathname;
writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`wrote ${target}`);
console.log(`fact keys (${keys.length}): ${keys.join(', ')}`);
