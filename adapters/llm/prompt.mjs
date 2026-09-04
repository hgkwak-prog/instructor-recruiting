/**
 * 프롬프트 조립. 모델 호출 방식(CLI냐 SDK냐)과 분리해 둔다 —
 * 호출 레이어를 갈아끼워도 모델이 보는 글자는 한 글자도 바뀌면 안 되기 때문이다.
 * P1의 CLI판/SDK판 동일성 검증이 이 분리 위에서만 성립한다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { factKeys } from '../../core/schema.mjs';

const SKILL_PATH = ['skills', 'jd-fact-extraction', 'SKILL.md'];

/**
 * 규칙의 출처는 둘로 나뉜다.
 *
 *   항목별 기준  -> 스키마의 `description` (필드 바로 옆에 붙는다)
 *   전역 규칙    -> 이 SKILL.md (한 필드에 붙일 수 없는 것만)
 *
 * 예전에는 24개 필드 설명이 스키마 밖 산문에 있었고, 그래서 코드가 바뀌어도
 * 따라오지 않아 없는 파일 경로를 가리키는 문장 같은 게 남았다. 필드 설명은
 * 필드와 같은 파일에 둔다.
 *
 * `## Rules` 이하는 글자 그대로 주입된다.
 */
export function readSkillRules(projectRoot) {
  const raw = readFileSync(join(projectRoot, ...SKILL_PATH), 'utf8');
  // Anchored to a line-start heading: a bare indexOf also matched the prose
  // mention of `## Rules` in the note above it and truncated the rules.
  const match = /^## Rules$/m.exec(raw);
  if (!match) throw new Error('SKILL.md에 "## Rules" 섹션이 없습니다. 규칙 주입이 불가능합니다.');
  return raw.slice(match.index).trim();
}

export function buildPrompt({ projectRoot, curriculum, conditions, schema }) {
  const rules = readSkillRules(projectRoot);
  const keyList = factKeys(schema);
  const keys = keyList.join(', ');
  return [
    '당신은 강사 구인 운영 담당자입니다. 아래 [커리큘럼]과 [운영 조건]만을 근거로 사실을 추출하세요.',
    '규칙은 아래 [규칙] 블록이 전부입니다. 그 밖의 상식이나 추론으로 사실을 만들지 마세요.',
    '공고 본문은 작성하지 않습니다. 본문은 코드가 이 사실들로 조립합니다.',
    '',
    '[규칙]',
    rules,
    '',
    `[facts 키 목록] ${keys}`,
    `이 ${keyList.length}개 키를 모두 포함해야 하며, 키 이름을 바꾸거나 추가하지 마세요.`,
    '',
    '[커리큘럼]',
    curriculum,
    '',
    '[운영 조건]',
    JSON.stringify(conditions, null, 2),
    '',
    '설명 없이 JSON 객체 하나만 출력하세요.'
  ].join('\n');
}

/**
 * `--dry-run`이 읽을 수 있도록 실제로 보낼 프롬프트를 파일로 남긴다.
 * SKILL.md 규칙을 고친 뒤 무엇이 주입되는지 확인하는 유일한 수단이다.
 */
export function writePromptFile({ prompt, runDirectory }) {
  mkdirSync(runDirectory, { recursive: true });
  const promptPath = join(runDirectory, 'prompt.txt');
  writeFileSync(promptPath, prompt);
  return promptPath;
}

/**
 * `$schema` 키를 떼어낸다.
 *
 * Claude CLI의 `--json-schema` 검증기가 2020-12 메타스키마를 오프라인에서 해석하지
 * 못해, 이 키가 있으면 스키마 전체를 거부했다:
 *   Error: --json-schema is not a valid JSON Schema:
 *   no schema with key or ref "https://json-schema.org/draft/2020-12/schema"
 *
 * Agent SDK도 같은 CLI 바이너리를 스폰하므로 재발 가능성이 있어 그대로 둔다.
 * 이 키는 순수 주석이고 아래로 읽는 곳이 없다.
 */
export function stripMetaSchema(schema) {
  const parsed = typeof schema === 'string' ? JSON.parse(schema) : structuredClone(schema);
  delete parsed.$schema;
  return parsed;
}
