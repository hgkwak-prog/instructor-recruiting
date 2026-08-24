import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openDatabase, createRun, getRun, reviewRun, completeRun, recordOutcome, listRuns, STATUS
} from '../adapters/store/database.mjs';
import { baseResult } from './fixtures.mjs';

function seed({ postable = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'recruiting-approval-'));
  const db = openDatabase(join(directory, 'r.sqlite'));
  createRun(db, {
    id: 'run-1',
    sourcePath: '/tmp/c.txt',
    courseTitle: 'AI 코딩 기초 교육',
    role: '보조강사',
    result: baseResult(),
    jobPost: '초안',
    postable,
    generatedAt: '2026-08-18T00:00:00.000Z'
  });
  return { db, directory };
}

const approve = (db, extra = {}) => reviewRun(db, {
  id: 'run-1', decision: STATUS.APPROVED, reviewer: 'kyogoku',
  reviewedAt: '2026-08-18T01:00:00.000Z', ...extra
});

test('a new run starts in review_pending, not ready to post', () => {
  const { db } = seed();
  assert.equal(getRun(db, 'run-1').status, STATUS.REVIEW_PENDING);
});

test('approval records who and when', () => {
  const { db } = seed();
  const saved = approve(db, { note: '확인함' });
  assert.equal(saved.status, STATUS.APPROVED);
  assert.equal(saved.reviewed_by, 'kyogoku');
  assert.equal(saved.reviewed_at, '2026-08-18T01:00:00.000Z');
  assert.equal(saved.review_note, '확인함');
});

test('a draft with unfilled markers cannot be approved', () => {
  const { db } = seed({ postable: false });
  assert.throws(() => approve(db), /\[확인 필요\] 항목이 남아/);
  assert.equal(getRun(db, 'run-1').status, STATUS.REVIEW_PENDING);
});

test('an unapproved run cannot be marked complete', () => {
  const { db } = seed();
  assert.throws(
    () => completeRun(db, {
      id: 'run-1',
      completedAt: '2026-08-18T02:00:00.000Z',
      followUpDueAt: '2026-08-21',
      sheetsRecordedAt: null
    }),
    /승인된 건만/
  );
});

test('approve then complete is the only path forward', () => {
  const { db } = seed();
  approve(db);
  const saved = completeRun(db, {
    id: 'run-1',
    completedAt: '2026-08-18T02:00:00.000Z',
    followUpDueAt: '2026-08-21',
    sheetsRecordedAt: null
  });
  assert.equal(saved.status, STATUS.COMPLETED);
  assert.equal(saved.follow_up_due_at, '2026-08-21');
});

test('a rejected run is終 and cannot be approved afterwards', () => {
  const { db } = seed();
  reviewRun(db, {
    id: 'run-1', decision: STATUS.REJECTED, reviewer: 'kyogoku',
    note: '일정 오류', reviewedAt: '2026-08-18T01:00:00.000Z'
  });
  assert.equal(getRun(db, 'run-1').status, STATUS.REJECTED);
  assert.throws(() => approve(db), /검토대기 상태가 아닙니다/);
});

test('double approval fails', () => {
  const { db } = seed();
  approve(db);
  assert.throws(() => approve(db), /검토대기 상태가 아닙니다/);
});

test('outcome columns accumulate without clobbering each other', () => {
  const { db } = seed();
  recordOutcome(db, { id: 'run-1', slackApplicants: 2 });
  recordOutcome(db, { id: 'run-1', careerdayApplicants: 5, finalChannel: 'careerday' });
  const run = getRun(db, 'run-1');
  assert.equal(run.slack_applicants, 2, '이전 입력이 덮어써지면 안 됩니다');
  assert.equal(run.careerday_applicants, 5);
  assert.equal(run.final_channel, 'careerday');
});

test('list filters by status', () => {
  const { db } = seed();
  assert.equal(listRuns(db, STATUS.REVIEW_PENDING).length, 1);
  assert.equal(listRuns(db, STATUS.APPROVED).length, 0);
  approve(db);
  assert.equal(listRuns(db, STATUS.APPROVED).length, 1);
});
