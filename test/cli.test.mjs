import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { careerdayPrepare, generate, parseArgs } from '../apps/cli.mjs';
import { openDatabase, listRuns, getRun, updateDraft } from '../adapters/store/database.mjs';
import { ensureDataDirectories } from '../core/paths.mjs';
import { baseResult } from './fixtures.mjs';

const projectRoot = join(import.meta.dirname, '..');
const schemaPath = join(projectRoot, 'schemas', 'recruitment-result.schema.json');

/** 모델을 부르지 않는 추출기. 정해둔 결과를 그대로 돌려준다. */
function fakeExtractor(result, { attempts = 1 } = {}) {
  const calls = [];
  return {
    auth: { credential: 'oauth-token' },
    calls,
    async extract(options) {
      calls.push(options);
      return { result: structuredClone(result), attempts, usages: [{ estimatedCostUsd: 0.19 }] };
    }
  };
}

function workspace() {
  const dataDirectory = join(mkdtempSync(join(tmpdir(), 'cli-')), 'data');
  ensureDataDirectories(dataDirectory);
  const sourcePath = join(dataDirectory, 'curriculum.txt');
  writeFileSync(sourcePath, 'AI 코딩 기초 교육 커리큘럼');
  const conditionsPath = join(dataDirectory, 'conditions.json');
  writeFileSync(conditionsPath, JSON.stringify({
    instructorRole: '보조강사',
    customerDisclosure: 'hidden',
    location: '서울시 내 교육장',
    headcount: 1,
    applicationMethod: 'edu-recruit@example.com으로 이력서 회신'
  }));
  const db = openDatabase(join(dataDirectory, 'recruitment.sqlite'));
  const silent = () => {};
  return {
    db,
    dataDirectory,
    options: { source: sourcePath, conditions: conditionsPath },
    context: { db, dataDirectory, projectRoot, schemaPath, log: silent, warn: silent }
  };
}

test('인자 파싱 — 값 있는 플래그와 불리언 플래그를 구분한다', () => {
  const { command, options } = parseArgs(['generate', '--source', 'a.txt', '--dry-run', '--model', 'x']);
  assert.equal(command, 'generate');
  assert.equal(options.source, 'a.txt');
  assert.equal(options['dry-run'], true);
  assert.equal(options.model, 'x');
});

test('명령을 안 주면 help다', () => {
  assert.equal(parseArgs([]).command, 'help');
});

test('--dry-run은 모델을 부르지 않고 프롬프트만 남긴다', async () => {
  const { db, options, context } = workspace();
  const extractor = fakeExtractor(baseResult());

  const outcome = await generate(db, { ...options, 'dry-run': true }, { ...context, extractor });

  assert.equal(outcome.dryRun, true);
  assert.equal(extractor.calls.length, 0, 'dry-run이 모델을 부르면 SKILL.md 확인용으로 못 씁니다');
  assert.ok(existsSync(outcome.promptPath));
  assert.match(readFileSync(outcome.promptPath, 'utf8'), /AI 코딩 기초 교육 커리큘럼/);
  assert.deepEqual(listRuns(db), [], 'dry-run은 DB에 들어가면 안 됩니다');
});

test('생성이 끝나면 검토대기로 기록된다', async () => {
  const { db, options, context } = workspace();
  const outcome = await generate(db, options, { ...context, extractor: fakeExtractor(baseResult()) });

  assert.equal(outcome.recorded, true);
  assert.equal(outcome.status, '검토대기');

  const runs = listRuns(db);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, outcome.runId);
  assert.equal(runs[0].status, 'review_pending');
});

test('생성이 끝나면 프롬프트를 run 디렉터리에 남긴다', async () => {
  const { db, options, context, dataDirectory } = workspace();
  const outcome = await generate(db, options, { ...context, extractor: fakeExtractor(baseResult()) });

  const runDirectory = join(dataDirectory, 'runs', outcome.runId);
  assert.ok(existsSync(join(runDirectory, 'prompt.txt')), 'prompt.txt가 없습니다');
});

test('--source가 없으면 거부한다', async () => {
  const { db, context } = workspace();
  await assert.rejects(generate(db, {}, context), /--source가 필요합니다/);
});

test('--conditions 없이도 돈다 — 추출만 보고 싶을 때가 있다', async () => {
  // 흐름을 검수할 때는 오히려 이쪽이 낫다. 있지도 않은 운영값을 지어내 넣으면
  // 관찰하려는 것을 오염시킨다.
  const { db, options, context } = workspace();
  const extractor = fakeExtractor(baseResult());

  const outcome = await generate(db, { source: options.source }, { ...context, extractor });

  assert.equal(extractor.calls.length, 1, '모델은 정상적으로 부릅니다');
  assert.match(extractor.calls[0].prompt, /\[운영 조건\][\s\S]*\{\}/, '빈 조건이 프롬프트에 들어갑니다');
  assert.ok(outcome.runId);
});

test('운영사항이 없으면 공고에 확인 필요 항목이 남는다', async () => {
  // 장소도 지원 방법도 모르는 채로 남을 수 있다는 뜻이고, 승인 여부는 사람이 본다.
  const bare = baseResult();
  for (const key of ['location', 'applicationMethod']) {
    bare.facts[key] = { value: null, evidence: null };
  }
  const { db, options, context } = workspace();
  const outcome = await generate(
    db, { source: options.source }, { ...context, extractor: fakeExtractor(bare) }
  );
  assert.ok(outcome.pending.length > 0, '[확인 필요]가 남아야 합니다');
  assert.equal(outcome.recorded, true, '확인 필요 항목이 있어도 검토대기로 기록됩니다');
});

test('모델에게 보낸 프롬프트와 스키마가 추출기에 그대로 전달된다', async () => {
  const { db, options, context } = workspace();
  const extractor = fakeExtractor(baseResult());
  await generate(db, { ...options, model: 'claude-opus-5' }, { ...context, extractor });

  const [call] = extractor.calls;
  assert.equal(call.model, 'claude-opus-5');
  assert.match(call.prompt, /## Rules/, 'SKILL.md 규칙이 프롬프트에 들어가야 합니다');
});

// --- 커리어데이 준비 (v1: 슬랙 리마인더 대신 CLI 명령) -----------------------------

test('careerday-prepare는 담당자 입력을 저장하고 폼 값을 계산한다', async () => {
  const { db, options, context } = workspace();
  const generated = await generate(db, options, { ...context, extractor: fakeExtractor(baseResult()) });
  // 보상금은 슬랙 편집 모달 단계에서 이미 확정돼 있어야 폼이 채워진다.
  updateDraft(db, {
    id: generated.runId,
    jobPost: getRun(db, generated.runId).job_post,
    compensation: { mode: 'total', amount: 1_000_000, total: 1_000_000, hourlyRate: null, line: '강사료 : 총 1,000,000원' }
  });

  const outcome = await careerdayPrepare(db, {
    'run-id': generated.runId,
    deadline: '2026-08-20',
    address: '서울시 강남구 테헤란로 123'
  }, context);

  assert.equal(outcome.runId, generated.runId);
  assert.ok(outcome.plan.title);
  const run = getRun(db, generated.runId);
  const publishingInput = JSON.parse(run.publishing_input_json);
  assert.equal(publishingInput.deadline, '2026-08-20');
  assert.equal(publishingInput.venueAddress, '서울시 강남구 테헤란로 123');
});

test('careerday-prepare는 --run-id와 --deadline을 요구한다', async () => {
  const { db, context } = workspace();
  await assert.rejects(careerdayPrepare(db, {}, context), /--run-id가 필요합니다/);
  await assert.rejects(careerdayPrepare(db, { 'run-id': 'x' }, context), /--deadline이 필요합니다/);
});
