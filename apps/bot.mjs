#!/usr/bin/env node
/**
 * Slack 상주 봇.
 *
 *   DM에 커리큘럼 파일 → 사실 추출 → 공고 조립 → 검토 미리보기
 *                                                → [승인] → 채널 게시
 *
 * 승인은 여기 버튼 하나뿐이다. CLI에는 승인 명령이 없다(설계서 §6.4).
 * 검산기(core/verify.mjs)는 v1에서 없앴다 -- 모든 생성 결과는 무조건
 * 검토대기로 들어가고, 사람이 눈으로 보고 승인 여부를 결정한다.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, LogLevel, SocketModeReceiver } from '@slack/bolt';

import {
  openDatabase, createRun, getRun, reviewRun, completeRun, updateDraft, STATUS
} from '../adapters/store/database.mjs';
import { readSlackFile, rejectionMessage, shouldIntake } from '../adapters/slack/intake.mjs';
import {
  APPROVE_ACTION, CHANNEL_SELECT_ACTION, EDIT_ACTION, REJECT_ACTION,
  buildPreviewMessage, buildPublishedMessage, buildRejectedMessage, selectedChannelFrom
} from '../adapters/slack/preview.mjs';
import {
  EDIT_MODAL, buildEditModal, modalErrors, parseEditModal
} from '../adapters/slack/edit-modal.mjs';
import {
  OPERATIONS_ACTION, OPERATIONS_MODAL,
  buildOperationsModal, parseOperationsModal, validateOperations
} from '../adapters/slack/operations-modal.mjs';
import {
  CompensationError, applyCompensationLine, buildCompensationLine
} from '../core/compensation.mjs';
import { createPublisher } from '../adapters/publisher/index.mjs';
import { buildPrompt, writePromptFile } from '../adapters/llm/prompt.mjs';
import { createExtractor, DEFAULT_MODEL } from '../adapters/llm/claude-agent.mjs';
import { startHealthServer, tokenDaysRemaining } from '../adapters/server/health.mjs';
import { renderJobPost, pendingMarkers } from '../core/render/job-post.mjs';
import { applyConditions } from '../core/conditions.mjs';
import { ensureDataDirectories } from '../core/paths.mjs';
import { envNumber, envOr } from '../core/env.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const dataDirectory = envOr(process.env, 'RECRUIT_DATA_DIR', join(projectRoot, 'data'));
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
/**
 * 진행 상황을 한 메시지에 계속 갱신하는 헬퍼.
 *
 * 모델 호출은 "20초쯤"이라던 게 실사용에서 훨씬 오래 걸리는 경우가 있었고,
 * 그동안 슬랙에는 아무 신호가 없어 사람이 멈춘 건지 도는 건지 알 수 없었다.
 *
 * 처음엔 15초마다 찍는 시계(하트비트)를 달았는데, 실제 단계 구분과 안 맞아서
 * "그냥 시간만 세는 티커"로 보인다는 피드백을 받았다(2026-09-08). 그래서
 * 시간 기반 타이머를 버리고, SDK가 실제로 스트리밍하는 메시지(system/assistant/
 * result)와 코드의 실제 단계 전환(파일 읽기 → 프롬프트 조립 → 모델 호출 →
 * 공고 조립)에 맞춰서만 갱신한다 -- "몇 초 지났다"가 아니라 "지금 뭘 하고
 * 있다"를 보여준다. 다만 정말 아무 신호 없이 오래(30초) 조용하면 그건
 * 이상 신호일 수 있으니 한 번은 알려준다(반복 티커가 아니라 워치독).
 */
function createProgressReporter(client, channel, logger) {
  let ts = null;
  let silenceTimer = null;
  const silenceMs = 30000;

  const armWatchdog = (lastText) => {
    clearTimeout(silenceTimer);
    if (!ts) return;
    silenceTimer = setTimeout(() => {
      client.chat.update({
        channel,
        ts,
        text: `${lastText}\n(${silenceMs / 1000}초 넘게 새 신호가 없습니다 — 멈춘 건 아니고, 대형 문서는 원래 오래 걸립니다.)`
      }).catch((error) => logger.error(error));
    }, silenceMs);
  };

  return {
    async start(text) {
      const shown = `⏳ ${text}`;
      const posted = await client.chat.postMessage({ channel, text: shown });
      ts = posted.ts;
      armWatchdog(shown);
    },
    async step(text) {
      if (!ts) return;
      const shown = `⏳ ${text}`;
      await client.chat.update({ channel, ts, text: shown }).catch((error) => logger.error(error));
      armWatchdog(shown);
    },
    async done(finalText) {
      clearTimeout(silenceTimer);
      if (!ts) return;
      await client.chat.update({ channel, ts, text: finalText }).catch((error) => logger.error(error));
    },
    async fail(errorText) {
      clearTimeout(silenceTimer);
      if (!ts) return;
      await client.chat.update({ channel, ts, text: errorText }).catch((error) => logger.error(error));
    }
  };
}

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

/**
 * DB에 저장된 run으로부터 미리보기를 다시 만든다.
 * 편집 전후로 같은 함수를 쓴다 — 화면이 어긋나지 않게 하려면 한 군데여야 한다.
 */
function previewFor(run, { defaultChannel, warnings = [] }) {
  const result = JSON.parse(run.result_json ?? '{}');
  const facts = result.facts ?? {};
  const compensation = run.compensation_json ? JSON.parse(run.compensation_json) : null;
  return {
    facts,
    compensation,
    message: buildPreviewMessage({
      runId: run.id,
      verification: {
        slackJobPost: run.job_post,
        pendingMarkers: pendingMarkers(run.job_post ?? '')
      },
      warnings,
      defaultChannel,
      compensation
    })
  };
}

/**
 * 운영 조건 **파일은 쓰지 않는다.**
 *
 * 예전에는 `RECRUIT_CONDITIONS_PATH`가 가리키는 JSON을 부팅 때 읽어 모든 건의
 * 기본값으로 썼다. 그런데 그 값들은 `evidence: "운영 조건 ..."`을 달고 들어가
 * 검산을 그냥 통과한다 — **출처가 없는 값이 사실인 척 공고로 나갈 수 있었다.**
 * 실제로 `.env`가 `examples/` 아래 샘플 파일을 가리키고 있었고, 거기 적힌
 * 가짜 장소·시간·마감일이 모든 건의 기본값이었다.
 *
 * 이제 운영사항은 건별로 사람이 모달에 넣는다. 파일 기본값은 존재 이유가 없고
 * 가짜 값이 새어드는 경로만 된다. 그래서 없앤다.
 *
 * (CLI의 `--conditions`는 남는다. 실행할 때마다 사람이 명시적으로 지정하는
 *  인자라서 "어떤 값이 어디서 왔는지"가 명령줄에 그대로 보인다.)
 */
function assertNoConditionsFile() {
  const path = envOr(process.env, 'RECRUIT_CONDITIONS_PATH');
  if (!path) return;
  throw new Error(
    `RECRUIT_CONDITIONS_PATH가 설정돼 있습니다 (${path}). 봇은 더 이상 이 파일을 쓰지 않습니다 — `
    + '거기 적힌 값이 출처 없이 모든 건의 기본값이 되어 공고로 나갈 수 있었습니다. '
    + '운영사항은 파일을 받을 때 모달로 받습니다. .env에서 이 줄을 지우세요.'
  );
}

/**
 * 모달을 채우는 동안 파일을 들고 있는다.
 *
 * Slack 파일 URL은 토큰이 있어야 열리고 영원하지도 않으므로, 지금 받은 것을
 * 그대로 쥐고 있다가 제출될 때 쓴다. 30분이면 충분하다 — 그보다 오래 걸리면
 * 사람이 딴 일을 하러 간 것이고, 그때는 파일을 다시 던지는 편이 맞다.
 */
function createPendingIntake({ ttlMs = 30 * 60 * 1000 } = {}) {
  const items = new Map();
  return {
    put(key, value) {
      items.set(key, { value, expiresAt: Date.now() + ttlMs });
      return key;
    },
    take(key) {
      const found = items.get(key);
      items.delete(key);
      if (!found || found.expiresAt < Date.now()) return null;
      return found.value;
    },
    get size() {
      return items.size;
    }
  };
}

async function main() {
  requireEnv();
  ensureDataDirectories(dataDirectory);

  const db = openDatabase(join(dataDirectory, 'recruitment.sqlite'));
  assertNoConditionsFile();
  const pendingIntake = createPendingIntake();
  // 지난 입력을 기억해 다음 건에서 다시 치지 않게 한다. 대부분 장소·지원방법이 같다.
  // **사람이 실제로 친 값만** 들어온다. 어떤 기본값도 미리 채우지 않는다 —
  // 미리 채워 두면 담당자가 확인 없이 넘기고, 그 순간 출처 없는 값이 공고가 된다.
  let lastOperations = {};
  const defaultChannel = envOr(process.env, 'SLACK_CHANNEL_ID');

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
    mode: envOr(process.env, 'PUBLISH_MODE', 'slack'),
    client: app.client,
    defaultChannel
  });
  const extractor = await createExtractor();
  console.log(`Claude 인증: ${extractor.auth.credential} / 모델 ${DEFAULT_MODEL}\n`);

  // --- 인테이크 -------------------------------------------------------------
  app.event('message', async ({ event, client, logger }) => {
    const verdict = shouldIntake(event, { botUserId: auth.user_id });
    if (!verdict.accept) {
      const message = rejectionMessage(verdict.reason, verdict);
      if (message) await client.chat.postMessage({ channel: event.channel, text: message });
      return;
    }

    // 파일을 붙잡아 두고 운영사항부터 묻는다. 커리큘럼은 제안서 단계 문서라
    // 실제 운영과 다를 수 있고, 그 차이를 사람만 안다.
    const token = pendingIntake.put(randomUUID(), {
      file: verdict.file, channel: event.channel, user: event.user
    });
    await client.chat.postMessage({
      channel: event.channel,
      text: `\`${verdict.file.name}\` 받았습니다. 실제 운영 사항을 확인한 뒤 읽겠습니다.`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `\`${verdict.file.name}\` 받았습니다.` }
        },
        {
          type: 'actions',
          block_id: `ops_${token}`,
          elements: [{
            type: 'button',
            action_id: OPERATIONS_ACTION,
            style: 'primary',
            text: { type: 'plain_text', text: '운영사항 입력' },
            value: token
          }]
        }
      ]
    });
  });

  app.action(OPERATIONS_ACTION, async ({ ack, body, action, client, logger }) => {
    await ack();
    try {
      const pending = pendingIntake.take(action.value);
      if (!pending) {
        await client.chat.postMessage({
          channel: body.channel.id,
          text: '시간이 지나 파일을 놓쳤습니다. 다시 보내 주세요.'
        });
        return;
      }
      // 모달이 닫히면 파일을 다시 못 찾으므로, 열면서 같은 열쇠로 되돌려 놓는다.
      pendingIntake.put(action.value, pending);
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          ...buildOperationsModal({ fileName: pending.file.name, defaults: lastOperations }),
          private_metadata: JSON.stringify({ token: action.value, channel: body.channel.id })
        }
      });
    } catch (error) {
      logger.error(error);
    }
  });

  app.view(OPERATIONS_MODAL, async ({ ack, view, client, logger }) => {
    const operations = parseOperationsModal(view);
    const invalid = validateOperations(operations);
    if (invalid) return ack(invalid);
    await ack();

    const { token, channel } = JSON.parse(view.private_metadata);
    const pending = pendingIntake.take(token);
    if (!pending) {
      await client.chat.postMessage({ channel, text: '시간이 지나 파일을 놓쳤습니다. 다시 보내 주세요.' });
      return;
    }
    // 다음 건에서 같은 것을 또 치지 않도록 기억한다.
    lastOperations = operations;

    const progress = createProgressReporter(client, channel, logger);
    await progress.start(`\`${pending.file.name}\` 읽는 중`);

    const event = { channel, user: pending.user };
    try {
      const curriculum = await readSlackFile({ file: pending.file, token: process.env.SLACK_BOT_TOKEN });
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
      const runId = randomUUID();
      const runDirectory = join(dataDirectory, 'runs', runId);
      // 방금 담당자가 넣은 값이 전부다. 섞어 넣을 기본값 같은 것은 없다.
      const conditions = operations;
      await progress.step('프롬프트 조립 중');
      const prompt = buildPrompt({ projectRoot, curriculum, conditions, schema });
      writePromptFile({ prompt, runDirectory });

      await progress.step('모델 호출 준비 중');
      let assistantTurns = 0;
      const { result } = await extractor.extract({
        prompt,
        schema,
        model: DEFAULT_MODEL,
        // 스키마 위반으로 재시도가 걸리면 그것도 보여준다 — 그냥 오래 걸리는 것과
        // 재시도로 오래 걸리는 것은 사람이 봤을 때 다른 신호다.
        onAttempt: ({ attempt }) => {
          if (attempt > 1) progress.step(`모델 재시도 중 (${attempt}차 — 이전 응답이 스키마를 위반함)`);
        },
        // 시간 기반 티커 대신 SDK가 실제로 보내는 이벤트를 그대로 옮긴다.
        onMessage: ({ attempt, message }) => {
          if (message?.type === 'system' && message.subtype === 'init') {
            progress.step(`모델 세션 시작 (${attempt}차 시도)`);
          } else if (message?.type === 'assistant') {
            assistantTurns += 1;
            progress.step(`모델 응답 생성 중 (${attempt}차 시도, ${assistantTurns}번째 응답 조각)`);
          } else if (message?.type === 'result') {
            progress.step(`모델 응답 수신 완료 (${attempt}차 시도)`);
          }
        }
      });

      await progress.step('공고 조립 중');
      // override: 커리큘럼에 값이 있어도 담당자 입력이 이긴다.
      const applied = applyConditions(result.facts, conditions, { override: true });
      result.facts = applied.facts;

      // 공고 본문은 여기서 사실로부터 조립된다. 모델은 본문을 쓴 적이 없다.
      const jobPost = renderJobPost(result.facts);
      const markers = pendingMarkers(jobPost);
      const generatedAt = new Date().toISOString();

      // 검산기가 없으므로 모든 생성 결과는 무조건 검토대기로 기록한다.
      createRun(db, {
        id: runId,
        sourcePath: pending.file.name,
        courseTitle: result.facts.courseTitle.value,
        role: result.facts.role.value,
        result,
        jobPost,
        generatedAt,
        createdByUserId: pending.user
      });

      const warnings = [
        ...(result.warnings ?? []),
        ...applied.overridden.map(({ key, from, to }) => `${key}: 원문 "${from}" → 입력 "${to}"`)
      ];
      await progress.done(`✅ \`${pending.file.name}\` 처리 완료 — 아래에서 검토해 주세요.`);
      await client.chat.postMessage({
        channel: event.channel,
        ...buildPreviewMessage({
          runId,
          verification: { slackJobPost: jobPost, pendingMarkers: markers },
          warnings,
          defaultChannel
        })
      });
    } catch (error) {
      logger.error(error);
      await progress.fail(`❌ 처리 중 실패했습니다: ${error.message}`);
    }
  });

  // --- 편집 모달 -------------------------------------------------------------
  app.action(EDIT_ACTION, async ({ ack, body, action, client, logger }) => {
    await ack();
    try {
      const run = getRun(db, action.value);
      if (!run) throw new Error(`작업을 찾을 수 없습니다: ${action.value}`);
      const facts = JSON.parse(run.result_json ?? '{}').facts ?? {};
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          ...buildEditModal({
            runId: run.id,
            post: run.job_post,
            totalHours: facts.totalHours?.value ?? null,
            compensation: run.compensation_json ? JSON.parse(run.compensation_json) : null
          }),
          // 반영 후 이 메시지를 갱신해야 하므로 위치를 들고 간다.
          private_metadata: JSON.stringify({
            runId: run.id, channel: body.channel.id, ts: body.message.ts
          })
        }
      });
    } catch (error) {
      logger.error(error);
    }
  });

  app.view(EDIT_MODAL, async ({ ack, body, view, client, logger }) => {
    const { runId, mode, amount, post } = parseEditModal(view);
    const { channel, ts } = JSON.parse(view.private_metadata);
    try {
      const run = getRun(db, runId);
      const facts = JSON.parse(run.result_json ?? '{}').facts ?? {};

      // 금액 줄은 코드가 만든다. 사람이 곱하면 틀려도 아무도 모른다.
      let fee;
      try {
        fee = buildCompensationLine({
          mode,
          amount,
          totalHours: facts.totalHours?.value ?? null,
          roleLabel: facts.role?.value ?? '보조강사',
          travelExpenseIncluded: Boolean(facts.travelExpenseIncluded?.value)
        });
      } catch (error) {
        if (!(error instanceof CompensationError)) throw error;
        return ack(modalErrors([], { feeError: error.message }));
      }

      let merged;
      try {
        merged = applyCompensationLine(post, fee.line);
      } catch (error) {
        return ack(modalErrors([error.message]));
      }

      // 검산기가 없으니 그대로 저장한다 — 본문 검토는 승인 화면에서 사람이 한다.
      await ack();
      const saved = updateDraft(db, {
        id: runId,
        jobPost: merged,
        compensation: { mode, amount, total: fee.total, hourlyRate: fee.hourlyRate, line: fee.line }
      });
      const { message } = previewFor(saved, { defaultChannel });
      await client.chat.update({ channel, ts, ...message });
    } catch (error) {
      logger.error(error);
      await ack();
      await client.chat.postMessage({ channel, thread_ts: ts, text: `수정에 실패했습니다: ${error.message}` });
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
      reviewRun(db, {
        id: runId,
        decision: STATUS.APPROVED,
        reviewer: approver,
        reviewedAt: new Date().toISOString()
      });

      const run = getRun(db, runId);
      const target = selectedChannelFrom(body, defaultChannel);
      const posted = await publisher.publish({ runId, post: run.job_post, target });

      const completedAt = new Date().toISOString();
      completeRun(db, {
        id: runId,
        completedAt,
        followUpDueAt: null,
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
    port: envNumber(process.env, 'HEALTH_PORT', 3000),
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
