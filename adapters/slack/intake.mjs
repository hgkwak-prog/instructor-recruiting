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

export function isSupportedFile(file) {
  const name = file?.name?.toLowerCase() ?? '';
  return (
    file?.mimetype === 'application/pdf'
    || file?.filetype === 'pdf'
    || name.endsWith('.pdf')
    || name.endsWith('.txt')
    || name.endsWith('.md')
  );
}

export function isPdfFile(file) {
  return (
    file?.mimetype === 'application/pdf'
    || file?.filetype === 'pdf'
    || file?.name?.toLowerCase().endsWith('.pdf')
  );
}

/**
 * 봇 자신이 올린 파일, 봇 메시지, 스레드 소음을 걸러낸다.
 * `botId`는 auth.test로 얻은 우리 봇의 ID다.
 */
export function shouldIntake(event, { botUserId } = {}) {
  if (!event) return { accept: false, reason: 'empty' };
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
      return '커리큘럼 파일을 첨부해 주세요. PDF, TXT, MD를 받습니다.';
    case 'unsupported':
      return '읽을 수 없는 형식입니다. PDF, TXT, MD 중 하나로 보내 주세요.';
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
  if (isPdfFile(file)) {
    const { readPdfBuffer } = await import('../documents/files.mjs');
    return readPdfBuffer(buffer, { label: file.name ?? 'PDF' });
  }
  return buffer.toString('utf8');
}
