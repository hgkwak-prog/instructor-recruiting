/**
 * 옛 Claude CLI 호출본. **P1의 A/B 비교에만 남겨 둔다.**
 *
 * 운영 경로는 `claude-agent.mjs`(Agent SDK)다. 이 파일은 SDK 전환이
 * 같은 커리큘럼에서 같은 facts를 내는지 확인하기 위한 대조군이고,
 * 확인이 끝나면 지운다(P2). 프롬프트 조립은 `prompt.mjs`가 하므로
 * 두 경로가 모델에게 보내는 글자는 동일하다.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { validate } from '../../core/schema.mjs';
import { stripMetaSchema } from './prompt.mjs';

export const DEFAULT_MODEL = process.env.RECRUIT_MODEL ?? 'claude-sonnet-4-6';

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
        'Claude CLI 인증이 필요합니다. `claude` 실행 후 `/login`, 또는 비대화형 환경이면 '
        + `\`claude setup-token\`을 사용하세요.\n원본: ${message}`
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

export function runClaude({ schemaPath, promptPath, model = DEFAULT_MODEL, attempts = 2 }) {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const cliSchema = JSON.stringify(stripMetaSchema(schema));
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
