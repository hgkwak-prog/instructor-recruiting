import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate, factKeys, unknownKeywords } from '../core/schema.mjs';
import { readSkillRules, buildPrompt } from '../adapters/llm/claude-cli.mjs';
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
  assert.match(rules, /Never derive, never guess|추론해서 날짜를 만들지 않는다/);
  const prompt = buildPrompt({ projectRoot, curriculum: 'c', conditions: {}, schema });
  assert.ok(prompt.includes(rules), '프롬프트에 SKILL.md 규칙이 그대로 들어가야 합니다');
  for (const key of factKeys(schema)) assert.ok(prompt.includes(key), `프롬프트에 ${key}가 없습니다`);
  assert.match(prompt, new RegExp(`이 ${factKeys(schema).length}개 키`), '키 개수가 스키마와 어긋납니다');
});

test('the rules file tells the model not to write the post body', () => {
  const rules = readSkillRules(projectRoot);
  assert.match(rules, /본문|render\.mjs/);
});

test('the shipped schema carries no $schema key', () => {
  // Claude CLI의 --json-schema 검증기가 2020-12 메타스키마를 오프라인에서
  // 해석하지 못해 $schema가 있으면 스키마 전체를 거부한다.
  assert.ok(!Object.hasOwn(schema, '$schema'));
});

test('toCliSchema strips $schema even if it is reintroduced', async () => {
  const { toCliSchema } = await import('../adapters/llm/claude-cli.mjs');
  const withMeta = JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' });
  const stripped = JSON.parse(toCliSchema(withMeta));
  assert.ok(!Object.hasOwn(stripped, '$schema'));
  assert.equal(stripped.type, 'object');
});
