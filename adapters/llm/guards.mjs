/**
 * 인증 가드.
 *
 * 이 레포는 **정액제 구독**으로 모델을 부른다. 종량제 API 키가 아니다.
 * 그런데 Claude Code의 인증 우선순위는
 *   ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY > apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN > /login
 * 이라서, 환경에 API 키가 남아 있으면 **구독 토큰이 조용히 무시되고 종량 과금된다.**
 * 조용한 게 문제다. 청구서를 보기 전까지 아무도 모른다. 그래서 부팅 때 막는다.
 */

/** 구독 토큰보다 우선순위가 높아 구독 인증을 무력화하는 환경변수들. */
export const OVERRIDING_CREDENTIALS = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'];

export class AuthConfigurationError extends Error {
  constructor(message, { variables }) {
    super(message);
    this.name = 'AuthConfigurationError';
    this.variables = variables;
  }
}

/**
 * 구독 인증이 실제로 쓰일 상태인지 확인한다.
 * @returns {{ credential: 'oauth-token' | 'login-session' }}
 * @throws {AuthConfigurationError} 종량제 자격증명이 환경에 있으면
 */
export function assertSubscriptionAuth(env = process.env) {
  const present = OVERRIDING_CREDENTIALS.filter((name) => env[name]?.trim());
  if (present.length > 0) {
    throw new AuthConfigurationError(
      `${present.join(', ')} 가 설정돼 있습니다. 이 값은 구독 토큰보다 우선순위가 높아 `
      + '구독 인증이 무시되고 종량제로 과금됩니다.\n'
      + `이 레포는 정액제 구독으로 동작합니다. \`unset ${present.join(' ')}\` 후 다시 실행하세요.`,
      { variables: present }
    );
  }
  return {
    credential: env.CLAUDE_CODE_OAUTH_TOKEN?.trim() ? 'oauth-token' : 'login-session'
  };
}

