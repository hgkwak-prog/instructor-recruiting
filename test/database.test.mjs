import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, createRun, reviewRun, completeRun, STATUS } from '../adapters/store/database.mjs';
import { previewDueReminders, sendLocalReminders } from '../adapters/reminders.mjs';
import { baseResult } from './fixtures.mjs';

function seed({ sheetsRecordedAt }) {
  const directory = mkdtempSync(join(tmpdir(), 'recruiting-test-'));
  const db = openDatabase(join(directory, 'r.sqlite'));
  createRun(db, {
    id: 'run-1',
    sourcePath: '/tmp/c.txt',
    courseTitle: 'AI 코딩 기초 교육',
    role: '보조강사',
    result: baseResult(),
    jobPost: '초안',
    postable: true,
    generatedAt: '2026-08-14T00:00:00.000Z'
  });
  reviewRun(db, {
    id: 'run-1', decision: STATUS.APPROVED, reviewer: 'kyogoku',
    reviewedAt: '2026-08-14T00:00:00.000Z'
  });
  completeRun(db, {
    id: 'run-1',
    completedAt: '2026-08-14T00:00:00.000Z',
    followUpDueAt: '2026-08-19',
    sheetsRecordedAt
  });
  return { db, directory };
}

test('sends exactly one local reminder for a run that never reached Sheets', () => {
  const { db, directory } = seed({ sheetsRecordedAt: null });
  const outbox = join(directory, 'outbox');
  const reminders = sendLocalReminders({ db, today: '2026-08-19', outboxDirectory: outbox });
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].courseTitle, 'AI 코딩 기초 교육');
  assert.ok(existsSync(join(outbox, 'run-1.json')));
  assert.equal(JSON.parse(readFileSync(join(outbox, 'run-1.json'), 'utf8')).runId, 'run-1');
  assert.equal(sendLocalReminders({ db, today: '2026-08-19', outboxDirectory: outbox }).length, 0);
});

test('never sends locally for a run the Apps Script trigger owns', () => {
  const { db, directory } = seed({ sheetsRecordedAt: '2026-08-14T00:00:00.000Z' });
  const preview = previewDueReminders({ db, today: '2026-08-19' });
  assert.equal(preview.appsScript.length, 1);
  assert.equal(preview.local.length, 0);
  assert.equal(sendLocalReminders({ db, today: '2026-08-19', outboxDirectory: join(directory, 'outbox') }).length, 0);
});

test('preview does not mutate state', () => {
  const { db } = seed({ sheetsRecordedAt: null });
  assert.equal(previewDueReminders({ db, today: '2026-08-19' }).local.length, 1);
  assert.equal(previewDueReminders({ db, today: '2026-08-19' }).local.length, 1);
});

test('a run still awaiting review never appears as due', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recruiting-test-'));
  const db = openDatabase(join(directory, 'r.sqlite'));
  createRun(db, {
    id: 'run-2',
    sourcePath: '/tmp/c.txt',
    courseTitle: '미검토 과정',
    role: '보조강사',
    result: baseResult(),
    jobPost: '초안',
    postable: true,
    generatedAt: '2026-08-14T00:00:00.000Z'
  });
  const preview = previewDueReminders({ db, today: '2026-12-31' });
  assert.equal(preview.local.length, 0);
  assert.equal(preview.appsScript.length, 0);
});
