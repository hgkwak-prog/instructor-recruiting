/**
 * 게시 후 3영업일 현황 확인.
 *
 * 이 알림이 이 프로젝트의 목적 그 자체다. 슬랙 공고로 3영업일 안에 지원자가 붙는지가
 * "강사 풀에 전화 돌리기를 끊어도 되는가"를 가른다. 45~60건 쌓이면 판단이 선다.
 * 그래서 알림은 재촉이 아니라 **숫자를 받아내는 장치**다 — 지원자 수를 묻는다.
 *
 * 한 건당 한 번만 보낸다. 두 번 오면 사람이 무시하기 시작하고, 무시하기 시작하면
 * 숫자가 안 쌓이고, 숫자가 없으면 애초에 이걸 만든 이유가 없어진다.
 */
export const OUTCOME_ACTION = 'recruitment_outcome';
export const OUTCOME_MODAL = 'recruitment_outcome_modal';

export const APPLICANTS_BLOCK = 'slack_applicants';
export const CHANNEL_BLOCK = 'final_channel';

const FINAL_CHANNELS = [
  { value: 'slack', text: '슬랙에서 채용 완료' },
  { value: 'careerday', text: '커리어데이로 넘어감' },
  { value: 'phone', text: '결국 전화로 구함' },
  { value: 'pending', text: '아직 진행 중' }
];

export function buildReminderMessage({ run, waitDays = 3 }) {
  const title = run.course_title ?? '보조강사 공고';
  const link = run.slack_permalink ? `<${run.slack_permalink}|게시된 공고>` : '(링크 없음)';
  return {
    text: `[모집 현황 확인] ${title}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:calendar: *모집 현황 확인* · \`${run.id.slice(0, 8)}\`\n`
            + `*${title}* 게시 후 ${waitDays}영업일이 지났습니다.\n${link}`
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: '지원자 수를 남겨 주세요. 이 숫자가 쌓여야 전화를 줄여도 되는지 판단할 수 있습니다.'
        }]
      },
      {
        type: 'actions',
        block_id: `outcome_${run.id}`,
        elements: [{
          type: 'button',
          action_id: OUTCOME_ACTION,
          style: 'primary',
          text: { type: 'plain_text', text: '현황 입력' },
          value: run.id
        }]
      }
    ]
  };
}

export function buildOutcomeModal({ run }) {
  return {
    type: 'modal',
    callback_id: OUTCOME_MODAL,
    private_metadata: JSON.stringify({ runId: run.id }),
    title: { type: 'plain_text', text: '모집 현황' },
    submit: { type: 'plain_text', text: '기록' },
    close: { type: 'plain_text', text: '닫기' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${run.course_title ?? '보조강사 공고'}*` }
      },
      {
        type: 'input',
        block_id: APPLICANTS_BLOCK,
        label: { type: 'plain_text', text: '슬랙 공고로 들어온 지원자 수' },
        element: {
          type: 'number_input',
          action_id: 'value',
          is_decimal_allowed: false,
          min_value: '0',
          ...(Number.isInteger(run.slack_applicants) ? { initial_value: String(run.slack_applicants) } : {})
        }
      },
      {
        type: 'input',
        block_id: CHANNEL_BLOCK,
        label: { type: 'plain_text', text: '최종 결과' },
        element: {
          type: 'static_select',
          action_id: 'value',
          options: FINAL_CHANNELS.map((channel) => ({
            value: channel.value,
            text: { type: 'plain_text', text: channel.text }
          }))
        }
      }
    ]
  };
}

export function parseOutcomeModal(view) {
  const values = view?.state?.values ?? {};
  const { runId } = JSON.parse(view?.private_metadata ?? '{}');
  const raw = values[APPLICANTS_BLOCK]?.value?.value;
  const finalChannel = values[CHANNEL_BLOCK]?.value?.selected_option?.value ?? null;
  return {
    runId,
    slackApplicants: raw === undefined || raw === null || raw === '' ? null : Number(raw),
    // 아직 진행 중이면 최종 채널을 정하지 않은 것이다. null로 두어야
    // 나중에 실제 결과가 들어올 때 COALESCE가 덮어쓸 수 있다.
    finalChannel: finalChannel === 'pending' ? null : finalChannel
  };
}

export function buildOutcomeRecordedMessage({ run, slackApplicants, finalChannel }) {
  const label = FINAL_CHANNELS.find((channel) => channel.value === (finalChannel ?? 'pending'))?.text ?? '기록됨';
  return {
    text: `현황 기록 (${run.id.slice(0, 8)})`,
    blocks: [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:bar_chart: *현황 기록* · \`${run.id.slice(0, 8)}\`\n`
          + `${run.course_title ?? '보조강사 공고'} · 슬랙 지원자 ${slackApplicants ?? 0}명 · ${label}`
      }
    }]
  };
}

/**
 * 알림을 보낼 대상을 고르고, 보낸 것을 표시한다.
 *
 * **표시를 먼저 하고 보낸다.** 순서가 반대면 Slack 호출이 실패해 재시도될 때
 * 같은 사람에게 두 번 간다. 한 번 덜 가는 쪽이 두 번 가는 쪽보다 낫다 —
 * 못 받으면 담당자가 게시글을 보고 알아채지만, 두 번 오면 다음부터 무시한다.
 */
export async function dispatchReminders({
  db, today, waitDays, dueRuns, markFollowUpSent, send, logger = console
}) {
  const runs = dueRuns(db, today);
  const sent = [];
  for (const run of runs) {
    if (!run.created_by_user_id) {
      logger.warn(`알림 대상을 모릅니다 (run ${run.id}): created_by_user_id가 비어 있습니다.`);
      continue;
    }
    markFollowUpSent(db, run.id, new Date().toISOString());
    try {
      await send({ userId: run.created_by_user_id, message: buildReminderMessage({ run, waitDays }) });
      sent.push(run.id);
    } catch (error) {
      logger.error(`알림 발송 실패 (run ${run.id}): ${error.message}`);
    }
  }
  return sent;
}
