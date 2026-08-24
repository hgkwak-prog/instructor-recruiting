import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dueRuns, markFollowUpSent } from './store/database.mjs';

function toReminder(run) {
  return {
    event: 'recruitment.follow_up_due',
    runId: run.id,
    courseTitle: run.course_title,
    dueAt: run.follow_up_due_at,
    message: `[모집 현황 확인] ${run.course_title ?? '보조강사 공고'}의 모집 현황을 확인해 주세요.`
  };
}

/** Read-only. Shows who owns each due run so the two notifiers stay separated. */
export function previewDueReminders({ db, today }) {
  return {
    local: dueRuns(db, today, { sheetsRecorded: false }).map(toReminder),
    appsScript: dueRuns(db, today, { sheetsRecorded: true }).map(toReminder)
  };
}

/**
 * Local fallback only. Runs already recorded in Google Sheets are skipped --
 * the Apps Script time-based trigger emails those, and notifying them here too
 * would double-send and split the state across two stores.
 */
export function sendLocalReminders({ db, today, outboxDirectory }) {
  const runs = dueRuns(db, today, { sheetsRecorded: false });
  mkdirSync(outboxDirectory, { recursive: true });
  return runs.map((run) => {
    const reminder = toReminder(run);
    writeFileSync(join(outboxDirectory, `${run.id}.json`), `${JSON.stringify(reminder, null, 2)}\n`);
    markFollowUpSent(db, run.id, new Date().toISOString());
    return reminder;
  });
}
