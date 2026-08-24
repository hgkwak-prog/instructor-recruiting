/**
 * P1 완료 기준: **CLI판과 SDK판이 같은 커리큘럼에서 같은 facts를 내는가.**
 *
 * 프롬프트는 prompt.mjs가 한 번만 조립해 양쪽에 같은 글자를 먹인다.
 * 다른 것은 호출 방식뿐이므로, 차이가 나면 그건 전환이 만든 차이다.
 *
 * 모델 출력에는 원래 흔들림이 있다. 같은 경로를 두 번 불러도 문장이 달라질 수 있다.
 * 그래서 두 층으로 본다.
 *   - **구조**: 어떤 키가 확정(non-null)됐고 어떤 키가 비었나 → 여기가 다르면 전환 실패
 *   - **값**:   확정된 값이 실제로 같은가 → 다르면 사람이 읽고 판단
 *
 * 사용법:
 *   node scripts/compare-extractors.mjs --source ./examples/curriculum.txt \
 *                                       [--conditions ./examples/operating-conditions.json] \
 *                                       [--model claude-sonnet-5]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt, writePromptFile } from '../adapters/llm/prompt.mjs';
import { assertSubscriptionAuth } from '../adapters/llm/guards.mjs';
import { extractFacts } from '../adapters/llm/claude-agent.mjs';
import { runClaude } from '../adapters/llm/claude-cli.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (key) options[key] = argv[i + 1];
  }
  return options;
}

/** 확정된 키만 모은다. `{ value, evidence }` 래핑을 벗겨 비교 가능한 모양으로. */
function shapeOf(facts) {
  const shape = {};
  for (const [key, entry] of Object.entries(facts ?? {})) {
    const value = entry?.value;
    const empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
    shape[key] = empty ? 'empty' : 'set';
  }
  return shape;
}

function diffShapes(left, right) {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys
    .filter((key) => left[key] !== right[key])
    .map((key) => ({ key, cli: left[key] ?? '없음', sdk: right[key] ?? '없음' }));
}

function diffValues(leftFacts, rightFacts) {
  const keys = [...new Set([...Object.keys(leftFacts ?? {}), ...Object.keys(rightFacts ?? {})])].sort();
  const differences = [];
  for (const key of keys) {
    const cli = JSON.stringify(leftFacts?.[key]?.value ?? null);
    const sdk = JSON.stringify(rightFacts?.[key]?.value ?? null);
    if (cli !== sdk) differences.push({ key, cli, sdk });
  }
  return differences;
}

function preview(text, limit = 160) {
  const flat = String(text).replace(/\s+/g, ' ');
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

const options = parseArgs(process.argv.slice(2));
if (!options.source) {
  console.error('사용법: node scripts/compare-extractors.mjs --source <커리큘럼 파일> [--conditions <파일>] [--model <모델>]');
  process.exit(2);
}

assertSubscriptionAuth();

const schemaPath = join(projectRoot, 'schemas', 'recruitment-result.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const curriculum = readFileSync(resolve(options.source), 'utf8');
const conditions = options.conditions ? JSON.parse(readFileSync(resolve(options.conditions), 'utf8')) : {};

// 프롬프트는 한 번만 만든다. 양쪽이 같은 글자를 받는 것이 이 비교의 전제다.
const prompt = buildPrompt({ projectRoot, curriculum, conditions, schema });
const runDirectory = join(projectRoot, 'data', 'runs', `compare-${Date.now()}`);
const promptPath = writePromptFile({ prompt, runDirectory });
console.log(`프롬프트: ${promptPath} (${prompt.length}자)\n`);

console.log('[1/2] CLI판 호출…');
const cli = runClaude({ schemaPath, promptPath, model: options.model });
console.log(`  시도 ${cli.attempts}회\n`);

console.log('[2/2] SDK판 호출…');
const { query } = await import('@anthropic-ai/claude-agent-sdk');
const sdk = await extractFacts({ prompt, schema, query, model: options.model });
const cost = sdk.usages.reduce((sum, usage) => sum + (usage.costUsd ?? 0), 0);
console.log(`  시도 ${sdk.attempts}회, 비용 추정 $${cost.toFixed(4)}\n`);

writeFileSync(join(runDirectory, 'cli.json'), JSON.stringify(cli.result, null, 2));
writeFileSync(join(runDirectory, 'sdk.json'), JSON.stringify(sdk.result, null, 2));

const shapeDiff = diffShapes(shapeOf(cli.result.facts), shapeOf(sdk.result.facts));
const valueDiff = diffValues(cli.result.facts, sdk.result.facts);

console.log('='.repeat(70));
if (shapeDiff.length === 0) {
  console.log('구조 동일 — 확정된 키와 빈 키가 양쪽에서 같습니다.');
} else {
  console.log(`구조 차이 ${shapeDiff.length}건 — 전환이 추출 능력을 바꿨습니다:`);
  for (const { key, cli: a, sdk: b } of shapeDiff) console.log(`  ${key}: CLI=${a} / SDK=${b}`);
}

console.log('-'.repeat(70));
if (valueDiff.length === 0) {
  console.log('값도 완전히 동일합니다.');
} else {
  console.log(`값 차이 ${valueDiff.length}건 (모델 흔들림일 수 있으니 읽고 판단하세요):`);
  for (const { key, cli: a, sdk: b } of valueDiff) {
    console.log(`  ${key}`);
    console.log(`    CLI: ${preview(a)}`);
    console.log(`    SDK: ${preview(b)}`);
  }
}
console.log('='.repeat(70));
console.log(`전문: ${runDirectory}/{cli,sdk}.json`);

// 구조가 어긋나면 실패로 본다. 값 차이는 사람이 판단한다.
process.exit(shapeDiff.length === 0 ? 0 : 1);
