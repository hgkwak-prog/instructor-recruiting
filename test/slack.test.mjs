import test from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadSlackFile,
  isDirectMessageChannel,
  rejectionMessage,
  shouldIntake
} from '../adapters/slack/intake.mjs';
import {
  APPROVE_ACTION,
  CHANNEL_SELECT_ACTION,
  REJECT_ACTION,
  buildPreviewMessage,
  selectedChannelFrom,
  truncateForSlack
} from '../adapters/slack/preview.mjs';
import { tokenDaysRemaining } from '../adapters/server/health.mjs';

const pdf = { name: '커리큘럼.pdf', mimetype: 'application/pdf' };

function verification(overrides = {}) {
  return {
    slackJobPost: '*보조강사 모집*\n• 대상 : 개발자',
    pendingMarkers: [],
    warnings: [],
    errors: [],
    postable: true,
    ...overrides
  };
}

// --- 인테이크: 무엇을 받아들이는가 --------------------------------------------

test('DM에 온 PDF만 받는다', () => {
  assert.equal(shouldIntake({ channel: 'D123', user: 'U1', files: [pdf] }).accept, true);
  assert.equal(shouldIntake({ channel: 'C123', user: 'U1', files: [pdf] }).reason, 'not_dm');
  assert.ok(isDirectMessageChannel('D999'));
  assert.ok(!isDirectMessageChannel('C999'));
});

test('봇 자신의 메시지에 반응하지 않는다', () => {
  // 반응하면 무한 루프이고, 매 루프마다 모델 호출이 나간다.
  assert.equal(shouldIntake({ channel: 'D1', bot_id: 'B1', files: [pdf] }).reason, 'bot');
  assert.equal(shouldIntake({ channel: 'D1', subtype: 'bot_message', files: [pdf] }).reason, 'bot');
  assert.equal(shouldIntake({ channel: 'D1', user: 'UBOT', files: [pdf] }, { botUserId: 'UBOT' }).reason, 'self');
});

test('txt와 md도 받는다', () => {
  for (const name of ['a.txt', 'b.md']) {
    assert.equal(shouldIntake({ channel: 'D1', user: 'U1', files: [{ name }] }).accept, true, name);
  }
});

test('파일이 여러 개면 받지 않고 되묻는다', () => {
  // 어느 것이 커리큘럼인지 모르는 채로 호출하면 한도만 태운다.
  const verdict = shouldIntake({ channel: 'D1', user: 'U1', files: [pdf, { name: 'b.pdf' }] });
  assert.equal(verdict.reason, 'multiple');
  assert.match(rejectionMessage(verdict.reason, verdict), /하나만 보내/);
});

test('읽을 수 없는 형식은 이유를 알려준다', () => {
  const verdict = shouldIntake({ channel: 'D1', user: 'U1', files: [{ name: 'x.hwp' }] });
  assert.equal(verdict.reason, 'unsupported');
  assert.match(rejectionMessage(verdict.reason), /PDF, TXT, MD/);
});

test('봇·자기 자신·채널 메시지에는 아무 말도 하지 않는다', () => {
  for (const reason of ['bot', 'self', 'not_dm']) {
    assert.equal(rejectionMessage(reason), null, reason);
  }
});

test('파일 다운로드 실패를 HTTP 코드와 함께 알린다', async () => {
  const fetchImplementation = async () => ({ ok: false, status: 403 });
  await assert.rejects(
    downloadSlackFile({ url: 'https://files.slack/x', token: 'xoxb-t', fetchImplementation }),
    /HTTP 403/
  );
});

// --- 미리보기: 승인 버튼을 언제 띄우는가 --------------------------------------

test('확인 필요 항목이 남으면 승인 버튼을 아예 띄우지 않는다', () => {
  const { blocks } = buildPreviewMessage({
    runId: 'a'.repeat(36),
    verification: verification({ postable: false, pendingMarkers: ['강사료', '지원 방법'] })
  });
  const serialized = JSON.stringify(blocks);
  assert.ok(!serialized.includes(APPROVE_ACTION), '누를 수 없는 버튼을 띄우면 안 됩니다');
  assert.ok(serialized.includes('강사료'));
  assert.match(serialized, /확인 필요/);
});

test('게시 가능하면 승인·반려 버튼과 채널 선택이 붙는다', () => {
  const { blocks } = buildPreviewMessage({
    runId: 'b'.repeat(36),
    verification: verification(),
    defaultChannel: 'C0DEFAULT'
  });
  const serialized = JSON.stringify(blocks);
  for (const id of [APPROVE_ACTION, REJECT_ACTION, CHANNEL_SELECT_ACTION]) {
    assert.ok(serialized.includes(id), id);
  }
  assert.ok(serialized.includes('C0DEFAULT'), '기본 채널이 미리 선택돼 있어야 합니다');
});

test('승인 버튼에는 확인 대화상자가 붙는다', () => {
  // 실수로 누르면 대외에 글이 나간다. 되돌릴 수 없다.
  const { blocks } = buildPreviewMessage({ runId: 'c'.repeat(36), verification: verification() });
  const actions = blocks.find((block) => block.type === 'actions');
  const approve = actions.elements.find((element) => element.action_id === APPROVE_ACTION);
  assert.ok(approve.confirm, '확인 없이 게시되면 안 됩니다');
});

test('일부러 뺀 항목을 누락으로 오해하지 않게 알린다', () => {
  const { blocks } = buildPreviewMessage({ runId: 'd'.repeat(36), verification: verification() });
  assert.match(JSON.stringify(blocks), /의도적으로/);
});

test('본문이 길면 Slack 한도 안으로 자른다', () => {
  const long = 'x'.repeat(5000);
  assert.ok(truncateForSlack(long).length <= 2900);
  assert.match(truncateForSlack(long), /생략/);
  assert.equal(truncateForSlack('짧은 글'), '짧은 글');
});

// --- 채널 선택 ---------------------------------------------------------------

test('담당자가 고른 채널이 기본값을 이긴다', () => {
  const body = {
    state: { values: { some_block: { [CHANNEL_SELECT_ACTION]: { selected_channel: 'C0PICKED' } } } }
  };
  assert.equal(selectedChannelFrom(body, 'C0DEFAULT'), 'C0PICKED');
});

test('고르지 않았으면 기본 채널로 간다', () => {
  assert.equal(selectedChannelFrom({ state: { values: {} } }, 'C0DEFAULT'), 'C0DEFAULT');
  assert.equal(selectedChannelFrom({}, 'C0DEFAULT'), 'C0DEFAULT');
});

// --- 토큰 수명 ---------------------------------------------------------------

test('구독 토큰 남은 날짜를 센다', () => {
  const now = new Date('2026-08-24T00:00:00Z');
  assert.equal(tokenDaysRemaining({ issuedAt: '2026-08-24', now }), 365);
  assert.equal(tokenDaysRemaining({ issuedAt: '2025-09-01', now }), 8);
  assert.ok(tokenDaysRemaining({ issuedAt: '2025-08-01', now }) < 0, '지난 토큰은 음수여야 합니다');
});

test('발급일을 모르면 null이다 — 모르는 것을 안다고 하지 않는다', () => {
  assert.equal(tokenDaysRemaining({ issuedAt: null }), null);
  assert.equal(tokenDaysRemaining({ issuedAt: '아무말' }), null);
});
