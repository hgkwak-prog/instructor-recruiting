import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, createRun, getRun, reviewRun, STATUS } from '../adapters/store/database.mjs';
import { baseResult } from './fixtures.mjs';

/** The exact table v0.2 shipped, before role/job_post/postable/review columns existed. */
const V02_SCHEMA = `
  CREATE TABLE recruitment_runs (
    id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    course_title TEXT,
    status TEXT NOT NULL,
    result_json TEXT,
    generated_at TEXT NOT NULL,
    completed_at TEXT,
    follow_up_due_at TEXT,
    sheets_recorded_at TEXT,
    follow_up_sent_at TEXT
  ) STRICT;
`;

function legacyDatabase({ withRow = true } = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'legacy-')), 'r.sqlite');
  const db = new DatabaseSync(path);
  db.exec(V02_SCHEMA);
  if (withRow) {
    db.prepare(`INSERT INTO recruitment_runs
      (id, source_path, course_title, status, result_json, generated_at)
      VALUES ('old-1', '/tmp/c.txt', 'AI 코딩 기초 교육', 'generated', '{}', '2026-08-18T00:00:00.000Z')`).run();
  }
  db.close();
  return path;
}

test('an old database gains the missing columns instead of failing on insert', () => {
  // 실제 증상: 오류: table recruitment_runs has no column named role
  const path = legacyDatabase();
  const db = openDatabase(path);

  assert.deepEqual(db.migrationReport.addedColumns, [
    'role', 'job_post', 'postable', 'reviewed_at', 'reviewed_by', 'review_note',
    'slack_applicants', 'careerday_posted_at', 'careerday_applicants', 'final_channel',
    // P3에서 Slack 인테이크·게시가 붙으며 늘어난 것들
    'created_by_user_id', 'slack_channel_id', 'slack_message_ts', 'slack_permalink',
    // 본문 자유 편집을 열면서: 코드가 조립한 원본과 확정된 강사료
    'job_post_generated', 'compensation_json', 'acknowledged_warnings',
    'publishing_input_json'
  ]);

  createRun(db, {
    id: 'new-1',
    sourcePath: '/tmp/c.txt',
    courseTitle: 'AI 코딩 기초 교육',
    role: '보조강사',
    result: baseResult(),
    jobPost: '초안',
    postable: true,
    generatedAt: '2026-08-18T01:00:00.000Z'
  });
  assert.equal(getRun(db, 'new-1').role, '보조강사');
});

test('the v0.2 "generated" status becomes review_pending', () => {
  const db = openDatabase(legacyDatabase());
  assert.equal(db.migrationReport.movedStatuses, 1);
  assert.equal(getRun(db, 'old-1').status, STATUS.REVIEW_PENDING);
});

test('a migrated row starts with postable=0, but the gate is gone -- it can still be approved', () => {
  // 검산기(core/verify.mjs)가 없어지면서 "게시 가능" 판정 자체가 사라졌다.
  // postable 컬럼은 옛 데이터 호환을 위해 남아 있을 뿐, 승인을 막지 않는다.
  const db = openDatabase(legacyDatabase());
  assert.equal(getRun(db, 'old-1').postable, 0, 'postable은 안전한 기본값 0이어야 합니다');
  const reviewed = reviewRun(db, {
    id: 'old-1', decision: STATUS.APPROVED, reviewer: 'kyogoku',
    reviewedAt: '2026-08-18T02:00:00.000Z'
  });
  assert.equal(reviewed.status, STATUS.APPROVED);
});

test('migration is idempotent', () => {
  const path = legacyDatabase();
  const first = openDatabase(path);
  assert.equal(first.migrationReport.addedColumns.length, 18);
  first.close();

  const second = openDatabase(path);
  assert.deepEqual(second.migrationReport.addedColumns, []);
  assert.equal(second.migrationReport.movedStatuses, 0);
});

test('a fresh database needs no migration', () => {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'fresh-')), 'r.sqlite'));
  assert.deepEqual(db.migrationReport, { addedColumns: [], movedStatuses: 0 });
});

test('every column the code writes exists in the table', () => {
  // 이 테스트가 있으면 컬럼을 추가하고 COLUMNS에 안 넣는 실수가 잡힌다.
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'shape-')), 'r.sqlite'));
  const columns = new Set(db.prepare('PRAGMA table_info(recruitment_runs)').all().map((r) => r.name));
  for (const name of [
    'id', 'source_path', 'course_title', 'role', 'status', 'result_json', 'job_post',
    'postable', 'generated_at', 'reviewed_at', 'reviewed_by', 'review_note',
    'completed_at', 'follow_up_due_at', 'sheets_recorded_at', 'follow_up_sent_at',
    'slack_applicants', 'careerday_posted_at', 'careerday_applicants', 'final_channel'
  ]) {
    assert.ok(columns.has(name), `${name} 컬럼이 없습니다`);
  }
});

