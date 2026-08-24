/**
 * 게시 어댑터.
 *
 * **게시 대상은 바뀔 예정이다.** 지금은 사내 Slack 채널이지만 자체 커뮤니티로 옮길
 * 계획이 있다. 그래서 봇은 Slack API를 직접 부르지 않고 이 인터페이스만 안다.
 * 채널이 바뀌면 구현체 하나를 추가하면 되고, 상태머신과 승인 게이트는 그대로다.
 *
 *   publish({ runId, post, target }) → { channel, messageTs, permalink }
 *
 * 이 추상화는 보험이기도 하다. 워크스페이스 권한이 막히면 `clipboardPublisher`로
 * 바꿔 예전의 복붙 운영으로 후퇴할 수 있다 — 코드 한 줄 교체로.
 */

export class PublishError extends Error {
  constructor(message, { target, cause } = {}) {
    super(message);
    this.name = 'PublishError';
    this.target = target;
    this.cause = cause;
  }
}

/**
 * Slack 채널에 게시한다.
 *
 * `chat.postMessage`의 `text`는 알림 미리보기와 접근성에 쓰이므로 본문을 그대로 넣는다.
 * 블록으로 감싸지 않는 이유는 공고가 이미 조립된 완성 텍스트이고, 블록으로 쪼개면
 * 사람이 복사해 다른 데 옮길 때 서식이 깨지기 때문이다.
 */
export function createSlackPublisher({ client, defaultChannel }) {
  return {
    name: 'slack',
    defaultChannel,
    async publish({ runId, post, target = defaultChannel }) {
      if (!target) {
        throw new PublishError('게시할 채널이 없습니다. SLACK_CHANNEL_ID를 설정하거나 승인 화면에서 채널을 고르세요.', { target });
      }
      let posted;
      try {
        posted = await client.chat.postMessage({ channel: target, text: post, unfurl_links: false });
      } catch (error) {
        throw new PublishError(describeSlackError(error, target), { target, cause: error });
      }
      if (!posted?.ok) {
        throw new PublishError(describeSlackError(posted, target), { target });
      }

      // 퍼머링크는 있으면 좋고 없어도 게시는 성공이다. 여기서 실패하면 안 된다.
      let permalink = null;
      try {
        const link = await client.chat.getPermalink({ channel: posted.channel, message_ts: posted.ts });
        permalink = link?.permalink ?? null;
      } catch {
        permalink = null;
      }

      return { runId, channel: posted.channel, messageTs: posted.ts, permalink };
    }
  };
}

function describeSlackError(error, target) {
  const code = error?.data?.error ?? error?.error ?? error?.message ?? '알 수 없는 오류';
  const hints = {
    not_in_channel: `봇이 채널 ${target}에 없습니다. 채널에서 봇을 초대하세요.`,
    channel_not_found: `채널 ${target}을 찾을 수 없습니다. 채널 ID를 확인하세요.`,
    is_archived: `채널 ${target}이 보관됨 상태입니다.`,
    missing_scope: '봇에 chat:write 권한이 없습니다. Slack 앱 스코프를 확인하고 재설치하세요.',
    not_allowed_token_type: '봇 토큰(xoxb-)이 아닙니다. SLACK_BOT_TOKEN을 확인하세요.'
  };
  return hints[code] ?? `Slack 게시 실패: ${code}`;
}

/**
 * 게시하지 않고 본문만 돌려주는 구현체.
 *
 * 워크스페이스 권한이 막혔을 때의 후퇴 경로이자, 실제로 글을 쏘지 않고 흐름을
 * 끝까지 돌려보고 싶을 때 쓴다(`PUBLISH_MODE=clipboard`).
 * 상태는 정상적으로 게시완료로 넘어간다 — 사람이 붙여넣는 것을 전제하기 때문이다.
 */
export function createClipboardPublisher() {
  const published = [];
  return {
    name: 'clipboard',
    defaultChannel: null,
    published,
    async publish({ runId, post, target = null }) {
      published.push({ runId, post, target });
      return { runId, channel: target, messageTs: null, permalink: null, clipboard: true };
    }
  };
}

export function createPublisher({ mode, client, defaultChannel }) {
  if (mode === 'clipboard') return createClipboardPublisher();
  return createSlackPublisher({ client, defaultChannel });
}
