import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { validate, factKeys } from '../../core/schema.mjs';

export const DEFAULT_MODEL = process.env.RECRUIT_MODEL ?? 'claude-sonnet-4-6';

const SKILL_PATH = ['skills', 'jd-writer', 'SKILL.md'];

/**
 * SKILL.md is the single source of recruitment rules. Everything from `## Rules`
 * onward is injected verbatim so the skill and the CLI can never drift apart.
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

export function prepareClaudeInvocation({ projectRoot, prompt, runDirectory }) {
  mkdirSync(runDirectory, { recursive: true });
  const schemaPath = join(projectRoot, 'schemas', 'recruitment-result.schema.json');
  const promptPath = join(runDirectory, 'prompt.txt');
  writeFileSync(promptPath, prompt);
  return { schemaPath, promptPath };
}

/**
 * The CLI's --json-schema validator cannot resolve the 2020-12 meta-schema
 * offline, so a `$schema` key makes it reject the whole schema with
 * "no schema with key or ref ...". We strip it defensively: the key is pure
 * annotation and nothing downstream reads it.
 */
export function toCliSchema(schemaText) {
  const parsed = JSON.parse(schemaText);
  delete parsed.$schema;
  return JSON.stringify(parsed);
}

function invoke(prompt, schemaText, model) {
  const result = spawnSync('claude', [
    '-p', prompt,
    '--model', model,
    '--output-format', 'json',
    '--json-schema', schemaText,
    '--no-session-persistence'
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

  if (result.error) throw new Error(`Claude CLI 실행 실패: ${result.error.message}`);
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || '').trim();
    if (/not logged in|unauthorized|authentication|credit balance|login/i.test(message)) {
      throw new Error(
        `Claude CLI 인증이 필요합니다. \`claude\` 실행 후 \`/login\`, 또는 비대화형 환경이면 \`claude setup-token\`을 사용하세요.\n원본: ${message}`
      );
    }
    if (/not a valid JSON Schema/i.test(message)) {
      throw new Error(
        `Claude CLI가 출력 스키마를 거부했습니다. schemas/recruitment-result.schema.json을 확인하세요.\n`
        + `\`node scripts/gen-schema.mjs\`로 재생성할 수 있습니다.\n원본: ${message}`
      );
    }
    throw new Error(`Claude CLI 오류: ${message}`);
  }

  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Claude CLI 응답을 JSON으로 읽지 못했습니다: ${result.stdout.slice(0, 400)}`);
  }
  const payload = typeof envelope.result === 'string' ? envelope.result : JSON.stringify(envelope.result);
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(`모델 응답이 JSON이 아닙니다: ${String(payload).slice(0, 400)}`);
  }
}

/**
 * --json-schema constrains the CLI, but we re-validate locally so a contract
 * break is a loud failure instead of a silent null flowing down the pipeline.
 */
export function runClaude({ schemaPath, promptPath, model = DEFAULT_MODEL, attempts = 2 }) {
  const schemaText = readFileSync(schemaPath, 'utf8');
  const schema = JSON.parse(schemaText);
  const cliSchema = toCliSchema(schemaText);
  const basePrompt = readFileSync(promptPath, 'utf8');

  let lastErrors = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const prompt = attempt === 1
      ? basePrompt
      : `${basePrompt}\n\n[이전 응답 오류] 아래 문제를 모두 고쳐 다시 출력하세요.\n- ${lastErrors.join('\n- ')}`;
    const value = invoke(prompt, cliSchema, model);
    lastErrors = validate(value, schema);
    if (lastErrors.length === 0) return { result: value, attempts: attempt };
  }
  throw new Error(`모델 응답이 스키마를 ${attempts}회 연속 위반했습니다:\n- ${lastErrors.join('\n- ')}`);
}
