/**
 * 인증·사용량 가드.
 *
 * 이 레포는 **정액제 구독**으로 모델을 부른다. 종량제 API 키가 아니다.
 * 그런데 Claude Code의 인증 우선순위는
 *   ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY > apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN > /login
 * 이라서, 환경에 API 키가 남아 있으면 **구독 토큰이 조용히 무시되고 종량 과금된다.**
 * 조용한 게 문제다. 청구서를 보기 전까지 아무도 모른다. 그래서 부팅 때 막는다.
 *
 * 사용량도 같은 성질이다. SDK 사용량은 별도 크레딧이 아니라 **구독 한도에서 차감**되고
 * (2026-06-15 예고된 Agent SDK 월 크레딧은 보류·미제공), 그 한도는 담당자가 대화형
 * Claude를 쓰는 것과 같은 풀이다. 봇이 재시도 루프로 폭주하면 사람이 Claude를 못 쓴다.
 * 게다가 Team 플랜은 usage credits가 켜져 있으면 한도 초과분이 API 요율로 과금된다.
 * 그러니 기본 동작은 "넘으면 과금으로 넘어가기"가 아니라 **"멈추고 알리기"** 여야 한다.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

export class CallBudgetExceededError extends Error {
  constructor(message, { limit, used, day }) {
    super(message);
    this.name = 'CallBudgetExceededError';
    this.limit = limit;
    this.used = used;
    this.day = day;
  }
}

/**
 * 하루 단위 모델 호출 상한. 파일 하나에 `{ day, used }`만 담는다.
 *
 * 날짜 경계는 Asia/Seoul 기준이다. UTC로 세면 한국 오전 9시에 카운터가 리셋되어
 * "어제 다 썼는데 오늘 아침에도 못 쓴다"가 된다.
 */
export class CallBudget {
  #path;
  #limit;
  #now;

  constructor({ path, limit = 30, now = () => new Date() }) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`일일 호출 상한은 1 이상의 정수여야 합니다: ${limit}`);
    }
    this.#path = path;
    this.#limit = limit;
    this.#now = now;
  }

  get limit() {
    return this.#limit;
  }

  /** Asia/Seoul 기준 YYYY-MM-DD. */
  today() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(this.#now());
  }

  #read() {
    let raw;
    try {
      raw = readFileSync(this.#path, 'utf8');
    } catch {
      return { day: this.today(), used: 0 };
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.day !== this.today()) return { day: this.today(), used: 0 };
      return { day: parsed.day, used: Number.isInteger(parsed.used) ? parsed.used : 0 };
    } catch {
      // 손상된 카운터 때문에 구인이 멈추면 안 된다. 오늘치를 0으로 보고 계속 간다.
      return { day: this.today(), used: 0 };
    }
  }

  #write(state) {
    mkdirSync(dirname(this.#path), { recursive: true });
    writeFileSync(this.#path, JSON.stringify(state));
  }

  /** 지금까지 오늘 쓴 횟수. */
  used() {
    return this.#read().used;
  }

  remaining() {
    return Math.max(0, this.#limit - this.used());
  }

  /**
   * 호출 한 건을 예약한다. 상한을 넘으면 던진다 — 과금으로 넘어가지 않는다.
   * 실제 호출 **전에** 부른다. 실패한 호출도 한도를 태우기 때문이다.
   */
  consume() {
    const state = this.#read();
    if (state.used >= this.#limit) {
      throw new CallBudgetExceededError(
        `오늘 모델 호출 상한 ${this.#limit}건을 모두 썼습니다 (${state.day}). `
        + '구독 한도를 더 태우지 않기 위해 여기서 멈춥니다. '
        + '상한은 RECRUIT_DAILY_CALL_LIMIT으로 조정합니다.',
        { limit: this.#limit, used: state.used, day: state.day }
      );
    }
    const next = { day: state.day, used: state.used + 1 };
    this.#write(next);
    return next;
  }
}

/**
 * 호출을 한 줄로 세운다.
 *
 * Agent SDK는 호출마다 CLI 프로세스를 스폰한다(≈12초). 동시에 여러 건이 들어오면
 * 프로세스가 배로 뜨고 구독 한도도 배로 빠진다. 월 15건 규모에서 동시 실행으로 얻을
 * 이득이 없으므로 그냥 직렬화한다.
 */
export function createSerialQueue() {
  let tail = Promise.resolve();
  let depth = 0;

  return {
    get pending() {
      return depth;
    },
    run(task) {
      depth += 1;
      const result = tail.then(task, task);
      // 앞선 작업의 실패가 뒤 작업을 막지 않게 꼬리는 항상 성공으로 만든다.
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result.finally(() => {
        depth -= 1;
      });
    }
  };
}
