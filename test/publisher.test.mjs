import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PublishError,
  createClipboardPublisher,
  createPublisher,
  createSlackPublisher
} from '../adapters/publisher/index.mjs';

function fakeClient({ post = {}, permalink = 'https://slack.example/p1', permalinkFails = false } = {}) {
  const calls = { postMessage: [], getPermalink: [] };
  return {
    calls,
    chat: {
      async postMessage(args) {
        calls.postMessage.push(args);
        return { ok: true, channel: args.channel, ts: '1723459200.000100', ...post };
      },
      async getPermalink(args) {
        calls.getPermalink.push(args);
        if (permalinkFails) throw new Error('ratelimited');
        return { ok: true, permalink };
      }
    }
  };
}

test('기본 채널로 게시하고 위치를 돌려준다', async () => {
  const client = fakeClient();
  const publisher = createSlackPublisher({ client, defaultChannel: 'C0DEFAULT' });

  const result = await publisher.publish({ runId: 'r1', post: '보조강사 모집' });

  assert.equal(client.calls.postMessage[0].channel, 'C0DEFAULT');
  assert.equal(client.calls.postMessage[0].text, '보조강사 모집');
  assert.equal(result.channel, 'C0DEFAULT');
  assert.equal(result.messageTs, '1723459200.000100');
  assert.equal(result.permalink, 'https://slack.example/p1');
});

test('승인 화면에서 고른 채널이 기본값을 이긴다', async () => {
  const client = fakeClient();
  const publisher = createSlackPublisher({ client, defaultChannel: 'C0DEFAULT' });
  await publisher.publish({ runId: 'r1', post: '본문', target: 'C0OTHER' });
  assert.equal(client.calls.postMessage[0].channel, 'C0OTHER');
});

test('공고는 블록으로 쪼개지 않고 text 하나로 보낸다', async () => {
  // 사람이 복사해 다른 데 옮기는 일이 잦다. 블록으로 나누면 서식이 깨진다.
  const client = fakeClient();
  const publisher = createSlackPublisher({ client, defaultChannel: 'C0DEFAULT' });
  await publisher.publish({ runId: 'r1', post: '여러\n줄\n공고' });
  const [args] = client.calls.postMessage;
  assert.equal(args.text, '여러\n줄\n공고');
  assert.ok(!('blocks' in args));
});

test('채널이 없으면 게시하지 않는다', async () => {
  const client = fakeClient();
  const publisher = createSlackPublisher({ client, defaultChannel: null });
  await assert.rejects(publisher.publish({ runId: 'r1', post: '본문' }), PublishError);
  assert.equal(client.calls.postMessage.length, 0);
});

test('퍼머링크 조회가 실패해도 게시는 성공이다', async () => {
  // 글은 이미 나갔다. 링크를 못 얻었다고 실패로 처리하면 상태가 어긋난다.
  const client = fakeClient({ permalinkFails: true });
  const publisher = createSlackPublisher({ client, defaultChannel: 'C0DEFAULT' });
  const result = await publisher.publish({ runId: 'r1', post: '본문' });
  assert.equal(result.messageTs, '1723459200.000100');
  assert.equal(result.permalink, null);
});

test('Slack 오류를 사람이 고칠 수 있는 말로 바꾼다', async () => {
  const cases = [
    ['not_in_channel', /봇을 초대/],
    ['channel_not_found', /채널 ID를 확인/],
    ['missing_scope', /chat:write/],
    ['not_allowed_token_type', /SLACK_BOT_TOKEN/]
  ];
  for (const [code, expected] of cases) {
    const client = {
      chat: {
        async postMessage() {
          const error = new Error('slack');
          error.data = { error: code };
          throw error;
        }
      }
    };
    const publisher = createSlackPublisher({ client, defaultChannel: 'C0X' });
    await assert.rejects(publisher.publish({ runId: 'r', post: 'p' }), expected, code);
  }
});

test('ok:false 응답도 실패로 본다', async () => {
  const client = {
    chat: { async postMessage() { return { ok: false, error: 'is_archived' }; } }
  };
  const publisher = createSlackPublisher({ client, defaultChannel: 'C0X' });
  await assert.rejects(publisher.publish({ runId: 'r', post: 'p' }), /보관됨/);
});

test('clipboard 구현체는 글을 쏘지 않고 본문을 모아 둔다', async () => {
  // 워크스페이스 권한이 막혔을 때의 후퇴 경로다.
  const publisher = createClipboardPublisher();
  const result = await publisher.publish({ runId: 'r1', post: '본문' });
  assert.equal(result.clipboard, true);
  assert.equal(result.messageTs, null);
  assert.deepEqual(publisher.published, [{ runId: 'r1', post: '본문', target: null }]);
});

test('PUBLISH_MODE로 구현체를 고른다', () => {
  assert.equal(createPublisher({ mode: 'clipboard' }).name, 'clipboard');
  assert.equal(createPublisher({ mode: 'slack', client: fakeClient(), defaultChannel: 'C' }).name, 'slack');
});
