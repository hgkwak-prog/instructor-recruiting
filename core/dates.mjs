export const DEFAULT_TIME_ZONE = 'Asia/Seoul';

const formatters = new Map();

/** Calendar date in a given time zone for an instant. 'en-CA' yields YYYY-MM-DD. */
export function localDateKey(date, timeZone = DEFAULT_TIME_ZONE) {
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
