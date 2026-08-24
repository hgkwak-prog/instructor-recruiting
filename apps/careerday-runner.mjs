#!/usr/bin/env node
/**
 * 커리어데이 자동 입력 러너. **호스트에서 돈다.**
 *
 * 봇은 컨테이너에 있어도 이 스크립트는 사람 컴퓨터에서 실행한다. 커리어데이는
 * 로그인 세션이 붙은 브라우저가 필요하고, 그 세션은 컨테이너 안에 없기 때문이다.
 *
 *   careerday-runner login            브라우저를 열어 로그인한다 (1회)
 *   careerday-runner fill <run-id>    승인된 건을 등록 화면에 채운다
 *   careerday-runner inspect          폼 구조를 뽑는다 (깨졌을 때 진단용)
 *
 * 최종 등록 버튼은 누르지 않는다. 채워진 화면을 사람이 보고 누른다.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { openDatabase, getRun, recordOutcome } from '../adapters/store/database.mjs';
import { fillCareerdayForm } from '../adapters/careerday/site-adapter.mjs';
import { buildCareerdayDraft, buildCareerdayFormPlan } from '../core/render/careerday.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDirectory = process.env.RECRUIT_DATA_DIR ?? join(projectRoot, 'data');

function requireCreateUrl() {
  const url = process.env.CAREERDAY_CREATE_URL?.trim();
  if (!url) throw new Error('CAREERDAY_CREATE_URL이 없습니다. .env에 등록 화면 주소를 넣으세요.');
  return url;
}

/**
 * 로그인 상태를 디스크에 남기는 영속 프로필로 띄운다.
 * 매번 로그인하게 만들면 아무도 안 쓴다.
 */
async function launchBrowser() {
  const profile = process.env.CAREERDAY_BROWSER_PROFILE
    ?? join(dataDirectory, 'careerday-browser');
  mkdirSync(profile, { recursive: true });
  return chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 1440, height: 1000 }
  });
}

async function withPage(handler) {
  const context = await launchBrowser();
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    return await handler(page, context);
  } finally {
    // 닫지 않는다. 사람이 화면을 보고 최종 등록을 눌러야 한다.
  }
}

async function login() {
  await withPage(async (page) => {
    await page.goto('https://www.careerday.jobs/', { waitUntil: 'domcontentloaded' });
    console.log('브라우저에서 로그인한 뒤 창을 닫으세요. 세션이 프로필에 남습니다.');
  });
}

async function inspect() {
  await withPage(async (page) => {
    await page.goto(requireCreateUrl(), { waitUntil: 'domcontentloaded' });
    const fields = await page
      .locator("input, select, textarea, [contenteditable='true']")
      .evaluateAll((elements) => elements.map((element) => ({
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute('type'),
        name: element.getAttribute('name'),
        placeholder: element.getAttribute('placeholder'),
        ariaLabel: element.getAttribute('aria-label'),
        contentEditable: element.getAttribute('contenteditable'),
        // 드롭다운은 선택지까지 남긴다. 보상 단위에 무엇이 있는지가
        // 폼 계획을 좌우하는데, 예전 inspect는 그걸 안 뽑아서 사람에게 물어야 했다.
        options: element.tagName === 'SELECT'
          ? [...element.options].map((option) => option.textContent.trim())
          : undefined
      })));

    const directory = join(projectRoot, 'docs');
    mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const jsonPath = join(directory, `careerday-form-${stamp}.json`);
    writeFileSync(jsonPath, `${JSON.stringify(fields, null, 2)}\n`);
    await page.screenshot({ path: join(directory, `careerday-form-${stamp}.png`), fullPage: true });
    console.log(`필드 ${fields.length}개 저장: ${jsonPath}`);
    console.log('이전 검증본과 diff 해서 무엇이 달라졌는지 보세요.');
  });
}

async function fill(runId) {
  if (!runId) throw new Error('사용법: careerday-runner fill <run-id>');

  const db = openDatabase(join(dataDirectory, 'recruitment.sqlite'));
  const run = getRun(db, runId);
  if (!run) throw new Error(`작업을 찾을 수 없습니다: ${runId}`);
  if (!run.job_post) throw new Error('승인된 공고 본문이 없습니다.');

  const draft = buildCareerdayDraft({
    runId,
    facts: JSON.parse(run.result_json ?? '{}').facts ?? {},
    jobPost: run.job_post,
    compensation: run.compensation_json ? JSON.parse(run.compensation_json) : null,
    publishingInput: run.publishing_input_json ? JSON.parse(run.publishing_input_json) : {}
  });
  const plan = buildCareerdayFormPlan(draft);

  console.log(`${plan.title}`);
  console.log(`  일정 ${plan.workStartDate} ~ ${plan.workEndDate} / 마감 ${plan.recruitmentDeadline}`);
  console.log(`  ${plan.region} · ${plan.headcount}명 · ${Number(plan.compensation.totalAmount).toLocaleString('ko-KR')}원\n`);

  await withPage(async (page) => {
    await page.goto(requireCreateUrl(), { waitUntil: 'domcontentloaded' });
    const { completed, pending, reward } = await fillCareerdayForm(page, plan);

    console.log(`채운 항목 ${completed.length}개`);
    for (const item of completed) console.log(`  ✓ ${item}`);
    if (reward) console.log(`  보상 표기: ${reward.count}${reward.unit}에 ${Number(plan.compensation.totalAmount).toLocaleString('ko-KR')}원`);
    console.log(`\n사람이 할 일 ${pending.length}개`);
    for (const item of pending) console.log(`  · ${item}`);

    // 등록 여부는 사람이 정한다. 여기서는 "폼까지 채웠다"만 남긴다.
    recordOutcome(db, { id: runId, careerdayPostedAt: new Date().toISOString() });
    console.log('\n창을 열어 둡니다. 확인 후 직접 등록하세요.');
  });
}

const [command, argument] = process.argv.slice(2);
const commands = { login, inspect, fill };

if (!commands[command]) {
  console.error([
    '사용법:',
    '  careerday-runner login            브라우저를 열어 로그인 (1회)',
    '  careerday-runner fill <run-id>    승인된 건을 등록 화면에 채움',
    '  careerday-runner inspect          폼 구조를 뽑음 (깨졌을 때 진단용)',
    '',
    '호스트에서 실행합니다. 컨테이너 안에는 로그인 세션이 없습니다.',
    '최종 등록 버튼은 누르지 않습니다.'
  ].join('\n'));
  process.exitCode = 2;
} else {
  commands[command](argument).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
