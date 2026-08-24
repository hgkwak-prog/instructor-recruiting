import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OUTCOME_ACTION,
  buildOutcomeModal,
  buildReminderMessage,
  dispatchReminders,
  parseOutcomeModal
} from '../adapters/slack/reminder.mjs';
import { readReminderConfig } from '../adapters/reminder-config.mjs';
import { calendarDaysAfter, businessDaysAfter } from '../core/dates.mjs';
import {
  openDatabase, createRun, getRun, reviewRun, completeRun, recordOutcome,
  dueRuns, markFollowUpSent, STATUS
} from '../adapters/store/database.mjs';
import { baseResult } from './fixtures.mjs';

function postedRun({ userId = 'U1', dueAt = '2026-08-19' } = {}) {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'reminder-')), 'r.sqlite'));
  createRun(db, {
    id: 'run-1',
    sourcePath: 'c.txt',
    courseTitle: 'AI 코딩 기초 교육',
    role: '보조강사',
    result: baseResult(),
    jobPost: '*모집*',
    postable: true,
    generatedAt: '2026-08-14T00:00:00.000Z',
    createdByUserId: userId
  });
  reviewRun(db, {
    id: 'run-1', decision: STATUS.APPROVED, reviewer: 'U9', reviewedAt: '2026-08-14T01:00:00.000Z'
  });
  completeRun(db, {
    id: 'run-1',
    completedAt: '2026-08-14T02:00:00.000Z',
    followUpDueAt: dueAt,
    slackPermalink: 'https://slack.example/p1'
  });
  return db;
}

// --- 설정 --------------------------------------------------------------------

test('기본은 평일 3영업일이다', () => {
  assert.deepEqual(readReminderConfig({}), {
    waitDays: 3, dayMode: 'business', pollMs: 300_000, timeZone: 'Asia/Seoul'
  });
});

test('말이 안 되는 설정은 부팅 때 막는다', () => {
  assert.throws(() => readReminderConfig({ RECRUITMENT_WAIT_DAYS: '0' }), /1 이상/);
  assert.throws(() => readReminderConfig({ RECRUITMENT_DAY_MODE: '아무거나' }), /business 또는 calendar/);
  // 1분보다 자주 돌 이유가 없다. 월 15건짜리 일이다.
  assert.throws(() => readReminderConfig({ RECRUITMENT_REMINDER_POLL_MS: '1000' }), /60000 이상/);
});

test('영업일과 달력일이 다르게 나온다', () => {
  // 2026-08-14는 금요일. 3영업일 뒤는 수요일(19일), 3일 뒤는 월요일(17일)이다.
  assert.equal(businessDaysAfter('2026-08-14', 3), '2026-08-19');
  assert.equal(calendarDaysAfter('2026-08-14', 3), '2026-08-17');
});

// --- 발송 --------------------------------------------------------------------

test('예정일이 되면 커리큘럼을 던진 사람에게 간다', async () => {
  const db = postedRun({ userId: 'U_CREATOR' });
  const sentTo = [];

  const sent = await dispatchReminders({
    db, today: '2026-08-19', waitDays: 3, dueRuns, markFollowUpSent,
    send: async ({ userId, message }) => sentTo.push({ userId, text: message.text })
  });

  assert.deepEqual(sent, ['run-1']);
  assert.equal(sentTo[0].userId, 'U_CREATOR', '승인한 사람이 아니라 올린 사람에게 갑니다');
  assert.match(sentTo[0].text, /AI 코딩 기초 교육/);
  assert.equal(getRun(db, 'run-1').status, STATUS.FOLLOW_UP_DUE);
});

test('예정일 전에는 가지 않는다', async () => {
  const db = postedRun({ dueAt: '2026-08-19' });
  const sent = await dispatchReminders({
    db, today: '2026-08-18', waitDays: 3, dueRuns, markFollowUpSent, send: async () => {}
  });
  assert.deepEqual(sent, []);
});

test('두 번 돌아도 한 번만 간다', async () => {
  // 두 번 오면 사람이 무시하기 시작하고, 무시하면 숫자가 안 쌓인다.
  const db = postedRun();
  let calls = 0;
  const send = async () => { calls += 1; };

  await dispatchReminders({ db, today: '2026-08-19', waitDays: 3, dueRuns, markFollowUpSent, send });
  await dispatchReminders({ db, today: '2026-08-20', waitDays: 3, dueRuns, markFollowUpSent, send });
  assert.equal(calls, 1);
});

test('Slack 발송이 실패해도 다시 보내지 않는다', async () => {
  // 표시를 먼저 하고 보내기 때문이다. 한 번 덜 가는 쪽이 두 번 가는 쪽보다 낫다 —
  // 못 받으면 게시글을 보고 알아채지만, 두 번 오면 다음부터 무시한다.
  const db = postedRun();
  const failing = async () => { throw new Error('rate limited'); };
  const errors = [];

  const sent = await dispatchReminders({
    db, today: '2026-08-19', waitDays: 3, dueRuns, markFollowUpSent, send: failing,
    logger: { error: (m) => errors.push(m), warn: () => {} }
  });

  assert.deepEqual(sent, []);
  assert.equal(errors.length, 1);
  assert.deepEqual(dueRuns(db, '2026-08-21'), [], '실패해도 재발송 대상으로 남지 않습니다');
});

test('올린 사람을 모르면 보내지 않고 알린다', async () => {
  // CLI로 만든 건에는 created_by_user_id가 없다.
  const db = postedRun({ userId: null });
  const warned = [];
  const sent = await dispatchReminders({
    db, today: '2026-08-19', waitDays: 3, dueRuns, markFollowUpSent,
    send: async () => assert.fail('보내면 안 됩니다'),
    logger: { warn: (m) => warned.push(m), error: () => {} }
  });
  assert.deepEqual(sent, []);
  assert.equal(warned.length, 1);
});

test('게시 링크를 함께 보낸다', () => {
  const message = buildReminderMessage({
    run: { id: 'a'.repeat(36), course_title: '과정', slack_permalink: 'https://slack.example/p1' },
    waitDays: 3
  });
  const serialized = JSON.stringify(message.blocks);
  assert.match(serialized, /slack.example/);
  assert.ok(serialized.includes(OUTCOME_ACTION));
});

// --- 현황 기록 ---------------------------------------------------------------

test('지원자 수와 최종 채널을 되읽는다', () => {
  const view = {
    private_metadata: JSON.stringify({ runId: 'run-1' }),
    state: {
      values: {
        slack_applicants: { value: { value: '2' } },
        final_channel: { value: { selected_option: { value: 'slack' } } }
      }
    }
  };
  assert.deepEqual(parseOutcomeModal(view), {
    runId: 'run-1', slackApplicants: 2, finalChannel: 'slack'
  });
});

test('"아직 진행 중"은 최종 채널을 정하지 않은 것이다', () => {
  // pending을 그대로 저장하면 나중에 실제 결과가 들어와도 COALESCE가 덮어쓰지 못한다.
  const view = {
    private_metadata: JSON.stringify({ runId: 'run-1' }),
    state: {
      values: {
        slack_applicants: { value: { value: '0' } },
        final_channel: { value: { selected_option: { value: 'pending' } } }
      }
    }
  };
  assert.equal(parseOutcomeModal(view).finalChannel, null);
});

test('지원자 0명도 기록된다 — 그게 판단 근거다', () => {
  const db = postedRun();
  recordOutcome(db, { id: 'run-1', slackApplicants: 0, finalChannel: 'phone' });
  const run = getRun(db, 'run-1');
  assert.equal(run.slack_applicants, 0);
  assert.equal(run.final_channel, 'phone');
});

test('나중에 들어온 결과가 앞선 미정을 덮어쓴다', () => {
  const db = postedRun();
  recordOutcome(db, { id: 'run-1', slackApplicants: 1, finalChannel: null });
  recordOutcome(db, { id: 'run-1', slackApplicants: 3, finalChannel: 'slack' });
  const run = getRun(db, 'run-1');
  assert.equal(run.slack_applicants, 3);
  assert.equal(run.final_channel, 'slack');
});

test('현황 모달이 이미 적힌 지원자 수를 보여준다', () => {
  const modal = buildOutcomeModal({ run: { id: 'r', course_title: '과정', slack_applicants: 2 } });
  assert.match(JSON.stringify(modal), /"initial_value":"2"/);
});
