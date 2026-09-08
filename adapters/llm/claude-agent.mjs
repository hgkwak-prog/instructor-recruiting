/**
 * Claude Agent SDK 호출 어댑터.
 *
 * **SDK를 에이전트로 쓰지 않는다.** 툴 0개·1턴·JSON Schema 강제의 구조화 추출기로만 쓴다.
 * 이 레포의 전제는 "모델은 사실만 추출하고, 공고 본문은 코드가 조립한다"이고,
 * 모델에게 자율성을 주면 매 실행마다 표현과 판단이 흔들린다. 초판에서 화요일을 `(월)`로
 * 적은 공고가 나간 사고가 정확히 그 성질이었다.
 *
 * 인증은 정액제 구독이다(guards.mjs 참고). 종량제 API 키가 아니다.
 */
import { validate } from '../../core/schema.mjs';
import { stripMetaSchema } from './prompt.mjs';
import { assertSubscriptionAuth } from './guards.mjs';
import { envOr } from '../../core/env.mjs';

export const DEFAULT_MODEL = envOr(process.env, 'RECRUIT_MODEL', 'claude-sonnet-5');

const SYSTEM_PROMPT = [
  '당신은 강사 구인 운영 담당자입니다.',
  '주어진 커리큘럼과 운영 조건만을 근거로 사실을 추출합니다.',
  '공고 본문은 작성하지 않습니다. 본문은 코드가 조립합니다.',
  '근거가 없는 값은 null로 두세요. 상식이나 추론으로 채우지 마세요.'
].join('\n');

/**
 * 모델을 가두는 설정. 하나라도 빠지면 추출기가 아니라 에이전트가 된다.
 *
 * - `allowedTools: []`  파일·bash 접근 차단. 모델이 "알아서" 뭔가 읽지 못하게
 * - `permissionMode: 'dontAsk'`  허용 목록 밖은 묻지 않고 거부
 * - `maxTurns: 4`  대화는 아니지만, 구조화 출력을 한 번에 못 맞추면 SDK가 자체
 *   재시도로 한 번 더 왕복한다(`error_max_structured_output_retries`). 작은 예시
 *   커리큘럼은 1턴에 끝나지만 실제 제안서 PDF처럼 크고 복잡한 문서는 그 재시도가
 *   필요해서 `maxTurns: 1`로는 "Reached maximum number of turns (1)"로 막혔다
 *   (2026-09 실사용에서 재현). 에이전트 자율성을 막는 건 이 값이 아니라
 *   `allowedTools: []`이므로, 턴 수를 늘려도 격리는 그대로 유지된다.
 * - `settingSources: []`  **SDK 격리 모드.** 이걸 빼면 `~/.claude/settings.json`,
 *   `.claude/settings.local.json`, CLAUDE.md를 읽어들여 **개발자의 로컬 설정이
 *   추출 결과에 새어 들어온다.** 같은 커리큘럼이 사람마다 다른 facts를 내는 원인이 된다.
 */
export const ISOLATION_OPTIONS = Object.freeze({
  allowedTools: [],
  permissionMode: 'dontAsk',
  maxTurns: 4,
  settingSources: []
});

export class ModelInvocationError extends Error {
  constructor(message, { subtype, cause } = {}) {
    super(message);
    this.name = 'ModelInvocationError';
    this.subtype = subtype;
    this.cause = cause;
  }
}

export class SchemaViolationError extends Error {
  constructor(message, { errors, attempts }) {
    super(message);
    this.name = 'SchemaViolationError';
    this.errors = errors;
    this.attempts = attempts;
  }
}

const AUTH_PATTERN = /not logged in|unauthorized|authentication|login expired|credit balance|oauth/i;
const LIMIT_PATTERN = /usage limit|rate limit|too many requests|quota/i;

function describeFailure(result) {
  const detail = [result?.subtype, result?.stop_reason, result?.terminal_reason]
    .filter(Boolean)
    .join(' / ') || '알 수 없는 오류';

  if (AUTH_PATTERN.test(detail)) {
    return '구독 인증이 필요합니다. `claude setup-token`으로 토큰을 발급해 '
      + 'CLAUDE_CODE_OAUTH_TOKEN에 넣거나, 로컬에서는 `claude` 실행 후 `/login` 하세요.\n'
      + `원본: ${detail}`;
  }
  if (LIMIT_PATTERN.test(detail)) {
    return '구독 사용 한도에 걸렸습니다. SDK 사용량은 대화형 Claude와 같은 한도를 씁니다. '
      + `한도가 회복된 뒤 다시 실행하세요.\n원본: ${detail}`;
  }
  return `모델 호출이 실패했습니다: ${detail}`;
}

/**
 * 한 번 호출한다. 스키마 검증은 하지 않는다 — 호출자가 한다.
 * `query`를 주입받는 이유는 테스트에서 네트워크를 타지 않기 위해서다.
 */
export async function invokeOnce({
  prompt,
  schema,
  model = DEFAULT_MODEL,
  maxBudgetUsd,
  abortController,
  query,
  onMessage
}) {
  if (typeof query !== 'function') {
    throw new TypeError('query 구현이 필요합니다 (기본값은 createExtractor가 주입합니다).');
  }

  const options = {
    ...ISOLATION_OPTIONS,
    model,
    systemPrompt: SYSTEM_PROMPT,
    outputFormat: { type: 'json_schema', schema: stripMetaSchema(schema) }
  };
  if (typeof maxBudgetUsd === 'number') options.maxBudgetUsd = maxBudgetUsd;
  if (abortController) options.abortController = abortController;

  let result;
  try {
    // SDK가 스트리밍으로 내는 메시지(system/assistant/result 등)를 그대로
    // 호출자에게 넘긴다 — 시간 기반 하트비트 대신 실제로 무슨 일이 일어나고
    // 있는지(모델이 응답을 만드는 중인지, 재시도가 도는 중인지)를 슬랙에
    // 보여주기 위함이다(2026-09-08, 사용자 요청).
    for await (const message of query({ prompt, options })) {
      onMessage?.(message);
      if (message?.type === 'result') result = message;
    }
  } catch (error) {
    throw new ModelInvocationError(describeFailure({ subtype: error?.message }), { cause: error });
  }

  if (!result) throw new ModelInvocationError('모델이 result 메시지를 반환하지 않았습니다.');
  if (result.is_error || result.subtype !== 'success') {
    throw new ModelInvocationError(describeFailure(result), { subtype: result.subtype });
  }
  if (result.structured_output === undefined || result.structured_output === null) {
    throw new ModelInvocationError(
      'outputFormat을 json_schema로 걸었는데도 structured_output이 비어 있습니다. '
      + 'SDK 버전과 스키마를 확인하세요.',
      { subtype: result.subtype }
    );
  }

  return {
    value: result.structured_output,
    usage: {
      // 청구액이 아니다. SDK 타입 정의가 "An estimate, not a billing statement"라고
      // 못 박아 둔 값으로, 이번 호출이 쓴 토큰을 API 표준 요율로 환산한 추정치다.
      // 구독 인증으로 도는 한 실제로 빠지는 것은 달러가 아니라 구독 사용 한도다.
      // 토큰 소비량의 대리 지표로만 쓴다.
      estimatedCostUsd: result.total_cost_usd ?? null,
      turns: result.num_turns ?? null,
      models: result.modelUsage ?? null
    }
  };
}

/**
 * 스키마를 만족하는 facts를 얻을 때까지 최대 `attempts`번 부른다.
 *
 * SDK가 `outputFormat`으로 출력을 제약하지만 **로컬에서 다시 검증한다.**
 * 계약이 깨졌을 때 조용한 null이 파이프라인을 타고 흘러가는 것보다
 * 시끄럽게 실패하는 편이 낫다.
 */
export async function extractFacts({
  prompt,
  schema,
  model = DEFAULT_MODEL,
  attempts = 2,
  maxBudgetUsd,
  abortController,
  query,
  budget,
  onAttempt,
  onMessage
}) {
  let lastErrors = [];
  const usages = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // 실패한 호출도 한도를 태우므로 호출 전에 예약한다.
    budget?.consume();

    const input = attempt === 1
      ? prompt
      : `${prompt}\n\n[이전 응답 오류] 아래 문제를 모두 고쳐 다시 출력하세요.\n- ${lastErrors.join('\n- ')}`;

    const { value, usage } = await invokeOnce({
      prompt: input,
      schema,
      model,
      maxBudgetUsd,
      abortController,
      query,
      onMessage: onMessage ? (message) => onMessage({ attempt, message }) : undefined
    });
    usages.push(usage);
    onAttempt?.({ attempt, usage });

    lastErrors = validate(value, schema);
    if (lastErrors.length === 0) return { result: value, attempts: attempt, usages };
  }

  throw new SchemaViolationError(
    `모델 응답이 스키마를 ${attempts}회 연속 위반했습니다:\n- ${lastErrors.join('\n- ')}`,
    { errors: lastErrors, attempts }
  );
}

/**
 * 운영용 진입점. 인증을 확인하고 실제 SDK를 늦게 로드한다.
 *
 * 늦게 로드하는 이유: `core/`와 테스트는 SDK 없이 돌아야 하고, 인증 오류는
 * 무거운 의존성을 끌어오기 **전에** 나야 읽기 쉬운 메시지가 된다.
 */
export async function createExtractor({ env = process.env, queue } = {}) {
  const auth = assertSubscriptionAuth(env);
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  return {
    auth,
    extract(options) {
      const run = () => extractFacts({ ...options, query });
      return queue ? queue.run(run) : run();
    }
  };
}
