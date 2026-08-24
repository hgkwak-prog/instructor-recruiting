# 통합 설계서 — 강사 구인 자동화 단일 레포

작성일 2026-08-24 · 상태: **초안, 승인 대기** · 코드 작업은 이 문서 승인 후 시작

두 레포를 새 레포 하나로 합치고, 모델 호출을 Gemini/OpenAI API와 Claude CLI에서
**Claude Agent SDK(정액제 구독 인증)** 로 단일화한다. API 종량제 키는 쓰지 않는다.

| 입력 레포 | 무엇을 가진 쪽인가 |
|---|---|
| `assistant-instructor-recruiting-agent` | 사실 추출 스키마, 검산, 공고 조립, 승인 게이트, 비공개 정책, 시트 관제탑, 테스트 120개, 의존성 0 |
| `slack-recruiting-bot` | Slack 상주 앱(Socket Mode), PDF 인테이크, 누락정보 모달, 게시, Notion 동기화, 커리어데이 Playwright, Docker |

---

## 0. 이번에 확정한 것과 그 대가

| 사안 | 이전 결정 | 이번 결정 | 대가 |
|---|---|---|---|
| 뼈대 | — | **새 레포** | 이관 비용 최대. 대신 두 레포의 상충 구조를 물려받지 않음 |
| 모델 호출 | Gemini/OpenAI API (bot), `claude` CLI 서브프로세스 (agent) | **Claude Agent SDK + 구독(정액제) OAuth 토큰** | ① 봇 사용량이 **본인 구독 한도를 그대로 깎는다**(§5.3) ② 토큰 1년 만료, 수동 갱신 ③ 호출당 CLI 스폰 ≈12초 |
| 슬랙 자동 게시 | 안 함, 복붙 확정 | **살림** | 앱 설치·`chat:write`·채널 초대 권한 **확보 확인됨(2026-08-24)**. 게시 대상 변경에 대비해 publisher로 추상화(§6.5) |
| 커리어데이 Playwright | 안 함 | **살림** | 사이트 DOM 변경 시 유지보수. 호스트 실행이라 Docker 밖 이중 런타임 |
| Notion 동기화 | (bot에만 존재) | **살림** | 구글 시트와 역할이 겹침 → §6.7에서 분리 |

> **3개를 동시에 살리면 “승인 지점”이 넷이 된다** — Slack 버튼 / 시트 드롭다운 / CLI `approve` / 커리어데이.
> **승인은 Slack 버튼 하나로 단일화하기로 확정했다(2026-08-24).** 상세는 §6.4.

---

## 1. 목표 아키텍처

**불변 원칙(양보 불가): 모델은 사실만 추출하고, 공고 본문은 코드가 조립한다.**
Agent SDK로 바꿔도 이건 그대로다. SDK를 “에이전트 루프”로 쓰지 않고 **툴 0개, 1턴, JSON Schema 강제**의
구조화 추출기로만 쓴다(§5). 채널이 늘어난 만큼 원칙은 오히려 더 세게 걸어야 한다.

```
recruiting/                       (새 레포. 이름은 미정 — §11)
├─ core/                          외부 I/O 없음, 의존성 0, 테스트 대상 전부
│  ├─ schema.mjs                  facts 스키마 검증 (agent 그대로)
│  ├─ verify.mjs                  산술·달력·운영조건·기밀 검산 (agent 그대로)
│  ├─ derive.mjs                  물류 자격·담당 업무 표준세트·주소 일반화 (agent 그대로)
│  ├─ dates.mjs                   영업일 계산 (Asia/Seoul) (agent 그대로)
│  ├─ conditions.mjs              운영 조건이 빈 사실을 채움 (agent 그대로)
│  ├─ render/
│  │   ├─ job-post.mjs            슬랙/커뮤니티용 공고 본문 (agent render.mjs)
│  │   └─ careerday.mjs           커리어데이 폼값  ★신규 (§6.3)
│  ├─ publishing-profile.mjs      채널별 노출 정책  ★신규 (§6.3)
│  ├─ state.mjs                   상태머신 + 전이 규칙 (§7)
│  └─ report.mjs                  HTML 검토 리포트 (agent 그대로)
│
├─ adapters/                      외부 I/O. 여기만 의존성을 가진다
│  ├─ llm/claude-agent.mjs        Agent SDK 호출  ★교체 (§5)
│  ├─ store/database.mjs          node:sqlite (양쪽 동일 드라이버)
│  ├─ documents/pdf.mjs           pdf-parse (§6.8)
│  ├─ slack/                      bot의 file-intake / modal / supplement / preview / reminder
│  ├─ publisher/                  ★신규 추상화 (§6.5)
│  │   ├─ slack-publisher.mjs
│  │   └─ careerday-publisher.mjs (호스트 전용)
│  ├─ notion/sync.mjs             단방향 미러 (읽기용)
│  └─ sheets/webhook.mjs          성과·관제 (승인 권한 없음)
│
├─ apps/
│  ├─ bot.mjs                     Slack Socket Mode 상주 + 헬스서버 + 스케줄러 (Docker)
│  ├─ cli.mjs                     generate/list/show/mark-complete/outcome/sync (운영자용)
│  └─ careerday-runner.mjs        Playwright. **호스트에서 실행** (§6.6)
│
├─ skills/jd-writer/SKILL.md      `## Rules` 이하가 프롬프트에 주입되는 규칙 원본
├─ schemas/recruitment-result.schema.json   scripts/gen-schema.mjs로 생성
└─ test/                          agent 120개 + bot에서 살릴 것 + 신규
```

핵심: **`core/`는 여전히 의존성 0.** 테스트가 외부 서비스 없이 도는 성질을 잃지 않는 것이
이번 통합에서 가장 지키기 어렵고 가장 중요한 부분이다.

---

## 2. 모듈 매핑 — agent 레포

| 원본 | 이동처 | 변경 |
|---|---|---|
| `src/lib/schema.mjs` | `core/schema.mjs` | 그대로 |
| `src/lib/verify.mjs` | `core/verify.mjs` | 커리어데이 렌더 대상 검산 규칙 추가 |
| `src/lib/derive.mjs` | `core/derive.mjs` | 그대로 |
| `src/lib/dates.mjs` | `core/dates.mjs` | 그대로 |
| `src/lib/conditions.mjs` | `core/conditions.mjs` | `publishingInput` 필드 추가 (§6.3) |
| `src/lib/render.mjs` | `core/render/job-post.mjs` | 프로파일 인자 추가 |
| `src/lib/report.mjs` | `core/report.mjs` | 커리어데이 초안 섹션 추가 |
| `src/lib/database.mjs` | `adapters/store/database.mjs` | 컬럼 추가(§8), 상태 2개 추가 |
| `src/lib/reminders.mjs` | `core/`+`adapters/` 분리 | 판정은 core, 발송은 adapter |
| `src/lib/sheets.mjs` | `adapters/sheets/` | **승인 수신(`fetchDecisions`→`sync`) 제거**, 성과·현황만 |
| `src/lib/files.mjs` | `adapters/documents/` | pdftotext → pdf-parse 교체 (§6.8) |
| `src/lib/paths.mjs` | `core/paths.mjs` | 그대로 |
| `src/lib/claude.mjs` | **폐기** | → `adapters/llm/claude-agent.mjs` |
| `src/cli.mjs` | `apps/cli.mjs` | `approve`/`reject` 제거 (§6.4) |
| `skills/jd-writer/SKILL.md` | 동일 경로 | 그대로 |
| `test/*.test.mjs` (120개) | `test/` | 경로만 수정 |

## 3. 모듈 매핑 — slack-recruiting-bot

| 원본 | 판정 | 사유 |
|---|---|---|
| `src/bot.js` | **재작성** | 엔트리포인트. `apps/bot.mjs`로 재구성 |
| `src/slack/file-intake.js` | **이관** | DM PDF 수신. 그대로 쓸 수 있음 |
| `src/slack/recruitment-modal.js` | **재작성** | 필드가 bot 스키마 기준. agent 24필드로 다시 맞춤 |
| `src/slack/recruitment-supplement.js` | **재작성** | 위와 동일 |
| `src/slack/pdf-draft-flow.js` | **부분 이관** | 채널 선택 모달은 유지, `recruitmentFactsToInput`은 폐기 |
| `src/slack/preview-message.js` | **이관** | 미리보기 블록. 본문 소스만 `core/render`로 교체 |
| `src/slack/review-reminder.js` | **이관** | 3영업일 알림 DM + 결정 버튼 |
| `src/slack/careerday-flow.js` | **이관** | 커리어데이 초안 모달·승인 |
| `src/careerday/careerday-draft.js` | **부분 재작성** | JD 문자열 역파싱 → facts 직접 변환 (§6.3) |
| `src/careerday/careerday-form-plan.js` | **이관** | 폼 필드 매핑 |
| `src/careerday/careerday-site-adapter.js` | **이관** | Playwright 셀렉터. README상 2026-07-31 재검증이나, 해당 커밋이 `Recover … from Docker image`라 **복원 날짜일 가능성**이 있다 → P4에서 실검증 |
| `scripts/careerday-browser.js` | **이관** | `apps/careerday-runner.mjs` |
| `src/notion/notion-recruitment-sync.js` | **이관** | 역할 축소(§6.7) |
| `src/server/health-server.js` | **이관** | `/healthz`, `/readyz` |
| `src/state/ttl-store.js` | **이관** | 모달 세션 임시 상태 |
| `src/recruitments/recruitment-repository.js` | **폐기** | agent `database.mjs`로 통합 (§8) |
| `src/recruitments/review-schedule.js` | **부분 폐기** | `calculateReviewAt`은 agent `dates.mjs`와 중복 → 폐기. **`readReminderConfig`는 대응물이 없다** — `RECRUITMENT_WAIT_DAYS`/`_DAY_MODE`/`_TIME_ZONE`/`_REMINDER_POLL_MS`를 읽는 유일한 곳이므로 리마인더 설정으로 이관 |
| `src/domain/job-post.js` | **폐기** | 모델이 본문 쓰는 스키마. 원칙 위반 |
| `src/domain/recruitment-facts.js` | **폐기** | agent 스키마로 대체 |
| `src/prompts/*.js` | **폐기** | 규칙 원본은 SKILL.md 하나 |
| `src/llm/**` | **폐기** | Agent SDK로 단일화 |
| `src/formatters/slack-job-post.js` | **폐기** | 본문은 `core/render` |
| `src/formatters/slack-recruitment-facts.js` | **재작성** | 11필드 기준 표시. agent 24필드로 다시 맞춤 |
| `src/formatters/slack-recruitment-list.js` | **이관** | 목록 표시 |
| `src/documents/pdf-document.js` | **이관** | pdf-parse |
| `src/{extract-recruitment-facts,generate-draft,inspect-document,post-test-message}.js` | **폐기** | `llm/**` 의존 일회성 CLI. 기능은 `apps/cli.mjs`로 흡수 |
| `test/*.test.js` (21개) | **선별 이관** | careerday·health-server·repository만. gemini/openai provider 테스트는 폐기 |
| `Dockerfile`, `compose.yml`, `.github/workflows/ci.yml` | **이관·수정** | §9 |

---

## 4. 파이프라인 (통합 후)

```
Slack DM에 커리큘럼 PDF 투하
  │
  ├─ pdf-parse 텍스트 추출 ── 운영 조건 병합
  │
  ├─ Agent SDK: 사실 추출만 (툴 0개, 1턴, JSON Schema)   ← 유일한 모델 호출
  │        │  스키마 위반 시 1회 재시도, 2회 실패면 중단
  │        ▼
  │   core/verify  산술·달력·운영조건·기밀 검산
  │        │  실패 → DB에 안 들어감. 어떤 상태도 갖지 않음
  │        ▼
  │   core/render/job-post  (프로파일: slack) — 목표·커리큘럼·고객사·금액·상세주소 제외
  │        │
  │        ├─→ HTML 리포트 (data/reports/)
  │        ├─→ SQLite  status=review_pending
  │        ├─→ 구글 시트 행 (읽기 전용 관제)
  │        └─→ Notion 미러
  │
  ├─ Slack 미리보기 + 누락정보 모달 → 담당자가 보완
  │
  ├─ ★ Slack [승인] 버튼 ── 유일한 공개 승인 지점
  │        │  `[확인 필요]`가 남아 있으면 코드가 승인을 거부 (postable=0)
  │        ▼
  │   봇이 지정 채널에 게시            status=completed, +3영업일 계산
  │
  ├─ 3영업일 후 담당자 DM (1회)        status=follow_up_due
  │        │
  │        ├─ 지원자 충분 → outcome 기록 → 종료
  │        └─ 부족 → [커리어데이 준비] 버튼
  │                 │
  │                 ├─ core/render/careerday  (프로파일: careerday)
  │                 │    강사료·상세주소는 **담당자 입력값**만 사용 (§6.3)
  │                 ├─ Slack 모달로 폼값 확인·수정 → 승인   status=careerday_pending
  │                 ├─ 호스트에서 `careerday:fill <id>` → Playwright 자동 입력
  │                 └─ **최종 등록 버튼은 사람이 누른다**   status=careerday_posted
  │
  └─ 그래도 없으면 전화 폴백 (수동, outcome에 final_channel=phone 기록)
```

---

## 5. Claude Agent SDK 호출 레이어

### 5.1 왜 “에이전트”로 쓰지 않는가

Agent SDK를 자율 루프로 돌리면 매 실행마다 표현과 판단이 흔들린다. 초판에서 화요일을 `(월)`로
적은 공고가 나간 사고는 그 성질 때문이었다. SDK는 **제약된 구조화 추출기**로만 쓴다.

| 축 | 설정 | 목적 |
|---|---|---|
| 툴 | `allowedTools: []` + `permissionMode: 'dontAsk'` | 파일·bash 접근 차단. 모델이 “알아서” 무언가 읽는 것을 금지 |
| 시스템 프롬프트 | 커스텀 문자열 (`claude_code` 프리셋 **미사용**) | SDK 기본 프롬프트 오염 제거 |
| 출력 | `outputFormat: { type: 'json_schema', schema }` | CLI `--json-schema`의 SDK 대응물 |
| 턴 | `maxTurns: 1` | 대화 아님 |
| 세션 | 저장 안 함 | 이전 실행이 다음 실행에 새지 않게 |
| 로컬 재검증 | `core/schema.validate()` 유지 | SDK가 통과시켜도 우리가 다시 본다 |

`$schema` 키 제거(`toCliSchema`) 로직은 **유지**한다. CLI가 2020-12 메타스키마를 오프라인에서
못 푸는 문제였고, SDK가 같은 바이너리를 스폰하므로 재발 가능성이 있다.

### 5.2 스케치

```js
// adapters/llm/claude-agent.mjs
import { query } from '@anthropic-ai/claude-agent-sdk';
import { validate } from '../../core/schema.mjs';

export const DEFAULT_MODEL = process.env.RECRUIT_MODEL ?? 'claude-sonnet-5';

const SYSTEM = [
  '당신은 강사 구인 운영 담당자입니다.',
  '주어진 커리큘럼과 운영 조건만을 근거로 사실을 추출합니다.',
  '공고 본문은 작성하지 않습니다. 본문은 코드가 조립합니다.',
  '근거가 없는 값은 null로 두고, 상식으로 채우지 마세요.'
].join('\n');

export async function extractFacts({ prompt, schema, model = DEFAULT_MODEL, attempts = 2 }) {
  let lastErrors = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const input = attempt === 1
      ? prompt
      : `${prompt}\n\n[이전 응답 오류] 아래를 모두 고쳐 다시 출력하세요.\n- ${lastErrors.join('\n- ')}`;

    let structured;
    for await (const message of query({
      prompt: input,
      options: {
        model,
        systemPrompt: SYSTEM,
        allowedTools: [],
        permissionMode: 'dontAsk',
        maxTurns: 1,
        outputFormat: { type: 'json_schema', schema: stripMetaSchema(schema) }
      }
    })) {
      if (message.type === 'result') structured = message.structured_output;
    }
    if (!structured) throw new Error('모델이 구조화 출력을 반환하지 않았습니다.');

    lastErrors = validate(structured, schema);   // SDK를 믿지 않고 다시 검증
    if (lastErrors.length === 0) return { result: structured, attempts: attempt };
  }
  throw new Error(`모델 응답이 스키마를 ${attempts}회 연속 위반했습니다:\n- ${lastErrors.join('\n- ')}`);
}
```

**`--dry-run`은 유지한다.** `data/runs/<run-id>/prompt.txt`에 실제 프롬프트를 남기고 모델을
호출하지 않는다. SKILL.md 규칙을 고친 뒤 무엇이 주입되는지 확인하는 유일한 수단이다.

### 5.3 인증 — 정액제 구독으로 돌린다 (API 종량제 키 아님)

Agent SDK는 Claude Code와 같은 자격증명 체계를 쓴다. 구독 인증은 **공식 경로**다.

```bash
# 1회. 브라우저 승인 후 토큰이 터미널에 출력된다 (어디에도 저장되지 않으니 복사할 것)
claude setup-token
# → 서버/컨테이너 환경변수로 주입
export CLAUDE_CODE_OAUTH_TOKEN=<발급된 토큰>
```

- 유효기간 **1년**. Pro / Max / Team / Enterprise 플랜 필요.
- 이 토큰은 **모델 요청만** 할 수 있다. Remote Control·claude.ai 커넥터 불가 — 우리 용도(사실 추출)에는 무관.
- Docker는 **환경변수 하나면 된다.** `~/.claude` 자격증명 파일 마운트 불필요. 토큰은 시크릿으로 주입.

#### ⚠️ 반드시 지킬 것 세 가지

**1. `ANTHROPIC_API_KEY`를 환경에서 없앤다.** 인증 우선순위가
`ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` → `/login` 이라
**API 키가 있으면 구독 토큰이 조용히 무시되고 종량제로 과금된다.** 컨테이너 env에 남아 있으면 안 된다.
`.env.example`에서 `ANTHROPIC_API_KEY` 항목 자체를 빼고, 부팅 시 설정돼 있으면 **경고 후 중단**한다.

**2. `--bare` 모드를 쓰지 않는다.** bare 모드는 `CLAUDE_CODE_OAUTH_TOKEN`을 읽지 않는다.

**3. 토큰 갱신을 달력에 건다.** 발급일을 기록하고 11개월 시점에 재발급.
만료 경고는 `/login` 자격증명일 때만 뜨므로, 상주 봇은 **경고 없이 어느 날 갑자기 죽는다.**
`/readyz`에 토큰 발급일 기준 잔여일 체크를 넣고, 30일 남으면 담당자에게 DM을 보낸다.

#### 사용량 — 본인 구독 한도를 공유한다

2026-06-15에 예고됐던 "Agent SDK 별도 월 크레딧(Pro $20 / Max $100~200)"은 **보류됐고 제공되지 않는다.**
현재는 이렇다.

> Claude Agent SDK, `claude -p`, 서드파티 앱 사용량은 **여전히 구독의 사용 한도에서 차감된다.**

즉 **봇이 쓰는 만큼 담당자 본인의 대화형 Claude Code·Cowork·웹 채팅 한도가 줄어든다.**
월 15건 × 커리큘럼 1건이면 영향은 작지만, 재시도 루프가 폭주하면 사람이 Claude를 못 쓰게 된다.
가드를 코드로 건다.

- 추출 호출 **직렬화**(동시 1건)
- 스키마 재시도 **최대 2회**(기존 정책 유지). 그 이상 돌지 않음
- **일일 호출 상한**(기본 30). 초과 시 처리를 멈추고 담당자에게 DM
- 레이트 리밋 에러는 재시도하지 않고 큐에 남긴 뒤 알림 — 조용히 한도를 태우지 않는다

#### 계정 소유 — Team 플랜 기준 (현재 Team Premium 좌석)

**Claude Code는 모든 Team 좌석에 포함된다.** Premium은 사용량 한도가 더 클 뿐이다.
따라서 봇 전용 좌석은 **Standard 좌석으로도 인증이 된다** — 월 15건 규모면 Standard로 충분할 공산이 크다.

| 안 | 내용 | 평가 |
|---|---|---|
| **A. 담당자 Premium 좌석 ✅ 채택 (2026-08-24)** | Biz의 Premium 좌석에서 `setup-token` | 추가 비용 0, 즉시 시작. 단 아래 두 가지를 감수한다 |
| B. 봇 전용 좌석 | 좌석 1개 추가, 그 계정으로 토큰 발급 | 사용량 분리·토큰 생존. 나중에 옮길 수 있다 |

**A를 택한 대가와 완화책**

1. **봇이 Biz 본인의 대화형 Claude 한도를 깎는다.** Premium 좌석이라 여유는 있지만 공유는 공유다.
   → §5.3의 **일일 호출 상한 가드가 선택이 아니라 필수**가 된다. 기본 30건으로 시작하고
   실사용 한 달 뒤 조정한다.
2. **Biz의 좌석이 회수·변경되면 봇이 멈춘다.** 담당자 교체 시 인수인계 항목에
   "봇 토큰 재발급"을 명시한다.

**B로의 이전 경로는 열어 둔다.** 토큰은 환경변수 하나이므로 좌석을 추가하고
`CLAUDE_CODE_OAUTH_TOKEN`만 갈아끼우면 끝이다. 코드 변경 없음.
봇 사용량이 본인 작업을 방해하기 시작하는 시점이 이전 신호다.

Anthropic이 "공유 프로덕션 자동화는 API 키를 쓰라"고 권한 문단이 있으나, 그것은 **보류된 변경
안내문 안에 있고 구독 사용을 금지하는 규정이 아니다.** 월 15건 규모에서는 구독 인증으로 간다.

#### ⚠️ Team 플랜 특유의 함정 둘

**1. `usage credits`가 켜져 있으면 정액제를 벗어난다.**
Team 플랜은 좌석 한도를 다 쓴 뒤에도 usage credits가 활성화돼 있으면 **API 요율로 계속 과금**된다.
"정액제로 간다"는 이번 결정의 취지와 정면으로 어긋난다.
→ 봇 계정에 대해 usage credits 설정을 확인하고, §5.3의 **일일 호출 상한 가드를 반드시 켠다.**
한도에 닿으면 과금으로 넘어가는 게 아니라 **멈추고 알리는 것**이 기본 동작이어야 한다.

**2. `setup-token`은 조직 강제를 적용하지 않는다.**
관리자가 `forceLoginOrgUUID`로 로그인 조직을 제한해도, `claude setup-token`은 `forceLoginMethod`만
적용하고 조직은 확인하지 않는다 — **엉뚱한 조직(개인 계정)에서 토큰이 발급될 수 있다.**
발급 직후 `claude /status`로 조직·이메일이 팀 계정인지 확인하고, 그 값을 운영 문서에 적어 둔다.

#### 모델

기본 `claude-sonnet-5`. 추출 품질이 부족하면 상향.
**정확한 모델 ID는 코드 작성 시점에 재확인한다** — 후보는 `claude-sonnet-5`/`claude-opus-5`/`claude-fable-5`.

### 5.4 확인된 제약

| 제약 | 영향 | 대응 |
|---|---|---|
| 호출마다 CLI 바이너리 스폰, **≈12초 오버헤드**. daemon 모드 미구현 | 월 15건이면 무시 가능 | Slack에 “처리 중” 즉시 응답 후 비동기 처리. 이미 bot이 하던 방식 |
| **구독 사용량이 본인 한도와 같은 풀** | 봇이 폭주하면 사람이 Claude를 못 씀 | 직렬화·재시도 상한·일일 상한 (§5.3) |
| **OAuth 토큰 1년 만료, 만료 경고 없음** | 어느 날 조용히 죽음 | `/readyz`에 잔여일 체크 + 30일 전 DM (§5.3) |
| Docker에서 네이티브 바이너리 누락(`spawn claude ENOENT`) 사례 | 컨테이너 배포 실패 가능 | npm optional dependency 설치 보장 + `pathToClaudeCodeExecutable` 명시. CI에 컨테이너 내 실호출 스모크 테스트 추가 |
| temperature 등 생성 파라미터 제어 문서 미확인 | 완전한 결정성 확보 불가 | 결정성은 **코드 조립**이 보장한다. 모델 출력은 스키마+검산으로 가둔다 |
| 동시성 지침 문서 미확인 | 동시 요청 시 프로세스 폭증 | 큐 직렬화 (동시 1건). 월 15건에 충분 |

---

## 6. 충돌 지점과 해소

### 6.1 facts 스키마가 둘이다
bot은 별도 `fieldEvidence` 맵에 11필드의 `{status, evidence}`를 모아두고, agent는 24필드를 각각
`{value, evidence}`로 감싼 위에 자격 조건에 `{text, sourced}`까지 붙인다.
→ **agent 스키마 채택.** bot의 모달·보완 파서는 24필드 기준으로 재작성한다(§3).
`scripts/gen-schema.mjs`가 계속 단일 출처. 스키마 파일은 손으로 고치지 않는다.

### 6.2 공고 본문을 누가 쓰는가
bot은 모델이 `title`/`responsibilities`/`requirements`를 직접 쓴다. agent는 코드가 조립한다.
→ **코드 조립 채택.** bot의 `domain/job-post.js`·`prompts/generate-job-post.js`·
`formatters/slack-job-post.js` 폐기. 이건 타협하지 않는다.

### 6.3 ★비공개 정책 vs 커리어데이 필수 필드 (가장 큰 충돌)

커리어데이 폼은 `compensation.totalAmount`를 **게시 필수값으로 검증**하고(`validateCareerdayDraft`의
`missingFields`), 상세주소는 검증 없이 `draft.location` 문자열을 그대로 넣는다 — 즉 **정확한 주소가
아무 방어 없이 외부 채용 사이트로 나간다.** 비공개 정책은 둘 다 막는 쪽이다.

게다가 현재 bot 코드는 **완성된 JD 문자열을 정규식으로 역파싱해서** 값을 만든다.
`extractDates(draft.schedule)`로 날짜를 긁고, `parseDailyCompensation(draft.compensation, …)`으로
`일급 × 날짜 개수`를 계산하고, `extractRegion(draft.location)`으로 시·도를 매칭한다.
새 JD에는 금액이 없으므로 `totalAmount: null`이 되어 게시 필수값 검증에서 막힌다.

해소: **게시 프로파일(publishing profile)** 을 도입하고, 채널별 산출물을 facts에서 각각 조립한다.
JD를 역파싱하는 경로는 완전히 제거한다.

```
facts (추출된 사실, 고객사 예산·정확주소 포함 — 리포트에만 표시)
  │
  ├─ profile:slack     → 고객사명 ✕ / 금액 ✕ / 주소 시·군·구 / 목표·커리큘럼 ✕ (topics 4~6개)
  └─ profile:careerday → 플랫폼 필수값 포함
                         · 강사료 = publishingInput.offerAmount   ← 담당자 입력
                         · 상세주소 = publishingInput.venueAddress ← 담당자 입력
```

`publishingInput`은 운영 조건 파일 또는 Slack 모달로 담당자가 넣는 값이다.
**원문 금액(고객사 예산)이 커리어데이로 흘러가는 경로는 코드상 존재하지 않게 만든다.**
`verify.mjs`의 금액 누출 차단 규칙을 커리어데이 렌더에도 건다 — 단 통과 조건은
“`offerAmount`에서 유래했는가”이지 “금액이 없는가”가 아니다. 테스트로 강제한다.

### 6.4 승인 지점 단일화 — 확정 (2026-08-24)
Slack 자동 게시를 살리는 순간 승인은 Slack 버튼이어야 한다. 시트 드롭다운·CLI `approve`를
남기면 세 곳이 같은 행의 상태를 바꾼다.

| 경로 | 통합 후 |
|---|---|
| Slack [승인]/[반려] 버튼 | **유일한 공개 승인 지점** |
| 구글 시트 상태 드롭다운 | 읽기 전용 표시로 변경. 편집 잠금 |
| CLI `approve`/`reject` | **제거** |
| 커리어데이 초안 승인 | 남김. 단 이것은 “2차 채널 게시 승인”이지 공고 승인이 아님 |

`postable=0`(=`[확인 필요]` 잔존) 게이트는 그대로 유지한다. **Slack 버튼을 눌러도 코드가 거부한다.**
버튼은 권한이지 우회가 아니다.

### 6.5 게시 대상이 바뀔 예정이다
메모리에 “게시 대상은 자체 커뮤니티로 바뀔 예정. 채널에 깊게 결합하지 말 것”이 있다.
→ `adapters/publisher/` 인터페이스로 추상화한다.

```js
// publish(runId, renderedPost) → { url, postedAt, externalId }
```
`slack-publisher`, `careerday-publisher`가 지금의 구현체이고, 커뮤니티 게시는 나중에
어댑터 하나 추가로 끝난다. `apps/bot.mjs`는 Slack API를 직접 부르지 않는다.

### 6.6 커리어데이는 컨테이너 안에서 못 돈다
로그인 세션이 붙은 호스트 브라우저가 필요하다. 현재 bot 러너는 **호스트 로컬 SQLite를 먼저 보고,
없으면 `docker exec`로 컨테이너 안 `/app/data/recruitment.sqlite`를 읽는 폴백**을 쓴다.
`compose.yml`이 바인드가 아닌 named volume을 쓰기 때문인데, 두 저장소가 갈라질 수 있어 취약하다.
→ **SQLite를 호스트 볼륨 바인드 마운트로 옮기고** 컨테이너와 호스트 러너가 같은 파일을 본다.
`docker exec` 경로는 제거. `node:sqlite`는 WAL 없이 동시 쓰기에 약하므로 러너는
**읽기 + 상태 1회 갱신**만 하고 긴 트랜잭션을 잡지 않는다.

### 6.7 구글 시트와 Notion이 겹친다

| | 역할 | 쓰기 주체 |
|---|---|---|
| 구글 시트 | 성과 기록(지원자 수·최종 채널), 45~60건 누적 판단 근거 | 담당자 + `sync` |
| Notion | 현황 미러. 팀 공유용 **읽기 전용** | 봇 단방향 |

**Apps Script 이메일 시간 트리거는 끈다.** 상주 봇이 생기면 알림 주체가 둘이 되어 중복 발송된다.
알림 소유는 봇 하나. `sheets_recorded_at`으로 소유자를 나누던 로직은 제거한다.

### 6.8 PDF 추출기
agent는 `pdftotext`(poppler 바이너리), bot은 `pdf-parse`(npm).
→ **pdf-parse 채택.** Docker 이미지에 poppler를 넣지 않아도 되고 이미 의존성에 있다.
`core/`는 의존성 0을 유지하므로 `adapters/documents/pdf.mjs`에만 둔다.
참고: 양쪽 다 **DOCX를 지원하지 않는다**(agent `files.mjs`는 `.txt/.md/.pdf`만).
계정 스킬 설명에는 DOCX가 있으므로, 필요하면 별도 항목으로 잡아야 한다.

### 6.9 jd-writer 원본이 둘이다
계정 스킬 `jd-writer`(서식 원본) ↔ `skills/jd-writer/SKILL.md`(서버 실행본).
통합 후에도 이 이중화는 남는다. **서식을 바꾸면 두 파일을 함께 고쳐야 한다**는 제약도 그대로.
차이 표는 README에 유지하고, `## Rules` 아래에 써야 주입된다는 함정도 테스트로 계속 잡는다.

---

## 7. 통합 상태머신

```
             ┌──────────────┐
             │review_pending│  생성·검증 통과. 아직 아무 데도 안 나감
             └──┬────────┬──┘
     Slack 승인 │        │ Slack 반려
                ▼        ▼
           ┌────────┐ ┌────────┐
           │approved│ │rejected│
           └───┬────┘ └────────┘
     봇이 게시 │
               ▼
          ┌─────────┐  슬랙 게시 완료 + 3영업일 후 날짜 계산
          │completed│
          └────┬────┘
   3영업일 경과 │
               ▼
        ┌──────────────┐  담당자 DM 1회
        │follow_up_due │
        └───┬───────┬──┘
  지원자충분 │       │ 부족 → 커리어데이
             ▼       ▼
        ┌───────┐ ┌──────────────────┐
        │closed │ │careerday_pending │  폼값 승인됨, 아직 미등록
        └───────┘ └────────┬─────────┘
                사람이 등록 │
                           ▼
                  ┌─────────────────┐
                  │careerday_posted │ → 그래도 없으면 전화(수동, outcome 기록)
                  └─────────────────┘
```

신규 상태 3개: `careerday_pending`, `careerday_posted`, `closed`.
전이 규칙은 `core/state.mjs` 한 곳에 두고 테스트로 잠근다. 검증 실패 생성은 **어떤 상태도 갖지 않는다**(DB 미기입).

---

## 8. 데이터 모델

`recruitment_runs` 단일 테이블 유지. `COLUMNS` 배열만 고치면 CREATE와 마이그레이션이 함께 읽는
기존 방식 그대로. 추가 컬럼은 **nullable 또는 DEFAULT 필수**(ALTER TABLE 제약).

| 추가 컬럼 | 용도 |
|---|---|
| `slack_channel_id`, `slack_message_ts`, `slack_permalink` | 자동 게시 결과 (bot에서 이관) |
| `created_by_user_id` | DM 투하한 사람 = 알림 수신자 |
| `publishing_input_json` | `offerAmount`, `venueAddress` 등 담당자 입력값 (§6.3) |
| `careerday_draft_json`, `careerday_posted_at` | 커리어데이 초안·등록 시각 |
| `notion_page_id` | 미러 멱등 갱신용 |

bot의 `recruitments` 테이블은 마이그레이션하지 않는다. 계약이 달라 재생성이 안전하고,
`recruitment.pre-demo.sqlite`는 데모 잔여물이다. agent의 기존 `data/recruitment.sqlite`도
`postable=0`으로 마이그레이션되어 승인되지 않으므로 사실상 아카이브다.

---

## 9. 이관 단계

각 단계는 **`npm test`가 초록일 때만** 다음으로 넘어간다.

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **P0** 뼈대 | 새 레포 생성, `core/` 이관, 테스트 120개 경로 수정 | `npm test` 초록, `core/`에 의존성 0 |
| **P1** 모델 교체 | `adapters/llm/claude-agent.mjs` 작성, `claude.mjs` 폐기, 구독 토큰 인증 | 동일 커리큘럼으로 CLI판과 SDK판 facts 비교 → 차이 없음. `--dry-run` 동작. **`ANTHROPIC_API_KEY`가 설정된 상태에서 부팅하면 중단되는지 테스트** |
| **P2** 프로파일 | `publishing-profile.mjs`, `render/careerday.mjs`, 금액·주소 누출 테스트 | 원문 금액이 커리어데이 산출물에 나타나면 테스트 실패 |
| **P3** Slack | 인테이크·모달·미리보기·승인 버튼·게시·알림. publisher 추상화 | 실 워크스페이스에서 PDF→게시 1건 완주 |
| **P4** 2차 채널 | Notion 미러, 시트 성과 기록, 커리어데이 러너. **러너와 store 어댑터는 같이 처리**(러너가 `RecruitmentRepository`를 임포트하므로 따로 옮기면 깨진다) | 3영업일 알림 → 커리어데이 폼 입력까지 1건 완주. **Playwright 셀렉터 실검증 포함** |
| **P5** 배포 | Docker(호스트 볼륨 SQLite), 헬스체크, CI | 컨테이너 내 Agent SDK 실호출 스모크 통과 |

되돌릴 지점: P1까지는 기존 두 레포가 그대로 살아 있다. P3에서 슬랙 자동 게시가 막히면
publisher를 “클립보드용 텍스트 출력”으로 바꿔 복붙 방식으로 후퇴할 수 있다 — 이게 §6.5 추상화의 보험이다.

---

## 10. 폐기 목록

- bot: `llm/**`, `prompts/**`, `domain/job-post.js`, `domain/recruitment-facts.js`,
  `formatters/slack-job-post.js`, `recruitments/recruitment-repository.js`,
  일회성 CLI 4개, gemini/openai provider 테스트, `.env`의 `GEMINI_*`/`OPENAI_*`
  — **`.env.example`에 `ANTHROPIC_API_KEY` 항목을 만들지 말 것**(§5.3: 있으면 구독 토큰이 무시된다)
  — **`recruitments/review-schedule.js`는 통째로 지우지 말 것**(§3, `readReminderConfig`)
- agent: `src/lib/claude.mjs`, CLI `approve`/`reject`, `sheets_recorded_at` 알림 분기
- 공통: Apps Script 이메일 시간 트리거, `openclaw/` (오픈클로 제외 결정 유지), `docker exec` SQLite 우회
- 데이터: `recruitment.pre-demo.sqlite`, `data/_incoming-*.tgz`

**정리 전에 할 일:** `CLAUDE_CODE_OAUTH_TOKEN`은 1년짜리 구독 자격증명이다 — 유출되면
Biz 계정의 모델 요청 권한이 그대로 넘어간다. 코드·git·채팅에 넣지 않는다.
두 레포 모두 `.env`에 실제 토큰이, slack-bot에는 `.private/careerday-browser/`
크롬 프로필 전체가 들어 있다. 새 레포 `.gitignore`에 먼저 넣는다.
agent 레포는 현재 `.env`·`.sqlite`·`.tgz`가 트래킹되지 않음을 확인했다.
**slack-bot 레포는 히스토리 확인이 남아 있다.**

---

## 11. 리스크와 미결정

| # | 항목 | 성격 | 필요한 것 |
|---|---|---|---|
| 1 | 슬랙 앱 설치·게시 권한 | **해결** | 확보 확인 (2026-08-24) |
| 2 | 승인 지점 Slack 단일화 | **해결** | 동의 확인 (2026-08-24, §6.4) |
| 3 | Agent SDK Docker 바이너리 | 기술 리스크 | P5 전에 컨테이너 스모크 테스트 선행 |
| 4 | 최신 모델 ID 확정 | 사실 확인 | 코드 작성 시점 모델 목록 재확인 (§5.3) |
| 4-b | 봇 토큰 계정 | **해결** | Biz Premium 좌석(안 A) 확정. 일일 상한 가드 필수, B로 이전 경로 유지 (§5.3) |
| 4-c | 구독 플랜 등급 | **해결** | Team Premium 좌석 확인 (2026-08-24) |
| 4-d | **봇 계정의 usage credits 활성화 여부** | 확인 필요 | 켜져 있으면 한도 초과분이 API 요율로 과금된다 (§5.3) |
| 5 | 새 레포 이름·위치 | 미정 | `instructor-recruiting` 제안 |
| 6 | 서버 위치 | 기존 미해결 | 사내 PC / 클라우드 VM / 맥미니 |
| 7 | 주강사도 슬랙 전환 대상인가 | 기존 미해결 | 계정에 `instructor-matcher`·`proposal-to-instructor` 존재 |
| 8 | 커리어데이 일괄등록·제휴 API | 기존 미해결 | 문의 회신에 따라 §6.6 대체 가능 |
| 9 | 로컬 Node v22 vs `engines: >=24` | 환경 | Agent SDK 요구 버전 확인 후 확정 |
| 10 | 디바이스 브리지 unlink 금지 | 환경 | 새 레포도 같은 제약. `rm`/`mv` 대신 `cat src > dest` |

---

## 부록 — 이 통합으로 실제로 좋아지는 것

1. **모델 공급자 3개 → 1개.** 프롬프트·검증이 두 벌로 갈라져 있던 것이 하나가 된다.
2. **커리큘럼 완성 → 구인 시작 사이의 사람 손이 사라진다.** 지금은 CLI를 아는 사람만 시작할 수 있다.
3. **금액·고객사 누출 방어가 커리어데이까지 확장된다.** 현재 bot 경로에는 이 방어가 아예 없다.
4. **성과 데이터가 한 테이블에 모인다.** 슬랙·커리어데이·전화 세 채널의 지원자 수가 같은 행에 쌓여야
   “전화를 끊어도 되는지”를 45~60건 뒤에 판단할 수 있다. 지금은 채널별로 흩어져 판단이 불가능하다.

4번이 이 프로젝트의 원래 목적이다. 나머지는 그것을 위한 수단이다.
