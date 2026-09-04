import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthConfigurationError,
  OVERRIDING_CREDENTIALS,
  assertSubscriptionAuth
} from '../adapters/llm/guards.mjs';

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
