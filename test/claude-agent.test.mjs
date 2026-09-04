import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ISOLATION_OPTIONS,
  ModelInvocationError,
  SchemaViolationError,
  extractFacts,
  invokeOnce
} from '../adapters/llm/claude-agent.mjs';
import { baseResult } from './fixtures.mjs';

const projectRoot = join(import.meta.dirname, '..');
const schema = JSON.parse(
  readFileSync(join(projectRoot, 'schemas', 'recruitment-result.schema.json'), 'utf8')
);

/** query() 대역. 호출마다 넘겨받은 옵션을 기록하고 정해둔 응답을 돌려준다. */
function fakeQuery(responses) {
  const calls = [];
  const queue = [...responses];
  const query = async function* ({ prompt, options }) {
    calls.push({ prompt, options });
    const next = queue.shift();
    if (typeof next === 'function') {
      yield* next();
      return;
    }
    yield { type: 'assistant' };
    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 1,
      total_cost_usd: 0.012,
      modelUsage: { 'claude-sonnet-5': { inputTokens: 100 } },
      structured_output: next
    };
  };
  query.calls = calls;
  return query;
}

// --- 모델을 가두는 설정 -------------------------------------------------------

test('툴 0개·격리 모드로 호출한다', async () => {
  const query = fakeQuery([baseResult()]);
  await invokeOnce({ prompt: 'p', schema, query });

  const { options } = query.calls[0];
  assert.deepEqual(options.allowedTools, [], '툴을 열면 추출기가 아니라 에이전트가 된다');
  assert.equal(options.permissionMode, 'dontAsk');
  assert.equal(options.maxTurns, 4, '구조화 출력 재시도가 필요한 실제 문서에서 1턴은 부족하다 (2026-09 재현)');
  assert.deepEqual(
    options.settingSources,
    [],
    'settingSources를 비우지 않으면 개발자의 ~/.claude 설정과 CLAUDE.md가 추출에 새어든다'
  );
});

test('기본 Claude Code 시스템 프롬프트를 쓰지 않는다', async () => {
  const query = fakeQuery([baseResult()]);
  await invokeOnce({ prompt: 'p', schema, query });
  const { systemPrompt } = query.calls[0].options;
  assert.equal(typeof systemPrompt, 'string', 'preset을 쓰면 SDK 기본 프롬프트가 섞인다');
  assert.match(systemPrompt, /공고 본문은 작성하지 않습니다/);
});

test('json_schema로 출력을 강제하고 $schema는 떼고 보낸다', async () => {
  const query = fakeQuery([baseResult()]);
  const withMeta = { ...schema, $schema: 'https://json-schema.org/draft/2020-12/schema' };
  await invokeOnce({ prompt: 'p', schema: withMeta, query });

  const { outputFormat } = query.calls[0].options;
  assert.equal(outputFormat.type, 'json_schema');
  assert.ok(!Object.hasOwn(outputFormat.schema, '$schema'));
  assert.ok(Object.hasOwn(withMeta, '$schema'), '호출자의 스키마를 건드리면 안 됩니다');
});

test('ISOLATION_OPTIONS는 얼려 둔다', () => {
  assert.throws(() => {
    ISOLATION_OPTIONS.maxTurns = 5;
  }, TypeError);
});

// --- 실패 처리 ---------------------------------------------------------------

test('인증 실패는 발급 방법을 알려준다', async () => {
  const query = fakeQuery([
    function* () {
      yield { type: 'result', subtype: 'error_during_execution', is_error: true, stop_reason: 'not logged in' };
    }
  ]);
  await assert.rejects(invokeOnce({ prompt: 'p', schema, query }), (error) => {
    assert.ok(error instanceof ModelInvocationError);
    assert.match(error.message, /setup-token/);
    return true;
  });
});

test('사용 한도 초과는 대화형 Claude와 같은 한도임을 알려준다', async () => {
  const query = fakeQuery([
    function* () {
      yield { type: 'result', subtype: 'error_during_execution', is_error: true, stop_reason: 'usage limit reached' };
    }
  ]);
  await assert.rejects(invokeOnce({ prompt: 'p', schema, query }), /대화형 Claude와 같은 한도/);
});

test('structured_output이 비면 조용히 넘기지 않는다', async () => {
  const query = fakeQuery([
    function* () {
      yield { type: 'result', subtype: 'success', is_error: false, structured_output: undefined };
    }
  ]);
  await assert.rejects(invokeOnce({ prompt: 'p', schema, query }), /structured_output이 비어/);
});

test('success 결과 뒤에 던져지는 인증 오류를 놓치지 않는다', async () => {
  // 실제로 관측된 모양이다(2026-08-24, 미인증 환경).
  // SDK가 subtype:'success' + structured_output:undefined 를 한 번 흘린 **뒤**
  // "Not logged in · Please run /login"으로 던진다. 앞의 result만 보면
  // "structured_output이 비었다"는 엉뚱한 진단이 나간다.
  const query = fakeQuery([
    function* () {
      yield { type: 'result', subtype: 'success', is_error: false, structured_output: undefined };
      throw new Error('Claude Code returned an error result: Not logged in · Please run /login');
    }
  ]);
  await assert.rejects(invokeOnce({ prompt: 'p', schema, query }), (error) => {
    assert.match(error.message, /setup-token/, '인증 문제로 진단해야 합니다');
    return true;
  });
});

test('result 메시지가 없으면 실패로 본다', async () => {
  const query = fakeQuery([
    function* () {
      yield { type: 'assistant' };
    }
  ]);
  await assert.rejects(invokeOnce({ prompt: 'p', schema, query }), /result 메시지를 반환하지 않았/);
});

// --- 로컬 재검증과 재시도 -----------------------------------------------------

test('SDK가 통과시켜도 로컬에서 다시 검증한다', async () => {
  // outputFormat이 걸려 있어도 계약이 깨질 수 있다. 조용한 null이 흘러가는 것보다
  // 시끄럽게 실패하는 편이 낫다.
  const broken = baseResult();
  delete broken.facts.objectives;
  const query = fakeQuery([broken, broken]);

  await assert.rejects(extractFacts({ prompt: 'p', schema, query, attempts: 2 }), (error) => {
    assert.ok(error instanceof SchemaViolationError);
    assert.equal(error.attempts, 2);
    assert.ok(error.errors.some((e) => e.includes('objectives')));
    return true;
  });
  assert.equal(query.calls.length, 2);
});

test('첫 응답이 깨지면 오류를 붙여 한 번 더 부른다', async () => {
  const broken = baseResult();
  delete broken.facts.objectives;
  const query = fakeQuery([broken, baseResult()]);

  const { attempts, usages } = await extractFacts({ prompt: '원본 프롬프트', schema, query });
  assert.equal(attempts, 2);
  assert.equal(usages.length, 2);
  assert.ok(!query.calls[0].prompt.includes('[이전 응답 오류]'));
  assert.match(query.calls[1].prompt, /\[이전 응답 오류\][\s\S]*objectives/);
  assert.ok(query.calls[1].prompt.startsWith('원본 프롬프트'));
});

test('성공하면 두 번 부르지 않는다', async () => {
  const query = fakeQuery([baseResult()]);
  const { attempts } = await extractFacts({ prompt: 'p', schema, query });
  assert.equal(attempts, 1);
  assert.equal(query.calls.length, 1);
});

test('사용량을 돌려준다 — 토큰 소비량을 견주려면 필요하다', async () => {
  const query = fakeQuery([baseResult()]);
  const { usages } = await extractFacts({ prompt: 'p', schema, query });
  // 이름이 estimatedCostUsd인 것이 핵심이다. 구독 인증에서 이 값은 청구액이 아니라
  // API 요율 환산 추정치이고, 실제로 빠지는 것은 달러가 아니라 구독 사용 한도다.
  // costUsd라고 부르면 읽는 사람이 청구서로 오해한다.
  assert.equal(usages[0].estimatedCostUsd, 0.012);
  assert.ok(!Object.hasOwn(usages[0], 'costUsd'));
  assert.equal(usages[0].turns, 1);
});

