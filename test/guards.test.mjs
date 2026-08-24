import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuthConfigurationError,
  CallBudget,
  CallBudgetExceededError,
  OVERRIDING_CREDENTIALS,
  assertSubscriptionAuth,
  createSerialQueue
} from '../adapters/llm/guards.mjs';

function budgetPath(prefix = 'budget-') {
  return join(mkdtempSync(join(tmpdir(), prefix)), 'nested', 'call-budget.json');
}

// --- 인증 -------------------------------------------------------------------

test('ANTHROPIC_API_KEY가 있으면 부팅을 막는다', () => {
  // 이 키는 구독 토큰보다 우선순위가 높아서, 두면 조용히 종량 과금된다.
  // 조용한 게 문제라 시끄럽게 만든다.
  assert.throws(
    () => assertSubscriptionAuth({ ANTHROPIC_API_KEY: 'sk-ant-xxx', CLAUDE_CODE_OAUTH_TOKEN: 't' }),
    (error) => {
      assert.ok(error instanceof AuthConfigurationError);
      assert.deepEqual(error.variables, ['ANTHROPIC_API_KEY']);
      assert.match(error.message, /종량제로 과금/);
      return true;
    }
  );
});

test('ANTHROPIC_AUTH_TOKEN도 같은 이유로 막는다', () => {
  assert.throws(
    () => assertSubscriptionAuth({ ANTHROPIC_AUTH_TOKEN: 'bearer-x' }),
    AuthConfigurationError
  );
});

test('두 변수가 모두 있으면 둘 다 알려준다', () => {
  try {
    assertSubscriptionAuth({ ANTHROPIC_AUTH_TOKEN: 'a', ANTHROPIC_API_KEY: 'b' });
    assert.fail('던졌어야 합니다');
  } catch (error) {
    assert.deepEqual(error.variables, OVERRIDING_CREDENTIALS);
    assert.match(error.message, /unset ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY/);
  }
});

test('빈 문자열은 설정되지 않은 것으로 본다', () => {
  assert.deepEqual(assertSubscriptionAuth({ ANTHROPIC_API_KEY: '   ' }), {
    credential: 'login-session'
  });
});

test('구독 토큰이 있으면 oauth-token으로 보고한다', () => {
  assert.deepEqual(assertSubscriptionAuth({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x' }), {
    credential: 'oauth-token'
  });
});

// --- 일일 호출 상한 ----------------------------------------------------------

test('상한까지 쓰고 나면 멈춘다 — 과금으로 넘어가지 않는다', () => {
  const budget = new CallBudget({ path: budgetPath(), limit: 3 });
  for (let i = 0; i < 3; i += 1) budget.consume();
  assert.equal(budget.used(), 3);
  assert.equal(budget.remaining(), 0);
  assert.throws(() => budget.consume(), (error) => {
    assert.ok(error instanceof CallBudgetExceededError);
    assert.equal(error.limit, 3);
    return true;
  });
});

test('날짜가 바뀌면 카운터가 리셋된다', () => {
  const path = budgetPath('budget-day-');
  let clock = new Date('2026-08-24T05:00:00Z'); // KST 14:00
  const budget = new CallBudget({ path, limit: 2, now: () => clock });
  budget.consume();
  budget.consume();
  assert.throws(() => budget.consume(), CallBudgetExceededError);

  clock = new Date('2026-08-25T05:00:00Z');
  assert.equal(budget.used(), 0);
  assert.doesNotThrow(() => budget.consume());
});

test('날짜 경계는 Asia/Seoul 기준이다', () => {
  // UTC로 세면 한국 오전 9시에 리셋되어 "어제 다 썼는데 오늘 아침에도 못 쓴다"가 된다.
  const path = budgetPath('budget-tz-');
  const budget = new CallBudget({ path, limit: 1, now: () => new Date('2026-08-24T16:00:00Z') });
  assert.equal(budget.today(), '2026-08-25'); // KST 익일 01:00
});

test('손상된 카운터 파일 때문에 구인이 멈추지는 않는다', () => {
  const path = budgetPath('budget-corrupt-');
  const budget = new CallBudget({ path, limit: 2 });
  budget.consume();
  writeFileSync(path, '{ not json');
  assert.equal(budget.used(), 0);
  assert.doesNotThrow(() => budget.consume());
});

test('카운터는 날짜와 횟수만 담는다', () => {
  const path = budgetPath('budget-shape-');
  const budget = new CallBudget({ path, limit: 5 });
  budget.consume();
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, 'utf8'))).sort(), ['day', 'used']);
});

test('상한은 1 이상의 정수여야 한다', () => {
  assert.throws(() => new CallBudget({ path: budgetPath(), limit: 0 }), /1 이상/);
  assert.throws(() => new CallBudget({ path: budgetPath(), limit: 1.5 }), /1 이상/);
});

// --- 직렬화 ------------------------------------------------------------------

test('호출이 겹치지 않는다', async () => {
  const queue = createSerialQueue();
  let running = 0;
  let peak = 0;

  const task = async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
  };

  await Promise.all([queue.run(task), queue.run(task), queue.run(task)]);
  assert.equal(peak, 1, '동시에 두 건 이상이 돌면 프로세스도 구독 한도도 배로 빠진다');
  assert.equal(queue.pending, 0);
});

test('앞선 호출이 실패해도 뒤 호출은 돈다', async () => {
  const queue = createSerialQueue();
  const order = [];
  const failing = queue.run(async () => {
    order.push('fail');
    throw new Error('boom');
  });
  const following = queue.run(async () => {
    order.push('next');
    return 'ok';
  });

  await assert.rejects(failing, /boom/);
  assert.equal(await following, 'ok');
  assert.deepEqual(order, ['fail', 'next']);
});
