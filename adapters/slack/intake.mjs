/**
 * Slack 인테이크 — 무엇을 받아들이고 무엇을 무시할지.
 *
 * 받는 조건을 좁게 잡는다. 봇이 채널의 모든 파일에 반응하면 소음이 되고,
 * 무엇보다 **모델 호출이 나간다.** 호출은 담당자 본인의 구독 한도를 태우므로
 * "일단 받고 나중에 거른다"는 여기서 비싼 전략이다.
 */

/** Slack DM 채널 ID는 D로 시작한다. */
export function isDirectMessageChannel(channelId) {
  return typeof channelId === 'string' && channelId.startsWith('D');
}

/** 확장자 기준. Slack의 mimetype·filetype은 있을 때도 없을 때도 있다. */
const SUPPORTED = ['.pdf', '.txt', '.md', '.html', '.htm'];

export function isSupportedFile(file) {
  const name = file?.name?.toLowerCase() ?? '';
  if (isPdfFile(file)) return true;
  return SUPPORTED.some((extension) => name.endsWith(extension));
}

export function isHtmlFile(file) {
  const name = file?.name?.toLowerCase() ?? '';
  return file?.mimetype === 'text/html'
    || file?.filetype === 'html'
    || name.endsWith('.html')
    || name.endsWith('.htm');
}

export function isPdfFile(file) {
  return (
    file?.mimetype === 'application/pdf'
    || file?.filetype === 'pdf'
    || file?.name?.toLowerCase().endsWith('.pdf')
  );
}

/**
 * 진행상황 로그(`createProgressReporter`)가 같은 메시지를 `chat.update`로
 * 계속 고쳐 쓰는데, 슬랙은 그 편집마다 `message_changed`(지우면
 * `message_deleted`) 서브타입의 `message` 이벤트를 새로 쏜다. 이런
 * 이벤트는 `bot_id`/`user`가 최상위가 아니라 `event.message` 안에 있어서
 * 아래 봇/자기자신 체크를 그냥 통과해버리고, `files`도 없으니 "파일을
 * 첨부해주세요" 거절 메시지가 진행상황 갱신 횟수만큼 반복해서 나갔다
 * (2026-09-15, 실사용 중 발견 — 진행상황 단계 수만큼 반복 재현됨).
 */
const NON_CONTENT_SUBTYPES = new Set([
  'message_changed',
  'message_deleted',
  'message_replied',
  'thread_broadcast',
  'channel_join',
  'channel_leave'
]);

/**
 * 봇 자신이 올린 파일, 봇 메시지, 스레드 소음을 걸러낸다.
 * `botId`는 auth.test로 얻은 우리 봇의 ID다.
 */
export function shouldIntake(event, { botUserId } = {}) {
  if (!event) return { accept: false, reason: 'empty' };
  if (NON_CONTENT_SUBTYPES.has(event.subtype)) return { accept: false, reason: 'edit' };
  if (event.bot_id || event.subtype === 'bot_message') return { accept: false, reason: 'bot' };
  if (botUserId && event.user === botUserId) return { accept: false, reason: 'self' };
  if (!isDirectMessageChannel(event.channel)) return { accept: false, reason: 'not_dm' };

  const files = event.files ?? [];
  if (files.length === 0) return { accept: false, reason: 'no_file' };

  const supported = files.filter(isSupportedFile);
  if (supported.length === 0) return { accept: false, reason: 'unsupported' };
  // 여러 개를 한 번에 던지면 어느 것이 커리큘럼인지 알 수 없다. 물어보는 편이 낫다.
  if (supported.length > 1) return { accept: false, reason: 'multiple', files: supported };

  return { accept: true, file: supported[0] };
}

/** 인테이크를 거절한 이유를 사람에게 설명한다. null이면 조용히 무시한다. */
export function rejectionMessage(reason, { files = [] } = {}) {
  switch (reason) {
    case 'no_file':
      return '커리큘럼 파일을 첨부해 주세요. PDF, HTML, MD, TXT를 받습니다.';
    case 'unsupported':
      return '읽을 수 없는 형식입니다. PDF, HTML, MD, TXT 중 하나로 보내 주세요.';
    case 'multiple':
      return `파일이 ${files.length}개입니다. 어느 것이 커리큘럼인지 알 수 없으니 하나만 보내 주세요.`;
    default:
      // bot / self / not_dm — 사람에게 말할 일이 아니다.
      return null;
  }
}

export async function downloadSlackFile({ url, token, fetchImplementation = fetch }) {
  if (!url) throw new Error('Slack 파일 다운로드 주소가 없습니다.');
  const response = await fetchImplementation(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`Slack 파일 다운로드에 실패했습니다. HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** 내려받은 파일을 텍스트로 만든다. PDF는 버퍼째 파싱한다. */
export async function readSlackFile({ file, token, fetchImplementation = fetch }) {
  const buffer = await downloadSlackFile({
    url: file.url_private_download ?? file.url_private,
    token,
    fetchImplementation
  });
  const label = file.name ?? '파일';
  const { readPdfBuffer, assertReadableSize } = await import('../documents/files.mjs');

  if (isPdfFile(file)) return readPdfBuffer(buffer, { label });

  if (isHtmlFile(file)) {
    // 이 팀의 HTML은 인라인 CSS·JS가 붙은 완성 문서다. 그대로 넣으면
    // 태그 뭉치에 구독 한도를 태우고 추출 정확도도 떨어진다.
    const { htmlToText } = await import('../../core/html-text.mjs');
    const text = htmlToText(buffer.toString('utf8'));
    if (!text.trim()) {
      throw new Error(`${label}에서 읽을 글을 찾지 못했습니다. 본문이 스크립트로 그려지는 페이지일 수 있습니다.`);
    }
    return assertReadableSize(text, label);
  }

  return assertReadableSize(buffer.toString('utf8'), label);
}
