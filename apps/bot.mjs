#!/usr/bin/env node
/**
 * Slack 상주 봇.
 *
 *   DM에 커리큘럼 파일 → 사실 추출 → 공고 조립 → 검토 미리보기
 *                                                → [승인] → 채널 게시
 *
 * 승인은 여기 버튼 하나뿐이다. CLI에는 승인 명령이 없다(설계서 §6.4).
 * 그리고 버튼은 권한이지 우회가 아니다 — `[확인 필요]`가 남은 초안은
 * 버튼을 눌러도 `reviewRun`이 거부한다.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, LogLevel, SocketModeReceiver } from '@slack/bolt';

import { openDatabase, createRun, getRun, reviewRun, completeRun, STATUS } from '../adapters/store/database.mjs';
import { readSlackFile, rejectionMessage, shouldIntake } from '../adapters/slack/intake.mjs';
import {
  APPROVE_ACTION, CHANNEL_SELECT_ACTION, REJECT_ACTION,
  buildPreviewMessage, buildPublishedMessage, buildRejectedMessage, selectedChannelFrom
} from '../adapters/slack/preview.mjs';
import { createPublisher } from '../adapters/publisher/index.mjs';
import { buildPrompt, writePromptFile } from '../adapters/llm/prompt.mjs';
import { createExtractor, DEFAULT_MODEL } from '../adapters/llm/claude-agent.mjs';
import { CallBudget, createSerialQueue } from '../adapters/llm/guards.mjs';
import { startHealthServer, tokenDaysRemaining } from '../adapters/server/health.mjs';
import { verifyResult } from '../core/verify.mjs';
import { applyConditions } from '../core/conditions.mjs';
import { buildReport } from '../core/report.mjs';
import { businessDaysAfter, localDateKey } from '../core/dates.mjs';
import { ensureDataDirectories } from '../core/paths.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const dataDirectory = process.env.RECRUIT_DATA_DIR ?? join(projectRoot, 'data');
const schemaPath = join(projectRoot, 'schemas', 'recruitment-result.schema.json');

function requireEnv() {
  const missing = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'].filter((n) => !process.env[n]?.trim());
  if (missing.length > 0) throw new Error(`환경변수가 없습니다: ${missing.join(', ')}`);
  if (!process.env.SLACK_BOT_TOKEN.startsWith('xoxb-')) throw new Error('SLACK_BOT_TOKEN은 xoxb-로 시작해야 합니다.');
  if (!process.env.SLACK_APP_TOKEN.startsWith('xapp-')) throw new Error('SLACK_APP_TOKEN은 xapp-로 시작해야 합니다.');
}

/**
 * 어느 워크스페이스의 어느 채널에 글을 쏘는지 부팅 때 크게 찍는다.
 *
 * 테스트 워크스페이스와 실제 워크스페이스의 설정이 두 벌 존재하게 되므로,
 * 이 로그가 없으면 "테스트인 줄 알았는데 사내 채널에 나갔다"가 언젠가 일어난다.
 */
async function announceTarget(client, channelId, logger) {
  const auth = await client.auth.test();
  let channelLabel = channelId ?? '(미설정 — 승인 화면에서 매번 선택)';
  if (channelId) {
    try {
      const info = await client.conversations.info({ channel: channelId });
      channelLabel = `#${info.channel?.name ?? '?'} (${channelId})${info.channel?.is_member ? '' : '  ← 봇이 채널에 없습니다!'}`;
    } catch (error) {
      channelLabel = `${channelId}  ← 조회 실패: ${error.data?.error ?? error.message}`;
    }
  }
  const banner = [
    '',
    '┌────────────────────────────────────────────────',
    `│ 워크스페이스 : ${auth.team} (${auth.team_id})`,
    `│ 봇          : @${auth.user}`,
    `│ 게시 채널   : ${channelLabel}`,
    `│ 게시 모드   : ${process.env.PUBLISH_MODE === 'clipboard' ? 'clipboard (실제로 안 쏨)' : 'slack (실제 게시)'}`,
    '└────────────────────────────────────────────────',
    ''
  ].join('\n');
  logger.log(banner);
  return auth;
}

function readConditions() {
  const path = process.env.RECRUIT_CONDITIONS_PATH;
  if (!path) return {};
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    throw new Error(`운영 조건 파일을 읽지 못했습니다 (${path}): ${error.message}`);
  }
}

async function main() {
  requireEnv();
  ensureDataDirectories(dataDirectory);

  const db = openDatabase(join(dataDirectory, 'recruitment.sqlite'));
  const conditions = readConditions();
  const defaultChannel = process.env.SLACK_CHANNEL_ID?.trim() || null;

  const receiver = new SocketModeReceiver({
    appToken: process.env.SLACK_APP_TOKEN,
    autoReconnectEnabled: true,
    logLevel: LogLevel.INFO
  });
  const app = new App({ token: process.env.SLACK_BOT_TOKEN, receiver, logLevel: LogLevel.INFO });

  const auth = await announceTarget(app.client, defaultChannel, console);

  const days = tokenDaysRemaining({ issuedAt: process.env.CLAUDE_CODE_OAUTH_TOKEN_ISSUED_AT });
  if (days !== null && days <= 30) {
    console.warn(`경고: Claude 구독 토큰이 ${days}일 뒤 만료됩니다. \`claude setup-token\`으로 재발급하세요.`);
  }

  const publisher = createPublisher({
    mode: process.env.PUBLISH_MODE ?? 'slack',
    client: app.client,
    defaultChannel
  });
  const queue = createSerialQueue();
  const budget = new CallBudget({
    path: join(dataDirectory, 'call-budget.json'),
    limit: Number(process.env.RECRUIT_DAILY_CALL_LIMIT ?? 30)
  });
  const extractor = await createExtractor({ queue });
  console.log(`Claude 인증: ${extractor.auth.credential} / 모델 ${DEFAULT_MODEL} / 오늘 남은 호출 ${budget.remaining()}건\n`);

  // --- 인테이크 -------------------------------------------------------------
  app.event('message', async ({ event, client, logger }) => {
    const verdict = shouldIntake(event, { botUserId: auth.user_id });
    if (!verdict.accept) {
      const message = rejectionMessage(verdict.reason, verdict);
      if (message) await client.chat.postMessage({ channel: event.channel, text: message });
      return;
    }

    await client.chat.postMessage({
      channel: event.channel,
      text: `\`${verdict.file.name}\` 읽는 중입니다. 사실 추출까지 20초쯤 걸립니다.`
    });

    try {
      const curriculum = await readSlackFile({ file: verdict.file, token: process.env.SLACK_BOT_TOKEN });
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
      const runId = randomUUID();
      const runDirectory = join(dataDirectory, 'runs', runId);
      const prompt = buildPrompt({ projectRoot, curriculum, conditions, schema });
      writePromptFile({ prompt, runDirectory });

      const { result } = await extractor.extract({ prompt, schema, model: DEFAULT_MODEL, budget });

      const applied = applyConditions(result.facts, conditions);
      result.facts = applied.facts;

      const verification = verifyResult({ result, conditions });
      const generatedAt = new Date().toISOString();
      const reportPath = join(dataDirectory, 'reports', `${runId}.html`);
      writeFileSync(join(runDirectory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
      writeFileSync(reportPath, buildReport({ runId, result, verification, generatedAt, sourcePath: verdict.file.name }));

      if (verification.errors.length > 0) {
        // 검증에 실패한 생성은 DB에 들어가지 않는다. 승인 대상이 될 수 없다는 뜻이다.
        await client.chat.postMessage({
          channel: event.channel,
          text: `검산에서 막혔습니다. 기록하지 않았습니다.\n${verification.errors.map((e) => `• ${e}`).join('\n')}`
        });
        return;
      }

      createRun(db, {
        id: runId,
        sourcePath: verdict.file.name,
        courseTitle: result.facts.courseTitle.value,
        role: result.facts.role.value,
        result,
        jobPost: verification.slackJobPost,
        postable: verification.postable,
        generatedAt,
        createdByUserId: event.user
      });

      await client.chat.postMessage({
        channel: event.channel,
        ...buildPreviewMessage({
          runId,
          verification,
          warnings: [...verification.warnings, ...(result.warnings ?? [])],
          defaultChannel
        })
      });
    } catch (error) {
      logger.error(error);
      await client.chat.postMessage({ channel: event.channel, text: `처리 중 실패했습니다: ${error.message}` });
    }
  });

  // --- 채널 선택은 상태만 남기면 되므로 ack만 --------------------------------
  app.action(CHANNEL_SELECT_ACTION, async ({ ack }) => ack());

  // --- 승인 → 게시 ----------------------------------------------------------
  app.action(APPROVE_ACTION, async ({ ack, body, action, client, logger }) => {
    await ack();
    const runId = action.value;
    const approver = body.user.id;
    try {
      // 게이트가 여기 있다. postable=0이면 던진다.
      reviewRun(db, {
        id: runId, decision: STATUS.APPROVED, reviewer: approver, reviewedAt: new Date().toISOString()
      });

      const run = getRun(db, runId);
      const target = selectedChannelFrom(body, defaultChannel);
      const posted = await publisher.publish({ runId, post: run.job_post, target });

      const completedAt = new Date().toISOString();
      completeRun(db, {
        id: runId,
        completedAt,
        followUpDueAt: businessDaysAfter(localDateKey(new Date(completedAt)), 3),
        slackChannelId: posted.channel,
        slackMessageTs: posted.messageTs,
        slackPermalink: posted.permalink
      });

      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        ...buildPublishedMessage({ runId, permalink: posted.permalink, channel: posted.channel, approver })
      });
    } catch (error) {
      logger.error(error);
      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message.ts,
        text: `승인/게시에 실패했습니다: ${error.message}`
      });
    }
  });

  app.action(REJECT_ACTION, async ({ ack, body, action, client, logger }) => {
    await ack();
    const runId = action.value;
    try {
      reviewRun(db, {
        id: runId, decision: STATUS.REJECTED, reviewer: body.user.id,
        note: '슬랙에서 반려', reviewedAt: new Date().toISOString()
      });
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        ...buildRejectedMessage({ runId, approver: body.user.id })
      });
    } catch (error) {
      logger.error(error);
      await client.chat.postMessage({
        channel: body.channel.id, thread_ts: body.message.ts,
        text: `반려에 실패했습니다: ${error.message}`
      });
    }
  });

  // --- 상태 확인과 정상 종료 --------------------------------------------------
  let shuttingDown = false;
  const health = startHealthServer({
    port: Number(process.env.HEALTH_PORT ?? 3000),
    pingDatabase: () => Boolean(db.prepare('SELECT 1 AS ok').get()?.ok),
    isShuttingDown: () => shuttingDown
  });

  await app.start();
  console.log('봇이 떴습니다. DM으로 커리큘럼 파일을 보내세요.');

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      shuttingDown = true;
      console.log(`\n${signal} — 종료합니다.`);
      health.close();
      await app.stop().catch(() => {});
      db.close?.();
      process.exit(0);
    });
  }
}

// 직접 실행할 때만 뜬다. import만 해도 봇이 켜지면 테스트가 Slack에 접속하려 든다.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

export { main };
