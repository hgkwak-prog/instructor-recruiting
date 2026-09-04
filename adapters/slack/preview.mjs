/**
 * 검토 미리보기 메시지.
 *
 * 담당자가 승인 버튼을 누르기 전에 보는 화면이다. 여기서 보여줄 것과 보여주지 않을 것이
 * 갈린다 — **검토 화면은 사내용이라 고객사명·금액·정확한 주소를 보여도 되지만,
 * 게시될 본문에는 그것들이 없다.** 두 가지를 한 화면에 섞으면 검토자가 "금액이 왜 없지"
 * 하고 공고를 고치려 든다. 그래서 게시 본문을 그대로 보여주고, 가려진 항목은 따로 알린다.
 */

export const APPROVE_ACTION = 'recruitment_approve';
export const EDIT_ACTION = 'recruitment_edit';
export const REJECT_ACTION = 'recruitment_reject';
export const CHANNEL_SELECT_ACTION = 'recruitment_target_channel';

const MAX_SECTION = 2900; // Slack section text 한도는 3000자다

export function truncateForSlack(text, limit = MAX_SECTION) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 20)}\n… (생략, 리포트 참고)`;
}

function bulletList(items) {
  return items.map((item) => `• ${item}`).join('\n');
}

/**
 * @param {object} input
 * @param {string} input.runId
 * @param {object} input.verification  { slackJobPost, pendingMarkers }
 * @param {string[]} input.warnings
 * @param {string|null} input.defaultChannel  기본 게시 채널
 */
export function buildPreviewMessage({
  runId, verification, warnings = [], defaultChannel = null,
  publishCheck = null, compensation = null
}) {
  // 검산기가 없어지면서 "게시 가능" 판정 자체가 사라졌다. 승인/반려 버튼은
  // 항상 뜬다 -- pendingMarkers는 정보성 안내일 뿐 버튼을 막지 않는다.
  const guardWarnings = publishCheck?.warnings ?? [];
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*검토 요청* · \`${runId.slice(0, 8)}\`` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: truncateForSlack(verification.slackJobPost ?? '(본문 없음)') }
    }
  ];

  if (verification.pendingMarkers?.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:no_entry: *확인 필요 — 승인할 수 없습니다*\n${bulletList(verification.pendingMarkers)}`
      }
    });
  }

  if (warnings.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:warning: *검토 사항*\n${bulletList(warnings)}` }
    });
  }

  // 공고에서 일부러 뺀 것들. 검토자가 누락으로 오해하지 않도록 명시한다.
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: '고객사명·강사료 금액·정확한 주소·일차별 커리큘럼은 *의도적으로* 공고에서 뺐습니다. 원문 값은 검토 리포트에 있습니다.'
    }]
  });

  if (publishCheck?.errors?.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:pencil2: *게시 전 처리 필요*\n${bulletList(publishCheck.errors)}`
      }
    });
  }

  // 경고는 막지 않는다. 보고 판단하는 것은 사람 몫이고, 눌렀다는 사실은 남는다.
  if (guardWarnings.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:eyes: *확인하고 넘어가세요* (게시는 막지 않습니다)\n${bulletList(guardWarnings)}`
      }
    });
  }

  if (compensation) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `강사료 확정: ${compensation.line}` }]
    });
  }

  // 편집 버튼은 언제나 있다. 강사료는 커리큘럼에서 나올 수 없는 값이라
  // 사람이 한 번은 반드시 손대야 한다.
  blocks.push({
    type: 'actions',
    block_id: `edit_${runId}`,
    elements: [{
      type: 'button',
      action_id: EDIT_ACTION,
      text: { type: 'plain_text', text: '강사료 입력·본문 편집' },
      value: runId
    }]
  });

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*게시 채널*\n기본값으로 두면 <#${defaultChannel ?? '미설정'}>에 올라갑니다.` },
    accessory: {
      type: 'channels_select',
      action_id: CHANNEL_SELECT_ACTION,
      placeholder: { type: 'plain_text', text: '다른 채널 선택' },
      ...(defaultChannel ? { initial_channel: defaultChannel } : {})
    }
  });
  blocks.push({
    type: 'actions',
    block_id: `decision_${runId}`,
    elements: [
      {
        type: 'button',
        action_id: APPROVE_ACTION,
        style: 'primary',
        text: { type: 'plain_text', text: '승인하고 게시' },
        value: runId,
        // 경고가 있으면 누르는 순간 다시 한 번 보여 준다.
        // "못 찾은 사람 책임"이 성립하려면 최소한 눈앞에 있었어야 한다.
        confirm: {
          title: { type: 'plain_text', text: guardWarnings.length > 0 ? `확인 ${guardWarnings.length}건, 게시할까요?` : '게시할까요?' },
          text: {
            type: 'mrkdwn',
            text: guardWarnings.length > 0
              ? `${bulletList(guardWarnings)}\n\n그대로 게시합니다.`
              : '승인하면 봇이 바로 채널에 올립니다.'
          },
          confirm: { type: 'plain_text', text: '게시' },
          deny: { type: 'plain_text', text: '취소' }
        }
      },
      {
        type: 'button',
        action_id: REJECT_ACTION,
        style: 'danger',
        text: { type: 'plain_text', text: '반려' },
        value: runId
      }
    ]
  });

  return {
    text: `보조강사 구인 검토 요청 (${runId.slice(0, 8)})`,
    blocks
  };
}

/**
 * 미리보기에 붙은 channels_select에서 담당자가 고른 채널을 꺼낸다.
 * 고르지 않았으면 기본 채널로 간다.
 */
export function selectedChannelFrom(body, fallback) {
  const values = body?.state?.values ?? {};
  for (const block of Object.values(values)) {
    const picked = block?.[CHANNEL_SELECT_ACTION]?.selected_channel;
    if (picked) return picked;
  }
  return fallback;
}

/** 게시 후 미리보기를 결과 요약으로 바꾼다. 버튼이 남아 두 번 눌리는 것을 막는다. */
export function buildPublishedMessage({ runId, permalink, channel, approver }) {
  const where = permalink ? `<${permalink}|게시된 공고>` : `<#${channel}>`;
  return {
    text: `게시 완료 (${runId.slice(0, 8)})`,
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: `:white_check_mark: *게시 완료* · \`${runId.slice(0, 8)}\`\n${where} · 승인 <@${approver}>` }
    }]
  };
}

export function buildRejectedMessage({ runId, approver, note }) {
  return {
    text: `반려 (${runId.slice(0, 8)})`,
    blocks: [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:x: *반려* · \`${runId.slice(0, 8)}\` · <@${approver}>${note ? `\n> ${note}` : ''}`
      }
    }]
  };
}
