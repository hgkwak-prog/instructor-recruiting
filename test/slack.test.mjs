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
import { EDIT_ACTION } from '../adapters/slack/edit-modal.mjs';
import { buildEditModal, parseEditModal } from '../adapters/slack/edit-modal.mjs';
import { tokenDaysRemaining } from '../adapters/server/health.mjs';

/** 게시 가드를 통과한 상태 */
const passed = { errors: [], warnings: [], postable: true };

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
  assert.match(rejectionMessage(verdict.reason), /PDF, HTML, MD, TXT/);
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
    defaultChannel: 'C0DEFAULT',
    publishCheck: passed
  });
  const serialized = JSON.stringify(blocks);
  for (const id of [APPROVE_ACTION, REJECT_ACTION, CHANNEL_SELECT_ACTION]) {
    assert.ok(serialized.includes(id), id);
  }
  assert.ok(serialized.includes('C0DEFAULT'), '기본 채널이 미리 선택돼 있어야 합니다');
});

test('승인 버튼에는 확인 대화상자가 붙는다', () => {
  // 실수로 누르면 대외에 글이 나간다. 되돌릴 수 없다.
  const { blocks } = buildPreviewMessage({
    runId: 'c'.repeat(36), verification: verification(), publishCheck: passed
  });
  const actions = blocks.filter((block) => block.type === 'actions').at(-1);
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

// --- 강사료 빈칸 게이트 (2026-08-24에 실사용에서 드러난 구멍) -------------------

test('강사료 빈칸이 남으면 승인 버튼이 뜨지 않는다', () => {
  // `______`는 [확인 필요] 마커가 아니라서 조립 시점 게이트(postable)를 그냥 지났다.
  // CLI 시절엔 사람이 복붙하며 채웠으니 드러나지 않았고, 봇이 자동 게시하면서 터졌다.
  const { blocks } = buildPreviewMessage({
    runId: 'e'.repeat(36),
    verification: verification(),
    publishCheck: { errors: ['본문에 빈칸(______)이 남아 있습니다.'], postable: false }
  });
  const serialized = JSON.stringify(blocks);
  assert.ok(!serialized.includes(APPROVE_ACTION), '빈칸이 남은 채로 승인할 수 있으면 안 됩니다');
  assert.ok(serialized.includes(EDIT_ACTION), '대신 편집 버튼이 있어야 합니다');
  assert.match(serialized, /빈칸/);
});

test('publishCheck를 안 넘기면 승인 버튼을 띄우지 않는다', () => {
  // 실수로 검사를 빠뜨렸을 때 열려 있는 쪽으로 기울면 안 된다.
  const { blocks } = buildPreviewMessage({ runId: 'f'.repeat(36), verification: verification() });
  assert.ok(!JSON.stringify(blocks).includes(APPROVE_ACTION));
});

test('편집 버튼은 승인 가능해진 뒤에도 남는다', () => {
  const { blocks } = buildPreviewMessage({
    runId: 'g'.repeat(36), verification: verification(), publishCheck: passed
  });
  assert.ok(JSON.stringify(blocks).includes(EDIT_ACTION));
});

// --- 편집 모달 ---------------------------------------------------------------

test('총 시수가 있으면 시간당 단가를 기본으로 제안한다', () => {
  const modal = buildEditModal({ runId: 'h'.repeat(36), post: '본문', totalHours: 21 });
  const serialized = JSON.stringify(modal);
  assert.match(serialized, /21시간/);
  assert.match(serialized, /"value":"hourly"/);
});

test('총 시수가 없으면 총액 입력을 기본으로 한다', () => {
  const modal = buildEditModal({ runId: 'i'.repeat(36), post: '본문', totalHours: null });
  assert.match(JSON.stringify(modal), /시간당 단가는 쓸 수 없습니다/);
});

test('모달이 고객사 예산과 제시 금액을 구분해 알려준다', () => {
  const modal = buildEditModal({ runId: 'j'.repeat(36), post: '본문', totalHours: 21 });
  assert.match(JSON.stringify(modal), /고객사 예산/);
});

test('모달 입력을 되읽는다', () => {
  const view = {
    private_metadata: JSON.stringify({ runId: 'k'.repeat(36) }),
    state: {
      values: {
        fee_mode: { value: { selected_option: { value: 'hourly' } } },
        fee_amount: { value: { value: '100,000' } },
        post_body: { value: { value: '고친 본문' } }
      }
    }
  };
  assert.deepEqual(parseEditModal(view), {
    runId: 'k'.repeat(36), mode: 'hourly', amount: '100,000', post: '고친 본문'
  });
});

test('경고만 있으면 승인 버튼이 뜨고, 누를 때 경고를 다시 보여준다', () => {
  const { blocks } = buildPreviewMessage({
    runId: 'm'.repeat(36),
    verification: verification(),
    publishCheck: { errors: [], warnings: ['날짜와 요일이 어긋납니다 — 9월 8일(월)'], postable: true }
  });
  const serialized = JSON.stringify(blocks);
  assert.ok(serialized.includes(APPROVE_ACTION), '경고로 게시를 막지는 않습니다');
  assert.match(serialized, /확인하고 넘어가세요/);

  // 누르는 순간 눈앞에 있어야 "못 찾은 사람 책임"이 성립한다.
  const actions = blocks.filter((b) => b.type === 'actions').at(-1);
  const approve = actions.elements.find((e) => e.action_id === APPROVE_ACTION);
  assert.match(approve.confirm.title.text, /확인 1건/);
  assert.match(approve.confirm.text.text, /9월 8일\(월\)/);
});
