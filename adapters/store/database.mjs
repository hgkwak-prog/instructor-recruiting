import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Status flow. Nothing may leave the system before `approved`.
 *
 *   review_pending ──approve──> approved ──mark-complete──> completed ──> follow_up_due
 *         │
 *         └──reject──> rejected
 */
export const STATUS = {
  REVIEW_PENDING: 'review_pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  COMPLETED: 'completed',
  FOLLOW_UP_DUE: 'follow_up_due'
};

export const STATUS_LABELS = {
  review_pending: '검토대기',
  approved: '승인됨',
  rejected: '반려',
  completed: '게시완료',
  follow_up_due: '현황확인요청'
};

export const TABLE = 'recruitment_runs';

/**
 * Single source of truth for the table shape. CREATE TABLE and the migration
 * both read this list, so adding a column here is enough -- which is the whole
 * point: `CREATE TABLE IF NOT EXISTS` never touches an existing table, so an
 * older database silently kept the older shape and blew up on first insert
 * ("table recruitment_runs has no column named role").
 *
 * A column added after v0.2 must be nullable or carry a DEFAULT, because
 * ALTER TABLE ADD COLUMN cannot add a bare NOT NULL column to existing rows.
 */
const COLUMNS = [
  { name: 'id', type: 'TEXT PRIMARY KEY' },
  { name: 'source_path', type: 'TEXT NOT NULL' },
  { name: 'course_title', type: 'TEXT' },
  { name: 'role', type: 'TEXT' },
  { name: 'status', type: 'TEXT NOT NULL' },
  { name: 'result_json', type: 'TEXT' },
  { name: 'job_post', type: 'TEXT' },
  { name: 'postable', type: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'generated_at', type: 'TEXT NOT NULL' },
  { name: 'reviewed_at', type: 'TEXT' },
  { name: 'reviewed_by', type: 'TEXT' },
  { name: 'review_note', type: 'TEXT' },
  { name: 'completed_at', type: 'TEXT' },
  { name: 'follow_up_due_at', type: 'TEXT' },
  { name: 'sheets_recorded_at', type: 'TEXT' },
  { name: 'follow_up_sent_at', type: 'TEXT' },
  { name: 'slack_applicants', type: 'INTEGER' },
  { name: 'careerday_posted_at', type: 'TEXT' },
  { name: 'careerday_applicants', type: 'INTEGER' },
  { name: 'final_channel', type: 'TEXT' }
];

/** v0.2 called the pre-posting state `generated`; it is now `review_pending`. */
const LEGACY_STATUS = { generated: STATUS.REVIEW_PENDING };

function canAddLater(type) {
  if (/PRIMARY KEY/.test(type)) return false;
  return !/NOT NULL/.test(type) || /DEFAULT/.test(type);
}

/**
 * Brings an existing database up to the current shape.
 * Returns what it changed so the CLI can say so out loud -- a silent schema
 * change is how this bug survived three versions.
 */
export function migrate(db) {
  const existing = new Set(
    db.prepare(`PRAGMA table_info(${TABLE})`).all().map((row) => row.name)
  );
  const addedColumns = [];
  for (const column of COLUMNS) {
    if (existing.has(column.name)) continue;
    if (!canAddLater(column.type)) {
      throw new Error(
        `${TABLE}.${column.name} 컬럼은 자동 추가할 수 없습니다. data/recruitment.sqlite를 옮기고 새로 만드세요.`
      );
    }
    db.exec(`ALTER TABLE ${TABLE} ADD COLUMN ${column.name} ${column.type}`);
    addedColumns.push(column.name);
  }

  let movedStatuses = 0;
  for (const [from, to] of Object.entries(LEGACY_STATUS)) {
    movedStatuses += db.prepare(`UPDATE ${TABLE} SET status = ? WHERE status = ?`).run(to, from).changes;
  }

  // 옛 행은 옛 계약으로 만들어졌다. postable=0 이므로 승인되지 않고, 다시 생성해야 한다.
  return { addedColumns, movedStatuses };
}

export function openDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const definition = COLUMNS.map((column) => `${column.name} ${column.type}`).join(',\n      ');
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (\n      ${definition}\n    ) STRICT;`);
  db.migrationReport = migrate(db);
  return db;
}

export function createRun(db, run) {
  db.prepare(`INSERT INTO recruitment_runs
    (id, source_path, course_title, role, status, result_json, job_post, postable, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      run.id, run.sourcePath, run.courseTitle ?? null, run.role ?? null,
      STATUS.REVIEW_PENDING, JSON.stringify(run.result), run.jobPost,
      run.postable ? 1 : 0, run.generatedAt
    );
}

export function getRun(db, id) {
  return db.prepare('SELECT * FROM recruitment_runs WHERE id = ?').get(id);
}

export function listRuns(db, status = null) {
  return status
    ? db.prepare('SELECT * FROM recruitment_runs WHERE status = ? ORDER BY generated_at DESC').all(status)
    : db.prepare('SELECT * FROM recruitment_runs ORDER BY generated_at DESC').all();
}

/**
 * The single approval gate. Only a run in review_pending can be approved, and a
 * run whose draft still has unfilled [확인 필요] markers cannot be approved at
 * all -- posting it would publish a placeholder.
 */
export function reviewRun(db, { id, decision, reviewer, note, reviewedAt }) {
  const run = getRun(db, id);
  if (!run) throw new Error(`작업을 찾을 수 없습니다: ${id}`);
  if (run.status !== STATUS.REVIEW_PENDING) {
    throw new Error(`검토대기 상태가 아닙니다 (현재: ${STATUS_LABELS[run.status] ?? run.status})`);
  }
  if (decision === STATUS.APPROVED && !run.postable) {
    throw new Error('초안에 [확인 필요] 항목이 남아 있어 승인할 수 없습니다. 조건을 채워 다시 생성하세요.');
  }
  const { changes } = db.prepare(`UPDATE recruitment_runs
    SET status = ?, reviewed_at = ?, reviewed_by = ?, review_note = ?
    WHERE id = ? AND status = ?`)
    .run(decision, reviewedAt, reviewer, note ?? null, id, STATUS.REVIEW_PENDING);
  if (changes === 0) throw new Error(`검토 처리에 실패했습니다: ${id}`);
  return getRun(db, id);
}

export function completeRun(db, { id, completedAt, followUpDueAt, sheetsRecordedAt }) {
  const { changes } = db.prepare(`UPDATE recruitment_runs
    SET status = ?, completed_at = ?, follow_up_due_at = ?, sheets_recorded_at = ?
    WHERE id = ? AND status = ?`)
    .run(STATUS.COMPLETED, completedAt, followUpDueAt, sheetsRecordedAt, id, STATUS.APPROVED);
  if (changes === 0) {
    throw new Error(`게시 완료 처리에 실패했습니다. 승인된 건만 처리할 수 있습니다: ${id}`);
  }
  return getRun(db, id);
}

export function recordOutcome(db, { id, slackApplicants, careerdayApplicants, finalChannel, careerdayPostedAt }) {
  const run = getRun(db, id);
  if (!run) throw new Error(`작업을 찾을 수 없습니다: ${id}`);
  db.prepare(`UPDATE recruitment_runs SET
      slack_applicants     = COALESCE(?, slack_applicants),
      careerday_applicants = COALESCE(?, careerday_applicants),
      careerday_posted_at  = COALESCE(?, careerday_posted_at),
      final_channel        = COALESCE(?, final_channel)
    WHERE id = ?`)
    .run(slackApplicants ?? null, careerdayApplicants ?? null, careerdayPostedAt ?? null, finalChannel ?? null, id);
  return getRun(db, id);
}

/**
 * `sheetsRecorded` splits ownership of the follow-up notification: rows that
 * reached Google Sheets are notified by the Apps Script trigger, rows that never
 * did are the CLI's. Nothing is owned by both, so double notification is
 * impossible.
 */
export function dueRuns(db, today, { sheetsRecorded = null } = {}) {
  const filter = sheetsRecorded === null
    ? ''
    : sheetsRecorded
      ? 'AND sheets_recorded_at IS NOT NULL'
      : 'AND sheets_recorded_at IS NULL';
  return db.prepare(`SELECT * FROM recruitment_runs
    WHERE status = ? AND follow_up_due_at <= ? AND follow_up_sent_at IS NULL ${filter}
    ORDER BY follow_up_due_at ASC`).all(STATUS.COMPLETED, today);
}

export function markFollowUpSent(db, id, sentAt) {
  db.prepare('UPDATE recruitment_runs SET status = ?, follow_up_sent_at = ? WHERE id = ?')
    .run(STATUS.FOLLOW_UP_DUE, sentAt, id);
}
