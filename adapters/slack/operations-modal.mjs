/**
 * 교육 운영사항 모달.
 *
 * ## 왜 이게 생겼나
 *
 * 커리큘럼은 **제안서 단계 산출물**이다. 고객사에 보여주려고 만든 문서라
 * 강사 운영에 필요한 사실이 원래 안 적혀 있고, 적혀 있어도 계약·일정 조율을
 * 거치며 바뀐다. 장소가 옮겨지고 인원이 조정되는 것은 사고가 아니라 정상이다.
 *
 * 그런데 예전에는 운영 조건이 `.env`가 가리키는 **파일 하나**였다. 부팅할 때
 * 한 번 읽어 모든 건에 같은 값을 썼다. 건마다 다른 값을 넣을 통로가 없으니
 * 커리큘럼에서 못 뽑은 항목은 전부 `[확인 필요]`가 되어 승인이 막혔고,
 * 고치려면 파일을 편집하고 봇을 재시작해야 했다. 이게 "검증이 빡세다"의
 * 진짜 원인이었다 — 검산이 엄한 게 아니라 **채울 방법이 없었다.**
 *
 * 그래서 파일을 받은 자리에서 바로 묻는다. 사람이 지금 상황을 보고 넣은 값이
 * 몇 달 전 제안서를 이긴다. 그 값은 모델이 추측한 것이 아니므로 검산하지 않는다.
 */
export const OPERATIONS_ACTION = 'recruitment_operations';
export const OPERATIONS_MODAL = 'recruitment_operations_modal';

export const ROLE_BLOCK = 'ops_role';
export const LOCATION_BLOCK = 'ops_location';
export const HEADCOUNT_BLOCK = 'ops_headcount';
export const SCHEDULE_BLOCK = 'ops_daily_schedule';
export const WORKING_HOURS_BLOCK = 'ops_working_hours';
export const APPLICATION_BLOCK = 'ops_application';
export const DEADLINE_BLOCK = 'ops_deadline';
export const DEADLINE_TIME_BLOCK = 'ops_deadline_time';
export const TRAVEL_BLOCK = 'ops_travel';
export const EXPLICIT_REQUIREMENTS_BLOCK = 'ops_explicit_requirements';

const ROLES = ['보조강사', '주강사'];
const TIME_RANGE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

function input(blockId, label, element, { hint, optional = false } = {}) {
  return {
    type: 'input',
    block_id: blockId,
    optional,
    label: { type: 'plain_text', text: label },
    ...(hint ? { hint: { type: 'plain_text', text: hint } } : {}),
    element
  };
}

/**
 * @param {object} options
 * @param {string} options.fileName        방금 받은 파일 이름 (무엇에 대한 입력인지 보이게)
 * @param {object} options.defaults        지난 입력값. 매번 같은 것을 다시 치게 하지 않는다.
 */
export function buildOperationsModal({ fileName, defaults = {} } = {}) {
  const role = ROLES.includes(defaults.instructorRole) ? defaults.instructorRole : ROLES[0];

  return {
    type: 'modal',
    callback_id: OPERATIONS_MODAL,
    title: { type: 'plain_text', text: '교육 운영사항' },
    submit: { type: 'plain_text', text: '공고 만들기' },
    close: { type: 'plain_text', text: '취소' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${fileName ?? '커리큘럼'}* 를 읽기 전에 실제 운영 사항을 확인합니다.\n`
            + '커리큘럼은 제안서 단계 문서라 실제와 다를 수 있어, *여기 넣는 값이 우선합니다.*'
        }
      },
      { type: 'divider' },
      input(ROLE_BLOCK, '모집할 역할', {
        type: 'static_select',
        action_id: 'value',
        initial_option: { value: role, text: { type: 'plain_text', text: role } },
        options: ROLES.map((name) => ({ value: name, text: { type: 'plain_text', text: name } }))
      }),
      input(LOCATION_BLOCK, '교육 장소', {
        type: 'plain_text_input',
        action_id: 'value',
        placeholder: { type: 'plain_text', text: '교육이 진행되는 장소' },
        ...(defaults.location ? { initial_value: defaults.location } : {})
      }, { hint: '공고에는 시·군·구까지만 나갑니다. 상세 주소를 적어도 잘립니다.' }),
      input(HEADCOUNT_BLOCK, '모집 인원', {
        type: 'number_input',
        action_id: 'value',
        is_decimal_allowed: false,
        min_value: '1',
        initial_value: String(defaults.headcount ?? 1)
      }),
      input(SCHEDULE_BLOCK, '교육 시간', {
        type: 'plain_text_input',
        action_id: 'value',
        placeholder: { type: 'plain_text', text: '10:00-17:00' },
        ...(defaults.dailySchedule ? { initial_value: defaults.dailySchedule } : {})
      }, { hint: '하루 교육이 진행되는 시간대입니다.' }),
      input(WORKING_HOURS_BLOCK, '근무 시간 (교육 시간과 다를 때만)', {
        type: 'plain_text_input',
        action_id: 'value',
        placeholder: { type: 'plain_text', text: '09:30-17:30' },
        ...(defaults.workingHours ? { initial_value: defaults.workingHours } : {})
      }, { optional: true, hint: '준비·정리 시간이 붙으면 적어 주세요. 지원자에게 필요한 정보입니다.' }),
      input(APPLICATION_BLOCK, '지원 방법', {
        type: 'plain_text_input',
        action_id: 'value',
        placeholder: { type: 'plain_text', text: '채용 담당자 이메일로 이력서 회신' },
        ...(defaults.applicationMethod ? { initial_value: defaults.applicationMethod } : {})
      }, { hint: '이게 없으면 아무도 지원할 수 없습니다.' }),
      input(DEADLINE_BLOCK, '모집 마감일', {
        type: 'datepicker',
        action_id: 'value',
        ...(defaults.deadline ? { initial_date: defaults.deadline } : {})
      }, { optional: true }),
      // 날짜만 나가면 지원자가 자정까지로 오해한다. 제안서에는 모집 마감이
      // 적혀 있을 이유가 없으니, 시각을 넣을 자리는 여기밖에 없다.
      input(DEADLINE_TIME_BLOCK, '마감 시각', {
        type: 'timepicker',
        action_id: 'value',
        ...(defaults.deadlineTime ? { initial_time: defaults.deadlineTime } : {})
      }, { optional: true, hint: '비우면 마감일만 공고에 나갑니다.' }),
      {
        type: 'input',
        block_id: TRAVEL_BLOCK,
        optional: true,
        label: { type: 'plain_text', text: '출장' },
        element: {
          type: 'checkboxes',
          action_id: 'value',
          options: [{
            value: 'included',
            text: { type: 'plain_text', text: '타 지역 출장 — 강사료에 출장비 포함' }
          }],
          ...(defaults.travelExpenseIncluded
            ? {
              initial_options: [{
                value: 'included',
                text: { type: 'plain_text', text: '타 지역 출장 — 강사료에 출장비 포함' }
              }]
            }
            : {})
        }
      },
      // 커리큘럼은 제안서 단계 참고자료라 "경력 5년 이상", "○○ 도메인 경력 필수"
      // 같은 확실한 요구사항은 원문에서 나올 수도, 안 나올 수도 있다.
      // 모델에게 이런 조건을 지어내게 두지 않는다(requiredQualifications 설명
      // 참고) -- 고객사가 실제로 요구한 게 맞는지는 담당자만 안다. 그래서
      // 여기서 사람이 직접, 있는 만큼만 적는다. 없으면 그냥 비워 둔다.
      input(EXPLICIT_REQUIREMENTS_BLOCK, '고객사 명시 요구사항', {
        type: 'plain_text_input',
        action_id: 'value',
        multiline: true,
        placeholder: { type: 'plain_text', text: '경력 5년 이상\nAWS 실무 경력 필수' },
        ...(defaults.explicitRequirements
          ? { initial_value: defaults.explicitRequirements.join('\n') }
          : {})
      }, {
        optional: true,
        hint: '고객사가 확실히 요구한 것만 한 줄에 하나씩. 커리큘럼에 없어도 실제로 들은 게 있으면 적으세요. 없으면 비워 두세요.'
      })
    ]
  };
}

/** 모달 입력을 `conditions` 모양으로 바꾼다. `core/conditions.mjs`가 아는 어휘여야 한다. */
export function parseOperationsModal(view) {
  const values = view?.state?.values ?? {};
  const text = (block) => values[block]?.value?.value?.trim() || null;
  const headcount = values[HEADCOUNT_BLOCK]?.value?.value;
  // 자유 텍스트를 줄 단위로 쪼갠다. 빈 줄은 버리고, 아무것도 안 남으면 null —
  // 빈 배열을 그대로 두면 조건으로 인식돼(applyConditions는 ''/null/undefined만
  // 건너뛴다) "요구사항을 확인했는데 없더라"는 사실과 "안 물어봤다"가 구분이 안 된다.
  const multiline = (block) => {
    const lines = (values[block]?.value?.value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
    return lines.length > 0 ? lines : null;
  };

  return {
    instructorRole: values[ROLE_BLOCK]?.value?.selected_option?.value ?? '보조강사',
    location: text(LOCATION_BLOCK),
    headcount: headcount ? Number(headcount) : null,
    dailySchedule: text(SCHEDULE_BLOCK),
    workingHours: text(WORKING_HOURS_BLOCK),
    applicationMethod: text(APPLICATION_BLOCK),
    deadline: values[DEADLINE_BLOCK]?.value?.selected_date ?? null,
    deadlineTime: values[DEADLINE_TIME_BLOCK]?.value?.selected_time ?? null,
    travelExpenseIncluded: (values[TRAVEL_BLOCK]?.value?.selected_options ?? []).length > 0,
    explicitRequirements: multiline(EXPLICIT_REQUIREMENTS_BLOCK),
    // 고객사 비공개가 기본이다. 공개는 계약상 예외라 모달에서 실수로 열 일이 아니다.
    customerDisclosure: 'hidden'
  };
}

/**
 * 형식만 본다. 값이 맞는지는 사람이 판단한다 — 그러라고 물은 것이다.
 * 시간대 표기만은 고정한다. `10시~5시`가 들어오면 시수 계산이 통째로 어긋난다.
 */
export function validateOperations(conditions) {
  const errors = {};
  if (conditions.dailySchedule && !TIME_RANGE.test(conditions.dailySchedule)) {
    errors[SCHEDULE_BLOCK] = '10:00-17:00 형태로 적어 주세요.';
  }
  if (conditions.workingHours && !TIME_RANGE.test(conditions.workingHours)) {
    errors[WORKING_HOURS_BLOCK] = '09:30-17:30 형태로 적어 주세요.';
  }
  if (!conditions.applicationMethod) {
    errors[APPLICATION_BLOCK] = '지원 방법이 없으면 아무도 지원할 수 없습니다.';
  }
  if (conditions.deadlineTime && !conditions.deadline) {
    errors[DEADLINE_BLOCK] = '마감 시각을 넣으려면 마감일도 필요합니다.';
  }
  return Object.keys(errors).length > 0 ? { response_action: 'errors', errors } : null;
}
