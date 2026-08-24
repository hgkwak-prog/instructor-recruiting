/**
 * 승인 전 편집 모달.
 *
 * 담당자가 두 가지를 한다.
 *   1. 강사료 입력 — 시간당 단가 또는 총액. **계산은 코드가 한다.**
 *   2. 본문 자유 편집 — 문구를 마음대로 고친다.
 *
 * 자유 편집을 열면 "코드가 조립했으니 맞다"는 보장이 깨진다. 그래서 검사 지점을
 * 조립 시점에서 **게시 직전**으로 옮겼다(`core/publish-guard.mjs`).
 * 손으로 고친 글도 날짜·요일·금액·고객사 검사를 똑같이 통과해야 나간다.
 *
 * 금액 줄만은 예외적으로 코드가 덮어쓴다. 곱셈은 사람이 하면 틀려도 아무도 모른다.
 */
export const EDIT_ACTION = 'recruitment_edit';
export const EDIT_MODAL = 'recruitment_edit_modal';

export const FEE_MODE_BLOCK = 'fee_mode';
export const FEE_AMOUNT_BLOCK = 'fee_amount';
export const POST_BLOCK = 'post_body';

const FEE_MODES = [
  { value: 'hourly', text: '시간당 단가 (총 시수를 곱해 총액을 냅니다)' },
  { value: 'total', text: '총액 직접 입력' }
];

export function buildEditModal({ runId, post, totalHours, compensation = null }) {
  const hourlyHint = Number.isFinite(totalHours) && totalHours > 0
    ? `확정된 총 시수는 ${totalHours}시간입니다. 시간당 단가를 넣으면 곱해서 총액을 냅니다.`
    : '총 시수가 확정되지 않아 시간당 단가는 쓸 수 없습니다. 총액으로 넣으세요.';

  const initialMode = compensation?.mode ?? (Number.isFinite(totalHours) && totalHours > 0 ? 'hourly' : 'total');
  const initialOption = FEE_MODES.find((mode) => mode.value === initialMode) ?? FEE_MODES[1];

  return {
    type: 'modal',
    callback_id: EDIT_MODAL,
    private_metadata: JSON.stringify({ runId }),
    title: { type: 'plain_text', text: '공고 다듬기' },
    submit: { type: 'plain_text', text: '반영' },
    close: { type: 'plain_text', text: '취소' },
    blocks: [
      {
        type: 'input',
        block_id: FEE_MODE_BLOCK,
        label: { type: 'plain_text', text: '강사료 입력 방식' },
        element: {
          type: 'static_select',
          action_id: 'value',
          initial_option: {
            value: initialOption.value,
            text: { type: 'plain_text', text: initialOption.text }
          },
          options: FEE_MODES.map((mode) => ({
            value: mode.value,
            text: { type: 'plain_text', text: mode.text }
          }))
        }
      },
      {
        type: 'input',
        block_id: FEE_AMOUNT_BLOCK,
        label: { type: 'plain_text', text: '금액' },
        hint: { type: 'plain_text', text: `${hourlyHint} 예: 100,000 또는 10만` },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: '100,000' },
          ...(compensation?.amount ? { initial_value: String(compensation.amount) } : {})
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: '원문(커리큘럼·제안서)의 금액은 *고객사 예산*입니다. 여기 넣는 값은 강사에게 제시할 금액이어야 합니다.'
        }]
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: POST_BLOCK,
        label: { type: 'plain_text', text: '공고 본문' },
        hint: { type: 'plain_text', text: '강사료 줄은 위 입력값으로 자동으로 바뀝니다. 나머지는 자유롭게 고치세요.' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          initial_value: post.slice(0, 3000)
        }
      }
    ]
  };
}

export function parseEditModal(view) {
  const values = view?.state?.values ?? {};
  const { runId } = JSON.parse(view?.private_metadata ?? '{}');
  return {
    runId,
    mode: values[FEE_MODE_BLOCK]?.value?.selected_option?.value ?? 'total',
    amount: values[FEE_AMOUNT_BLOCK]?.value?.value ?? '',
    post: values[POST_BLOCK]?.value?.value ?? ''
  };
}

/**
 * 모달 안에서 오류를 보여준다. 창을 닫고 채널에 오류를 던지면 담당자가 방금 쓴
 * 본문을 통째로 잃는다.
 */
export function modalErrors(errors, { feeError = null } = {}) {
  const response = { response_action: 'errors', errors: {} };
  if (feeError) response.errors[FEE_AMOUNT_BLOCK] = feeError.slice(0, 300);
  if (errors.length > 0) response.errors[POST_BLOCK] = errors.join('\n').slice(0, 300);
  return response;
}
