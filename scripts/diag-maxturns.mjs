#!/usr/bin/env node
/**
 * 진단 전용 스크립트. HANDOFF.md의 진단 절차:
 * maxTurns만 올려서 같은 프롬프트를 보내고 num_turns/stop_reason을 본다.
 * 커밋하지 않는다 — 진단 후 삭제.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildPrompt, stripMetaSchema } from '../adapters/llm/prompt.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const schema = JSON.parse(readFileSync(join(projectRoot, 'schemas/recruitment-result.schema.json'), 'utf8'));
const curriculum = readFileSync(join(projectRoot, 'examples/curriculum.txt'), 'utf8');
const conditions = JSON.parse(readFileSync(join(projectRoot, 'examples/operating-conditions.json'), 'utf8'));

const prompt = buildPrompt({ projectRoot, curriculum, conditions, schema });

const SYSTEM_PROMPT = [
  '당신은 강사 구인 운영 담당자입니다.',
  '주어진 커리큘럼과 운영 조건만을 근거로 사실을 추출합니다.',
  '공고 본문은 작성하지 않습니다. 본문은 코드가 조립합니다.',
  '근거가 없는 값은 null로 두세요. 상식이나 추론으로 채우지 마세요.'
].join('\n');

const maxTurns = Number(process.argv[2] || 4);
const model = process.env.RECRUIT_MODEL || 'claude-sonnet-5';

const options = {
  allowedTools: [],
  permissionMode: 'dontAsk',
  maxTurns,
  settingSources: [],
  model,
  systemPrompt: SYSTEM_PROMPT,
  outputFormat: { type: 'json_schema', schema: stripMetaSchema(schema) }
};

console.error(`[diag] model=${model} maxTurns=${maxTurns} promptBytes=${Buffer.byteLength(prompt)} schemaBytes=${Buffer.byteLength(JSON.stringify(schema))}`);
console.error(`[diag] auth: CLAUDE_CODE_OAUTH_TOKEN present=${Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN)} ANTHROPIC_API_KEY present=${Boolean(process.env.ANTHROPIC_API_KEY)}`);

let count = 0;
try {
  for await (const message of query({ prompt, options })) {
    count += 1;
    const { type, subtype, num_turns, stop_reason, is_error, total_cost_usd } = message;
    console.error(`[diag #${count}] type=${type} subtype=${subtype} num_turns=${num_turns} stop_reason=${stop_reason} is_error=${is_error} cost=${total_cost_usd}`);
    if (type === 'assistant' || type === 'user') {
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text') console.error(`  text(${block.text.length} chars): ${block.text.slice(0, 200)}`);
          if (block.type === 'tool_use') console.error(`  tool_use: ${block.name}`);
          if (block.type === 'tool_result') console.error(`  tool_result: ${JSON.stringify(block).slice(0, 200)}`);
        }
      }
    }
    if (type === 'result') {
      console.error('[diag] result keys:', Object.keys(message));
      console.error('[diag] structured_output present:', message.structured_output !== undefined && message.structured_output !== null);
      if (message.structured_output) {
        console.error('[diag] structured_output keys:', Object.keys(message.structured_output));
      }
      if (message.result) {
        console.error(`[diag] message.result (${String(message.result).length} chars): ${String(message.result).slice(0, 500)}`);
      }
    }
  }
  console.error(`[diag] done. total messages=${count}`);
} catch (error) {
  console.error('[diag] threw:', error);
}
