/**
 * 환경변수 읽기.
 *
 * `process.env.X ?? 기본값`은 틀린다. `??`는 `null`과 `undefined`만 거르는데,
 * `.env` 파일에서 온 값은 **비어 있어도 빈 문자열**이기 때문이다.
 * `RECRUIT_DATA_DIR=` 한 줄이면 `''`가 들어오고, 그대로 `mkdir('')`까지 가서
 * `ENOENT: no such file or directory, mkdir ''`로 죽는다.
 *
 * 게다가 우리가 `cp .env.example .env` 하라고 안내하는데, 그 템플릿이 항목을
 * 일부러 빈 값으로 둔다. **안내대로 하면 깨지는 설정이 만들어진다.**
 * 그래서 "비어 있음 = 설정 안 함"을 한 군데서 정한다.
 */

/** 공백만 있는 값도 설정되지 않은 것으로 본다. */
export function envOr(env, name, fallback = null) {
  const raw = env?.[name];
  if (typeof raw !== 'string') return raw ?? fallback;
  const trimmed = raw.trim();
  return trimmed === '' ? fallback : trimmed;
}

/**
 * 숫자 환경변수. 숫자가 아니면 기본값으로 조용히 넘어가지 않고 던진다 —
 * `RECRUIT_DAILY_CALL_LIMIT=삼십`이 기본값 30으로 둔갑하면 아무도 모른다.
 */
export function envNumber(env, name, fallback) {
  const raw = envOr(env, name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name}은 숫자여야 합니다: ${raw}`);
  }
  return value;
}
