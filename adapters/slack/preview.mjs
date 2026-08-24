/**
 * 검토 미리보기 메시지.
 *
 * 담당자가 승인 버튼을 누르기 전에 보는 화면이다. 여기서 보여줄 것과 보여주지 않을 것이
 * 갈린다 — **검토 화면은 사내용이라 고객사명·금액·정확한 주소를 보여도 되지만,
 * 게시될 본문에는 그것들이 없다.** 두 가지를 한 화면에 섞으면 검토자가 "금액이 왜 없지"
 * 하고 공고를 고치려 든다. 그래서 게시 본문을 그대로 보여주고, 가려진 항목은 따로 알린다.
 */

export const APPROVE_ACTION = 'recruitment_approve';
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
 * @param {object} input.verification  verifyResult()의 결과
 * @param {string[]} input.warnings
 * @param {string|null} input.defaultChannel  기본 게시 채널
 */
export function buildPreviewMessage({ runId, verification, warnings = [], defaultChannel = null }) {
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

  if (verification.postable) {
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
          confirm: {
            title: { type: 'plain_text', text: '게시할까요?' },
            text: { type: 'mrkdwn', text: '승인하면 봇이 바로 채널에 올립니다.' },
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
  } else {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: '확인 필요 항목이 남아 있어 승인 버튼을 띄우지 않았습니다. 운영 조건을 채워 다시 생성하세요.'
      }]
    });
  }

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
