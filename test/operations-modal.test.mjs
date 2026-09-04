import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLICATION_BLOCK,
  SCHEDULE_BLOCK,
  buildOperationsModal,
  parseOperationsModal,
  validateOperations
} from '../adapters/slack/operations-modal.mjs';
import { applyConditions } from '../core/conditions.mjs';

const fact = (value, evidence = '커리큘럼') => ({ value, evidence });

function view(overrides = {}) {
  const values = {
    ops_role: { value: { selected_option: { value: '보조강사' } } },
    ops_location: { value: { value: '서울시 강남구 ○○센터' } },
    ops_headcount: { value: { value: '2' } },
    ops_daily_schedule: { value: { value: '10:00-17:00' } },
    ops_working_hours: { value: { value: '09:30-17:30' } },
    ops_application: { value: { value: 'edu@example.com으로 회신' } },
    ops_deadline: { value: { selected_date: '2026-08-30' } },
    ops_travel: { value: { selected_options: [] } },
    ...overrides
  };
  return { state: { values } };
}

// --- 모달 -------------------------------------------------------------------

test('무엇에 대한 입력인지 파일명을 보여준다', () => {
  const modal = buildOperationsModal({ fileName: 'VOC자동화_커리큘럼.pdf' });
  assert.match(JSON.stringify(modal), /VOC자동화_커리큘럼\.pdf/);
});

test('여기 넣는 값이 커리큘럼을 이긴다고 알려준다', () => {
  // 이걸 안 적으면 담당자가 "제안서랑 다른데 괜찮나" 하고 망설인다.
  assert.match(JSON.stringify(buildOperationsModal({})), /여기 넣는 값이 우선/);
});

test('지난 입력을 미리 채워 준다 — 대부분 장소·지원방법이 같다', () => {
  const modal = buildOperationsModal({
    defaults: { location: '서울시 성동구', applicationMethod: 'edu@example.com', headcount: 2 }
  });
  const serialized = JSON.stringify(modal);
  assert.match(serialized, /"initial_value":"서울시 성동구"/);
  assert.match(serialized, /"initial_value":"2"/);
});

test('입력을 conditions 어휘로 바꾼다', () => {
  assert.deepEqual(parseOperationsModal(view()), {
    instructorRole: '보조강사',
    location: '서울시 강남구 ○○센터',
    headcount: 2,
    dailySchedule: '10:00-17:00',
    workingHours: '09:30-17:30',
    applicationMethod: 'edu@example.com으로 회신',
    deadline: '2026-08-30',
    travelExpenseIncluded: false,
    customerDisclosure: 'hidden'
  });
});

test('고객사 비공개가 기본이다 — 모달에서 실수로 열 수 없다', () => {
  assert.equal(parseOperationsModal(view()).customerDisclosure, 'hidden');
});

test('출장 체크가 강사료 문구를 바꾼다', () => {
  const checked = view({ ops_travel: { value: { selected_options: [{ value: 'included' }] } } });
  assert.equal(parseOperationsModal(checked).travelExpenseIncluded, true);
});

// --- 검증: 형식만 본다 ---------------------------------------------------------

test('제대로 채우면 통과한다', () => {
  assert.equal(validateOperations(parseOperationsModal(view())), null);
});

test('시간대 표기는 고정한다 — 어긋나면 시수 계산이 통째로 틀린다', () => {
  const invalid = validateOperations({ dailySchedule: '10시~5시', applicationMethod: 'x' });
  assert.ok(invalid.errors[SCHEDULE_BLOCK]);
});

test('지원 방법이 없으면 막는다 — 아무도 지원할 수 없다', () => {
  const invalid = validateOperations({ applicationMethod: null });
  assert.match(invalid.errors[APPLICATION_BLOCK], /아무도 지원할 수 없/);
});

test('값이 맞는지는 판단하지 않는다 — 그러라고 물은 것이다', () => {
  // 장소가 이상해 보여도 막지 않는다. 사람이 지금 상황을 보고 넣은 값이다.
  assert.equal(validateOperations({ location: '어딘가', applicationMethod: '전화' }), null);
});

// --- 담당자 입력이 커리큘럼을 이긴다 --------------------------------------------

test('커리큘럼에 값이 있어도 담당자 입력으로 덮어쓴다', () => {
  // 제안서에는 성동구인데 실제 운영은 강남으로 옮겨졌다. 사고가 아니라 정상이다.
  const facts = { location: fact('서울 성동구 코워킹'), headcount: fact(1) };
  const { facts: next, overridden } = applyConditions(
    facts,
    { location: '서울시 강남구 ○○센터', headcount: 2 },
    { override: true }
  );

  assert.equal(next.location.value, '서울시 강남구 ○○센터');
  assert.equal(next.headcount.value, 2);
  assert.match(next.location.evidence, /담당자 입력/);
  assert.match(next.location.evidence, /서울 성동구 코워킹/, '원문이 무엇이었는지 남아야 합니다');
  assert.equal(overridden.length, 2);
});

test('override가 꺼져 있으면 빈 값만 채운다', () => {
  const facts = { location: fact('서울 성동구'), headcount: { value: null, evidence: null } };
  const { facts: next, filled, overridden } = applyConditions(
    facts, { location: '서울시 강남구', headcount: 2 }
  );
  assert.equal(next.location.value, '서울 성동구', '기존 값을 건드리지 않습니다');
  assert.equal(next.headcount.value, 2);
  assert.deepEqual(filled, ['headcount']);
  assert.deepEqual(overridden, []);
});

test('같은 값이면 덮어쓴 것으로 세지 않는다', () => {
  const facts = { location: fact('서울시 강남구') };
  const { overridden } = applyConditions(facts, { location: '서울시 강남구' }, { override: true });
  assert.deepEqual(overridden, []);
});

test('빈 문자열은 조건으로 치지 않는다', () => {
  // 모달의 선택 항목을 비워 두면 빈 문자열이 온다. 그걸로 덮어쓰면 값이 사라진다.
  const facts = { workingHours: fact('09:30-17:30') };
  const { facts: next, overridden } = applyConditions(
    facts, { workingHours: '' }, { override: true }
  );
  assert.equal(next.workingHours.value, '09:30-17:30');
  assert.deepEqual(overridden, []);
});

// --- 출처 없는 기본값이 새어들지 않는다 (2026-08-24) ---------------------------

test('모달에 미리 채우지 않는다 — 확인 없이 넘어가면 출처 없는 값이 공고가 된다', () => {
  const modal = buildOperationsModal({ fileName: 'x.pdf' });
  const serialized = JSON.stringify(modal);
  // 인원만 1로 시작한다. 나머지는 사람이 직접 쳐야 한다.
  assert.ok(!serialized.includes('"initial_value":"10:00-17:00"'));
  assert.ok(!serialized.includes('"initial_date"'));
});

test('예시 주소·장소가 코드에 박혀 있지 않다', async () => {
  // `.env`가 examples/operating-conditions.json을 가리킨 탓에 가짜 장소·시간·마감일이
  // 모든 건의 기본값으로 들어갔고, evidence가 붙어 검산까지 통과했다.
  // 같은 값이 placeholder로도 남아 있었다.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../adapters/slack/operations-modal.mjs', import.meta.url), 'utf8'
  );
  for (const leaked of ['modulabs.co.kr', '서울시 성동구', '2026-08-25']) {
    assert.ok(!source.includes(leaked), `${leaked}가 코드에 남아 있습니다`);
  }
});

test('예제 파일이 봇 설정으로 새어들 수 없다', async () => {
  // .env가 examples/ 를 가리키면 부팅이 멈춰야 한다.
  const { readFileSync } = await import('node:fs');
  for (const name of ['.env', '.env.example']) {
    let content;
    try {
      content = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    } catch {
      continue;
    }
    assert.ok(
      !/^RECRUIT_CONDITIONS_PATH=/m.test(content),
      `${name}이 아직 운영 조건 파일을 가리킵니다`
    );
  }
});
