export const DEFAULT_TIME_ZONE = 'Asia/Seoul';

const formatters = new Map();

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Calendar date in a given time zone for an instant. 'en-CA' yields YYYY-MM-DD.
 *
 * 이미 `YYYY-MM-DD`인 문자열은 그대로 돌려준다. 이 함수의 출력을
 * `businessDaysAfter`에 다시 넣는 호출 방식이 자연스럽게 생기는데,
 * `Intl.format`에 문자열을 주면 `RangeError: Invalid time value`로 죽는다.
 * 실제로 봇의 3영업일 계산이 이것 때문에 터져 있었다.
 */
export function localDateKey(date, timeZone = DEFAULT_TIME_ZONE) {
  if (typeof date === 'string' && DATE_KEY.test(date)) return date;
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }));
  }
  return formatters.get(timeZone).format(date);
}

/**
 * Business days after the *local* calendar date of `date`.
 * Using UTC here shifted the base date a day back for any KST morning before
 * 09:00, which sent follow-up reminders early.
 *
 * Weekends only -- Korean public holidays are not modelled.
 */
export function businessDaysAfter(date, days, timeZone = DEFAULT_TIME_ZONE) {
  const cursor = new Date(`${localDateKey(date, timeZone)}T00:00:00.000Z`);
  let added = 0;
  while (added < days) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return cursor.toISOString().slice(0, 10);
}

/**
 * 주말을 세는 판. `RECRUITMENT_DAY_MODE=calendar`일 때 쓴다.
 * 기준일을 로컬 달력 날짜로 잡는 것은 `businessDaysAfter`와 같은 이유다.
 */
export function calendarDaysAfter(date, days, timeZone = DEFAULT_TIME_ZONE) {
  const cursor = new Date(`${localDateKey(date, timeZone)}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}
