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
import { writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, createRun, getRun, listRuns, STATUS, STATUS_LABELS } from '../adapters/store/database.mjs';
import { readSource, readJson } from '../adapters/documents/files.mjs';
import { buildPrompt, writePromptFile } from '../adapters/llm/prompt.mjs';
import { createExtractor, DEFAULT_MODEL } from '../adapters/llm/claude-agent.mjs';
import { CallBudget, createSerialQueue } from '../adapters/llm/guards.mjs';
import { verifyResult } from '../core/verify.mjs';
import { applyConditions } from '../core/conditions.mjs';
import { buildReport } from '../core/report.mjs';
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
  'due-reminders': '현황 확인 알림',
  sync: '시트 동기화'
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
    '  recruit generate --source <파일> --conditions <json> [--dry-run] [--model <id>]',
    '  recruit list [--status review_pending]',
    '  recruit show --run-id <id>',
    '',
    '  --dry-run 은 모델을 부르지 않고 실제로 보낼 프롬프트만 남깁니다.',
    '  SKILL.md 규칙을 고친 뒤 무엇이 주입되는지 확인할 때 쓰세요.',
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
 * 여기서 지켜야 할 불변식이 하나 있다 — 검증에 실패한 생성은 DB에 들어가지 않는다.
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

  if (!options.source || !options.conditions) {
    throw new Error('--source와 --conditions가 필요합니다.');
  }
  const sourcePath = resolve(options.source);
  const curriculum = readSource(sourcePath);
  const conditions = readJson(resolve(options.conditions));
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
  const budget = new CallBudget({
    path: join(dataDir, 'call-budget.json'),
    limit: Number(process.env.RECRUIT_DAILY_CALL_LIMIT ?? 30)
  });
  const extractor = injectedExtractor ?? await createExtractor({ queue: createSerialQueue() });
  warn(`모델 ${model} 호출 (인증: ${extractor.auth.credential}, 오늘 남은 호출 ${budget.remaining()}건)`);

  const { result, attempts, usages } = await extractor.extract({ prompt, schema, model, budget });

  // 운영 조건은 담당자의 선언이다. 모델이 비워 둔 항목은 코드가 채운다.
  const applied = applyConditions(result.facts, conditions);
  result.facts = applied.facts;
  if (applied.filled.length > 0) {
    warn(`운영 조건에서 채운 항목: ${applied.filled.join(', ')}`);
  }

  // 공고 본문은 여기서 사실로부터 조립된다. 모델은 본문을 쓴 적이 없다.
  const verification = verifyResult({ result, conditions });
  const generatedAt = new Date().toISOString();
  const reportPath = join(dataDir, 'reports', `${runId}.html`);

  writeFileSync(join(runDirectory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(runDirectory, 'verification.json'), `${JSON.stringify(verification, null, 2)}\n`);
  writeFileSync(reportPath, buildReport({ runId, result, verification, generatedAt, sourcePath }));

  if (verification.errors.length > 0) {
    // 검증에 실패한 생성은 어떤 상태도 갖지 않는다. DB에 없으므로 승인 대상이 될 수 없다.
    warn(`검증 실패로 기록하지 않았습니다 (run ${runId})`);
    for (const error of verification.errors) warn(`  - ${error}`);
    warn(`검토 리포트: ${reportPath}`);
    process.exitCode = 1;
    return { runId, recorded: false, errors: verification.errors, reportPath };
  }

  createRun(db, {
    id: runId,
    sourcePath,
    courseTitle: result.facts.courseTitle.value,
    role: result.facts.role.value,
    result,
    jobPost: verification.slackJobPost,
    postable: verification.postable,
    generatedAt
  });

  const summary = {
    runId,
    status: STATUS_LABELS[STATUS.REVIEW_PENDING],
    model,
    attempts,
    postable: verification.postable,
    pending: verification.pendingMarkers,
    warnings: [...verification.warnings, ...(result.warnings ?? [])],
    // 청구액이 아니라 토큰 소비량의 대리 지표다 (README 참고).
    estimatedCostUsd: usages.reduce((sum, usage) => sum + (usage.estimatedCostUsd ?? 0), 0),
    reportPath
  };
  log(JSON.stringify(summary, null, 2));
  log(`\n검토 리포트를 브라우저로 여세요:\n  open ${reportPath}`);
  return { ...summary, recorded: true };
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

  if (command === 'list') {
    const runs = listRuns(db, typeof options.status === 'string' ? options.status : null);
    console.log(JSON.stringify(runs.map((run) => ({
      runId: run.id,
      status: STATUS_LABELS[run.status] ?? run.status,
      role: run.role,
      courseTitle: run.course_title,
      postable: Boolean(run.postable),
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
