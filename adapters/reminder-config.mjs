/**
 * 현황 확인 알림 설정.
 *
 * 기본값은 **평일 3영업일**이다. 이 숫자가 이 프로젝트의 판단 기준이다 —
 * 슬랙 공고로 3영업일 안에 지원자가 붙는지가 "전화를 끊어도 되는가"를 가른다.
 */
export function readReminderConfig(environment = process.env) {
  const waitDays = Number(environment.RECRUITMENT_WAIT_DAYS || 3);
  const dayMode = environment.RECRUITMENT_DAY_MODE || 'business';
  const pollMs = Number(environment.RECRUITMENT_REMINDER_POLL_MS || 5 * 60 * 1000);
  const timeZone = environment.RECRUITMENT_TIME_ZONE || 'Asia/Seoul';

  if (!Number.isInteger(waitDays) || waitDays < 1) {
    throw new Error('RECRUITMENT_WAIT_DAYS는 1 이상의 정수여야 합니다.');
  }
  if (!['business', 'calendar'].includes(dayMode)) {
    throw new Error('RECRUITMENT_DAY_MODE는 business 또는 calendar여야 합니다.');
  }
  // 1분보다 자주 돌 이유가 없다. 월 15건짜리 일이다.
  if (!Number.isFinite(pollMs) || pollMs < 60_000) {
    throw new Error('RECRUITMENT_REMINDER_POLL_MS는 60000 이상의 숫자여야 합니다.');
  }

  return { waitDays, dayMode, pollMs, timeZone };
}
