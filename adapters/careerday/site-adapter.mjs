/**
 * 커리어데이 등록 화면 자동 입력.
 *
 * 남의 사이트 DOM에 걸려 있는 코드다. 언제든 깨진다는 전제로 쓴다.
 *
 * - **최종 등록 버튼은 누르지 않는다.** 채우기까지만 하고 사람이 확인 후 누른다.
 * - 한 필드가 실패해도 나머지를 계속 채운다. 절반이라도 채워져 있으면
 *   사람이 마저 하면 되지만, 첫 실패에서 멈추면 처음부터 손으로 해야 한다.
 * - 넣은 값을 **읽어서 확인한다**. 채운 척하고 넘어가는 것이 가장 나쁘다.
 *
 * 마지막 화면 검증: 2026-08-24 (`docs/careerday-form-2026-08-24.json`).
 * 깨졌을 때는 `careerday:inspect`로 다시 뽑아 그 파일과 diff 한다.
 */

async function runStep({ label, completed, pending, action }) {
  try {
    const note = await action();
    completed.push(note ? `${label} (${note})` : label);
    return true;
  } catch (error) {
    pending.push(`${label}: ${error.message}`);
    return false;
  }
}

async function unique(locator, label) {
  const count = await locator.count();
  if (count !== 1) {
    throw new Error(`${label} 요소를 ${count === 0 ? '찾지 못함' : `${count}개 발견`}`);
  }
  return locator;
}

async function setInputValue(locator, value, label) {
  await unique(locator, label);
  if (await locator.isVisible()) {
    await locator.fill(String(value));
    await locator.press('Tab');
  } else {
    // 날짜 입력은 화면에 숨겨진 채 year/month/day 조각이 대신 보인다.
    // 그럴 때는 값을 직접 넣고 리액트가 듣는 이벤트를 손으로 쏜다.
    await locator.evaluate((element, nextValue) => {
      const prototype = element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, nextValue);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, String(value));
  }

  const actual = await locator.inputValue();
  if (actual.replaceAll(',', '') !== String(value).replaceAll(',', '')) {
    throw new Error(`입력값 검증 실패(${actual || '빈 값'})`);
  }
}

async function selectByLabel(locator, optionLabel, fieldLabel) {
  await unique(locator, fieldLabel);
  await locator.selectOption({ label: optionLabel });
  const selected = await locator.locator('option:checked').textContent();
  if (selected?.trim() !== optionLabel) throw new Error(`'${optionLabel}' 선택 검증 실패`);
}

async function setCheckbox(locator, checked, label) {
  await unique(locator, label);
  await locator.setChecked(checked);
  if ((await locator.isChecked()) !== checked) {
    throw new Error(`${checked ? '선택' : '해제'} 검증 실패`);
  }
}

async function fillRegion(page, region) {
  const input = await unique(page.getByPlaceholder('근무 지역을 선택해주세요.'), '업무 지역');
  await input.fill(region);
  const option = page.getByRole('option', { name: region, exact: true });
  await unique(option, `업무 지역 '${region}' 선택지`);
  await option.click();
  if (!(await input.inputValue()).includes(region)) {
    throw new Error(`'${region}' 선택 검증 실패`);
  }
}

async function fillTags(page, tags) {
  const input = await unique(page.getByPlaceholder('커스텀 태그를 입력하세요...'), '커스텀 태그');
  for (const tag of tags) {
    const existing = page.getByRole('button', { name: tag, exact: true });
    if ((await existing.count()) === 1) await existing.click();
    else {
      await input.fill(tag);
      await input.press('Enter');
    }
  }
}

/**
 * 보상 단위를 고른다.
 *
 * 후보는 `{ unit, count }` 짝으로 온다. 단위만 갈아끼우고 숫자를 두면
 * 21시간이 21개월이 되기 때문이다. 실제 드롭다운에 있는 첫 후보를 골라
 * **어떤 짝을 썼는지 돌려준다** — 호출자가 그 count로 횟수를 채운다.
 */
export async function selectRewardUnit(page, candidates) {
  const select = await unique(page.locator('select[name="periodReward.type"]'), '보상 단위');
  const available = (await select.locator('option').allTextContents()).map((text) => text.trim());

  const chosen = candidates.find(({ unit }) => available.includes(unit));
  if (!chosen) {
    throw new Error(
      `쓸 수 있는 보상 단위가 없습니다. 원한 것: ${candidates.map((c) => c.unit).join(', ')} / `
      + `화면에 있는 것: ${available.join(', ')}`
    );
  }
  await select.selectOption({ label: chosen.unit });
  return chosen;
}

export async function fillCareerdayForm(page, plan) {
  const completed = [];
  const pending = [];
  const step = (label, action) => runStep({ label, completed, pending, action });

  await step('제목', () => setInputValue(page.locator('input[name="title"]'), plan.title, '제목'));

  await step('업무 내용', async () => {
    const editor = await unique(page.locator('[contenteditable="true"]'), '업무 내용 편집기');
    await editor.fill(plan.description);
  });

  await step('카테고리', () =>
    selectByLabel(page.locator('select[name="category"]'), plan.category, '카테고리'));

  await step('공고 마감일', () =>
    setInputValue(page.locator('input[name="date"]'), plan.recruitmentDeadline, '공고 마감일'));

  await step('예상 업무 시작일', () =>
    setInputValue(page.locator('input[name="daterange_from"]'), plan.workStartDate, '예상 업무 시작일'));

  await step('예상 업무 종료일', () =>
    setInputValue(page.locator('input[name="daterange_to"]'), plan.workEndDate, '예상 업무 종료일'));

  await step('모집 인원수', () =>
    setInputValue(page.locator('input[name="requiredHeadCount"]'), plan.headcount, '모집 인원수'));

  await step('업무 지역', () => fillRegion(page, plan.region));

  await step('보상 방식', () =>
    selectByLabel(page.locator('select[name="rewardType"]'), '기간별', '보상 방식'));

  // 단위를 먼저 정해야 횟수를 채울 수 있다. 짝으로 움직인다.
  let reward = { unit: plan.compensation.unit, count: plan.compensation.count };
  await step('보상 단위', async () => {
    const candidates = plan.compensation.unitCandidates?.length > 0
      ? plan.compensation.unitCandidates
      : [{ unit: plan.compensation.unit, count: Number(plan.compensation.count) }];
    reward = await selectRewardUnit(page, candidates);
    return reward.unit;
  });

  await step('보상 기간', () =>
    setInputValue(page.locator('input[name="periodReward.num"]'), reward.count, '보상 기간'));

  await step('보상금', () =>
    setInputValue(page.locator('input[name="periodReward.reward"]'), plan.compensation.totalAmount, '보상금'));

  await step('VAT', () =>
    setCheckbox(page.locator('input[name="vatIncluded"]'), plan.compensation.vatIncluded, 'VAT'));

  await step('태그', () => fillTags(page, plan.tags));

  // 사람이 확인해야 하는 것들. 자동으로 건드리지 않는다.
  if (plan.detailedAddress) {
    pending.push(`상세 주소는 '상세 주소 입력하기 (선택)'을 눌러 직접 입력: ${plan.detailedAddress}`);
  }
  pending.push('공개 여부와 NDA·이해상충·컴플라이언스 토글을 화면에서 확인');
  pending.push('최종 등록 버튼은 사람이 누릅니다');

  return { completed, pending, reward };
}
