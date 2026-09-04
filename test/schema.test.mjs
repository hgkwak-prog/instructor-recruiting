import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate, factKeys, unknownKeywords } from '../core/schema.mjs';
import { readSkillRules, buildPrompt } from '../adapters/llm/prompt.mjs';
import { baseResult, fact } from './fixtures.mjs';

const projectRoot = join(import.meta.dirname, '..');
const schema = JSON.parse(readFileSync(join(projectRoot, 'schemas', 'recruitment-result.schema.json'), 'utf8'));

test('the shipped schema uses only keywords the validator implements', () => {
  assert.deepEqual(unknownKeywords(schema), []);
});

test('accepts a well-formed result', () => {
  assert.deepEqual(validate(baseResult(), schema), []);
});

test('rejects a model-authored job post', () => {
  // The model must not write the body -- render.mjs does.
  const result = { ...baseResult(), slackJobPost: '보조강사 모집합니다' };
  assert.ok(validate(result, schema).some((e) => e.includes('slackJobPost')));
});

test('rejects an invented fact key', () => {
  const result = baseResult();
  result.facts.instructorRole = fact('보조강사');
  assert.ok(validate(result, schema).some((e) => e.includes('instructorRole')));
});

test('rejects a missing fact key', () => {
  const result = baseResult();
  delete result.facts.objectives;
  assert.ok(validate(result, schema).some((e) => e.includes('objectives')));
});

test('rejects a role outside the allowed pair', () => {
  const result = baseResult();
  result.facts.role = fact('튜터');
  assert.ok(validate(result, schema).some((e) => e.includes('허용값이 아닙니다')));
});

test('rejects a malformed curriculum entry', () => {
  const result = baseResult();
  result.facts.curriculumOutline = fact([{ label: '1일차', content: '내용' }]);
  assert.ok(validate(result, schema).some((e) => e.includes('kind')));
});

test('rejects a malformed date and a fractional headcount', () => {
  const result = baseResult();
  result.facts.sessionDates = fact(['2026/09/01']);
  result.facts.headcount = fact(1.5);
  const errors = validate(result, schema);
  assert.ok(errors.some((e) => e.includes('sessionDates')));
  assert.ok(errors.some((e) => e.includes('headcount')));
});

test('rejects a missingFields entry naming an unknown field', () => {
  const result = baseResult();
  result.missingFields = [{ field: 'salaryRange', blocking: true, question: '?' }];
  assert.ok(validate(result, schema).some((e) => e.includes('허용값이 아닙니다')));
});

test('prompt is built from SKILL.md and carries every fact key', () => {
  const rules = readSkillRules(projectRoot);
  const prompt = buildPrompt({ projectRoot, curriculum: 'c', conditions: {}, schema });
  assert.ok(prompt.includes(rules), '프롬프트에 SKILL.md 규칙이 그대로 들어가야 합니다');
  for (const key of factKeys(schema)) assert.ok(prompt.includes(key), `프롬프트에 ${key}가 없습니다`);
  assert.match(prompt, new RegExp(`이 ${factKeys(schema).length}개 키`), '키 개수가 스키마와 어긋납니다');
});

test('the rules file tells the model not to write the post body', () => {
  const rules = readSkillRules(projectRoot);
  assert.match(rules, /본문/);
});

test('커밋된 스키마는 gen-schema.mjs가 만든 것과 같다', async () => {
  // 설명이 스키마 안에 사는 이상, 생성기와 파일이 어긋나면 다음 재생성 때
  // 설명이 통째로 날아간다. 생성기를 고치고 파일을 안 만든 경우도 여기서 걸린다.
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const target = join(mkdtempSync(join(tmpdir(), 'schema-')), 'out.json');
  execFileSync(process.execPath, [join(projectRoot, 'scripts', 'gen-schema.mjs'), target]);
  assert.deepEqual(
    JSON.parse(readFileSync(target, 'utf8')),
    schema,
    'scripts/gen-schema.mjs를 다시 돌려 schemas/를 갱신하세요'
  );
});

test('모든 fact에 description이 있다', () => {
  // 항목별 추출 기준의 출처는 스키마다. 설명 없는 필드가 생기면 그 필드는
  // 모델에게 이름과 타입만으로 전달된다 -- 무엇을 넣으라는 말이 어디에도 없게 된다.
  const facts = schema.properties.facts.properties;
  const undocumented = Object.keys(facts).filter((key) => !facts[key].description);
  assert.deepEqual(undocumented, [], '설명 없는 필드가 있습니다');
});

test('한 필드에 매이는 규칙은 SKILL.md가 아니라 스키마에 있다', () => {
  // 이 분리가 무너지면 같은 규칙이 두 곳에 생기고, 한쪽만 고쳐진 채로 남는다.
  // 실제로 그렇게 해서 없는 파일 경로를 가리키는 문장이 오래 남아 있었다.
  const rules = readSkillRules(projectRoot);
  const facts = schema.properties.facts.properties;
  const perField = [
    ['추론해서 날짜를 만들지 않는다', 'sessionDates'],
    ['계산해 채우지 않는다', 'totalHours'],
    ['휴게시간', 'dailySchedule'],
    ['주제어로 압축', 'topics'],
    ['물류 조건은 넣지 마라', 'requiredQualifications']
  ];
  for (const [phrase, key] of perField) {
    assert.ok(facts[key].description.includes(phrase), `${key} 설명에 "${phrase}"가 없습니다`);
    assert.ok(!rules.includes(phrase), `"${phrase}"가 SKILL.md에도 있습니다 (${key}와 중복)`);
  }
});

test('필드 하나에 매이지 않는 규칙은 SKILL.md에 남는다', () => {
  // 금액 금지는 특정 필드가 아니라 전 필드에 걸리는 규칙이라 description으로 옮길 수 없다.
  //
  // 여기 없는 두 가지는 일부러 뺐다. 근거가 얇아서 관찰해 보기로 한 것이다.
  //
  //   "운영 조건이 문서를 이긴다" -- applyConditions가 override: true로 이미 덮어쓴다.
  //     모델이 뭘 고르든 결과가 같다. 남는 값어치는 커리큘럼과 운영 조건의 차이를
  //     conflicts에 올리지 않게 막는 것뿐이다. 리포트가 시끄러워지면 되돌린다.
  //
  //   "짧게 쓴다" -- 실제 분량 제약은 전부 필드별이고(responsibilities 4~5개,
  //     topics 4~6개, 자격 한 줄) 그건 description에 있다. 목록이 길어지면 되돌린다.
  const rules = readSkillRules(projectRoot);
  for (const phrase of ['금액은 어떤 필드에도', '지어내지 않는다']) {
    assert.ok(rules.includes(phrase), `SKILL.md에 "${phrase}"가 없습니다`);
  }
});

test('the shipped schema carries no $schema key', () => {
  // Claude CLI의 --json-schema 검증기가 2020-12 메타스키마를 오프라인에서
  // 해석하지 못해 $schema가 있으면 스키마 전체를 거부한다.
  assert.ok(!Object.hasOwn(schema, '$schema'));
});

test('stripMetaSchema strips $schema even if it is reintroduced', async () => {
  const { stripMetaSchema } = await import('../adapters/llm/prompt.mjs');
  const withMeta = JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' });
  const stripped = stripMetaSchema(withMeta);
  assert.ok(!Object.hasOwn(stripped, '$schema'));
  assert.equal(stripped.type, 'object');
});
