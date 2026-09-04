import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, parseArgs } from '../apps/cli.mjs';
import { openDatabase, listRuns } from '../adapters/store/database.mjs';
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

test('생성이 끝나면 검토대기로 기록되고 리포트가 나온다', async () => {
  const { db, options, context } = workspace();
  const outcome = await generate(db, options, { ...context, extractor: fakeExtractor(baseResult()) });

  assert.equal(outcome.recorded, true);
  assert.equal(outcome.status, '검토대기');
  assert.ok(existsSync(outcome.reportPath));

  const runs = listRuns(db);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, outcome.runId);
  assert.equal(runs[0].status, 'review_pending');
});

test('검증에 실패한 생성은 DB에 들어가지 않는다', async () => {
  // 이 레포의 핵심 불변식이다. DB에 없으면 승인 대상이 될 수 없다.
  // 리포트는 남겨야 한다 — 무엇이 왜 막혔는지 사람이 봐야 하기 때문이다.
  const broken = baseResult();
  broken.facts.totalHours.value = 999; // 시수 합계가 회차·시간과 안 맞는다

  const { db, options, context } = workspace();
  const previousExitCode = process.exitCode;
  const outcome = await generate(db, options, { ...context, extractor: fakeExtractor(broken) });
  process.exitCode = previousExitCode;

  assert.equal(outcome.recorded, false);
  assert.ok(outcome.errors.length > 0);
  assert.ok(existsSync(outcome.reportPath), '실패해도 검토 리포트는 남아야 합니다');
  assert.deepEqual(listRuns(db), []);
});

test('run 디렉터리에 결과와 검증 로그를 남긴다', async () => {
  const { db, options, context, dataDirectory } = workspace();
  const outcome = await generate(db, options, { ...context, extractor: fakeExtractor(baseResult()) });

  const runDirectory = join(dataDirectory, 'runs', outcome.runId);
  for (const name of ['prompt.txt', 'result.json', 'verification.json']) {
    assert.ok(existsSync(join(runDirectory, name)), `${name}이 없습니다`);
  }
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

test('운영사항이 없으면 공고가 승인 가능해지지 않는다', async () => {
  // 장소도 지원 방법도 모르는 공고를 내보낼 수는 없다.
  const bare = baseResult();
  for (const key of ['location', 'applicationMethod']) {
    bare.facts[key] = { value: null, evidence: null };
  }
  const { db, options, context } = workspace();
  const outcome = await generate(
    db, { source: options.source }, { ...context, extractor: fakeExtractor(bare) }
  );
  assert.equal(outcome.postable, false);
  assert.ok(outcome.pending.length > 0, '[확인 필요]가 남아야 합니다');
});

test('모델에게 보낸 프롬프트와 스키마가 추출기에 그대로 전달된다', async () => {
  const { db, options, context } = workspace();
  const extractor = fakeExtractor(baseResult());
  await generate(db, { ...options, model: 'claude-opus-5' }, { ...context, extractor });

  const [call] = extractor.calls;
  assert.equal(call.model, 'claude-opus-5');
  assert.match(call.prompt, /## Rules/, 'SKILL.md 규칙이 프롬프트에 들어가야 합니다');
  assert.ok(call.budget, '일일 상한이 연결돼야 합니다');
});
