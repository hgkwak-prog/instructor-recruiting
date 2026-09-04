#!/usr/bin/env node
/**
 * 운영자용 CLI.
 *
 * 지금 하는 일은 **커리큘럼 → 검토 리포트 + 검토대기 기록**까지다.
 * 승인부터 그 뒤(게시·현황 확인·성과 기록)는 Slack이 맡는다(P3).
 *
 * 승인 명령을 여기에 두지 않는 것은 빠뜨려서가 아니다. 공개 승인 지점이 둘이 되면
 * 같은 행의 상태를 두 곳에서 바꾸게 되고, 그 경합은 나중에 재현하기 어려운 버그가 된다.
 * 승인은 Slack 버튼 하나로 간다(설계서 §6.4).
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  openDatabase, createRun, getRun, listRuns, savePublishingInput, STATUS, STATUS_LABELS
} from '../adapters/store/database.mjs';
import { readSourceAsync, readJson } from '../adapters/documents/files.mjs';
import { buildPrompt, writePromptFile } from '../adapters/llm/prompt.mjs';
import { createExtractor, DEFAULT_MODEL } from '../adapters/llm/claude-agent.mjs';
import { renderJobPost, pendingMarkers } from '../core/render/job-post.mjs';
import { applyConditions } from '../core/conditions.mjs';
import { buildCareerdayDraft, buildCareerdayFormPlan } from '../core/render/careerday.mjs';
import { DATA_SUBDIRS, ensureDataDirectories } from '../core/paths.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const dataDirectory = join(projectRoot, 'data');
const databasePath = join(dataDirectory, 'recruitment.sqlite');
const schemaPath = join(projectRoot, 'schemas', 'recruitment-result.schema.json');

/** P3에서 Slack으로 옮겨갈 명령들. "모르는 명령"으로 처리하면 사용자가 오타를 의심한다. */
const MOVED_TO_SLACK = {
  approve: '승인',
  reject: '반려',
  'mark-complete': '게시 완료 기록',
  outcome: '성과 기록',
  'due-reminders': '현황 확인 알림'
};

export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = rest[index + 1];
    options[key] = next && !next.startsWith('--') ? next : true;
    if (options[key] !== true) index += 1;
  }
  return { command, options };
}

function help() {
  console.log([
    '사용법:',
    '  recruit init',
    '  recruit generate --source <파일> [--conditions <json>] [--dry-run] [--model <id>]',
    '  recruit list [--status review_pending]',
    '  recruit show --run-id <id>',
    '  recruit careerday-prepare --run-id <id> --deadline <YYYY-MM-DD> [--address <text>]',
    '',
    '  --dry-run     모델을 부르지 않고 실제로 보낼 프롬프트만 남깁니다.',
    '                SKILL.md 규칙을 고친 뒤 무엇이 주입되는지 확인할 때.',
    '  --conditions  생략하면 추출만 합니다. 커리큘럼만으로 모델이 무엇을 뽑는지',
    '                볼 때 쓰세요. 공고에는 [확인 필요]가 남을 수 있습니다.',
    '',
    '승인부터는 Slack에서 합니다 (P3에서 붙습니다).',
    '',
    '인증: 정액제 구독입니다. `claude setup-token`으로 발급한 토큰을',
    'CLAUDE_CODE_OAUTH_TOKEN에 넣으세요. ANTHROPIC_API_KEY가 설정돼 있으면 중단됩니다.'
  ].join('\n'));
}

/**
 * `context`는 테스트 이음새다. 기본값이 운영 경로이고, 테스트는 임시 디렉터리와
 * 가짜 추출기를 넣어 **모델을 부르지 않고** 파이프라인 전체를 돌린다.
 *
 * 검산기가 없으므로 생성된 결과는 항상 검토대기로 기록된다 — 승인 여부는
 * 사람이 눈으로 보고 정한다.
 */
export async function generate(db, options, context = {}) {
  const {
    dataDirectory: dataDir = dataDirectory,
    projectRoot: root = projectRoot,
    schemaPath: schemaFile = schemaPath,
    extractor: injectedExtractor = null,
    log = console.log,
    warn = console.error
  } = context;

  if (!options.source) throw new Error('--source가 필요합니다.');
  const sourcePath = resolve(options.source);
  const curriculum = await readSourceAsync(sourcePath);

  // `--conditions`는 선택이다.
  //
  // 없으면 **순수 추출**이 된다 — 커리큘럼만으로 모델이 무엇을 뽑아내는지 그대로
  // 보인다. 흐름을 검수할 때는 이쪽이 낫다. 있지도 않은 운영값을 지어내 넣으면
  // 관찰하려는 것을 오염시키기 때문이다.
  //
  // 그 대신 공고에는 `[확인 필요]`가 남을 수 있다. 장소도 지원 방법도 모르는
  // 채로 남을 수 있다는 뜻이고, 승인 여부는 사람이 보고 정한다.
  const conditions = options.conditions ? await readJson(resolve(options.conditions)) : {};
  const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));

  const runId = randomUUID();
  const runDirectory = join(dataDir, 'runs', runId);
  const prompt = buildPrompt({ projectRoot: root, curriculum, conditions, schema });
  const promptPath = writePromptFile({ prompt, runDirectory });

  if (options['dry-run']) {
    // 모델을 부르지 않는다. 이 run은 DB에도 들어가지 않는다.
    log(JSON.stringify({
      runId, dryRun: true, promptPath, promptBytes: Buffer.byteLength(prompt)
    }, null, 2));
    return { runId, dryRun: true, promptPath };
  }

  const model = typeof options.model === 'string' ? options.model : DEFAULT_MODEL;
  const extractor = injectedExtractor ?? await createExtractor();
  warn(`모델 ${model} 호출 (인증: ${extractor.auth.credential})`);
  if (!options.conditions) {
    warn('운영사항 없이 추출만 합니다. 공고에는 [확인 필요]가 남을 수 있습니다.');
  }

  const { result, attempts, usages } = await extractor.extract({ prompt, schema, model });

  // 운영 조건은 담당자의 선언이다. 모델이 비워 둔 항목은 코드가 채운다.
  // 봇의 모달과 같은 의미다 — 실행할 때 사람이 명시적으로 준 값이므로
  // 커리큘럼을 이긴다. 여기가 봇과 다르면 CLI로 한 검수를 믿을 수 없다.
  const applied = applyConditions(result.facts, conditions, { override: true });
  result.facts = applied.facts;
  if (applied.filled.length > 0) {
    warn(`운영 조건에서 채운 항목: ${applied.filled.join(', ')}`);
  }
  for (const { key, from, to } of applied.overridden) {
    warn(`덮어씀 ${key}: 원문 "${from}" → 입력 "${to}"`);
  }

  // 공고 본문은 여기서 사실로부터 조립된다. 모델은 본문을 쓴 적이 없다.
  const jobPost = renderJobPost(result.facts);
  const pending = pendingMarkers(jobPost);
  const generatedAt = new Date().toISOString();

  createRun(db, {
    id: runId,
    sourcePath,
    courseTitle: result.facts.courseTitle.value,
    role: result.facts.role.value,
    result,
    jobPost,
    generatedAt
  });

  const summary = {
    runId,
    status: STATUS_LABELS[STATUS.REVIEW_PENDING],
    model,
    attempts,
    pending,
    warnings: result.warnings ?? [],
    // 청구액이 아니라 토큰 소비량의 대리 지표다 (README 참고).
    estimatedCostUsd: usages.reduce((sum, usage) => sum + (usage.estimatedCostUsd ?? 0), 0)
  };
  log(JSON.stringify(summary, null, 2));
  return { ...summary, recorded: true };
}

/**
 * 커리어데이 준비. 원래 슬랙 리마인더 안에서만 노출되던 진입점이다 —
 * 리마인더를 없애면서 CLI 명령으로 옮겼다(v1 확정 결정).
 *
 * bot.mjs의 CAREERDAY_MODAL 뷰 핸들러가 하던 것과 동일하게 동작한다.
 */
export async function careerdayPrepare(db, options, context = {}) {
  const { log = console.log } = context;
  if (!options['run-id']) throw new Error('--run-id가 필요합니다.');
  if (!options.deadline) throw new Error('--deadline이 필요합니다 (YYYY-MM-DD).');

  const runId = options['run-id'];
  const deadline = options.deadline;
  const venueAddress = typeof options.address === 'string' ? options.address : null;

  savePublishingInput(db, { id: runId, publishingInput: { deadline, venueAddress } });
  const run = getRun(db, runId);
  if (!run) throw new Error(`작업을 찾을 수 없습니다: ${runId}`);

  const draft = buildCareerdayDraft({
    runId: run.id,
    facts: JSON.parse(run.result_json ?? '{}').facts ?? {},
    jobPost: run.job_post,
    compensation: run.compensation_json ? JSON.parse(run.compensation_json) : null,
    publishingInput: { deadline, venueAddress }
  });
  const plan = buildCareerdayFormPlan(draft);

  const amount = Number(plan.compensation.totalAmount).toLocaleString('ko-KR');
  log([
    `커리어데이 준비 완료 (${run.id.slice(0, 8)})`,
    plan.title,
    `일정 ${plan.workStartDate} ~ ${plan.workEndDate} / 마감 ${plan.recruitmentDeadline}`,
    `${plan.region} · ${plan.headcount}명 · ${plan.compensation.count}${plan.compensation.unit}에 ${amount}원`,
    '',
    `아래를 실행하면 등록 화면이 열리고 자동으로 채워집니다:`,
    `  npm run careerday -- fill ${run.id}`
  ].join('\n'));
  return { runId: run.id, plan };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === 'help' || options.help) return help();

  if (MOVED_TO_SLACK[command]) {
    console.error(
      `\`${command}\`(${MOVED_TO_SLACK[command]})는 CLI에 없습니다. Slack에서 합니다 (P3에서 붙습니다).\n`
      + '공개 승인 지점을 하나로 두기 위한 결정입니다 — 두 곳에서 같은 상태를 바꾸면 경합이 납니다.'
    );
    process.exitCode = 2;
    return;
  }

  ensureDataDirectories(dataDirectory);
  if (command === 'init') {
    console.log(`초기화 완료: ${dataDirectory}`);
    console.log(`  ${DATA_SUBDIRS.join(', ')}`);
    return;
  }

  const db = openDatabase(databasePath);

  if (command === 'generate') return generate(db, options);

  if (command === 'careerday-prepare') return careerdayPrepare(db, options);

  if (command === 'list') {
    const runs = listRuns(db, typeof options.status === 'string' ? options.status : null);
    console.log(JSON.stringify(runs.map((run) => ({
      runId: run.id,
      status: STATUS_LABELS[run.status] ?? run.status,
      role: run.role,
      courseTitle: run.course_title,
      generatedAt: run.generated_at
    })), null, 2));
    return;
  }

  if (command === 'show') {
    if (!options['run-id']) throw new Error('--run-id가 필요합니다.');
    const run = getRun(db, options['run-id']);
    if (!run) throw new Error(`작업을 찾을 수 없습니다: ${options['run-id']}`);
    console.log(`[${STATUS_LABELS[run.status] ?? run.status}] ${run.course_title ?? '(제목 미확인)'} / ${run.role ?? '역할 미확인'}`);
    console.log('─'.repeat(60));
    console.log(run.job_post);
    return;
  }

  console.error(`모르는 명령입니다: ${command}`);
  help();
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
