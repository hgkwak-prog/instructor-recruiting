# 강사 구인 자동화

커리큘럼·제안서 파일을 슬랙 봇에 보내면, 담당자가 운영사항(장소·인원·일정 등)을
입력한 뒤 강사 구인 공고 초안을 만든다. 담당자가 검토·수정하고 승인 버튼을 눌러야만
지정 채널에 게시된다 — 자동 게시 단계는 없다.

교육 사업 전체 라이프사이클(문의 → 제안 → 강사 섭외 → 교육 → 사후관리) 중
**강사 구인** 한 조각만 다룬다. 목적은 공고 작성 자동화 자체가 아니라, 채용 채널을
"강사 풀에 전화 돌리기"에서 "슬랙 공고"로 바꾸는 것이다. 규모는 월 15건 수준.

> **비개발자용 사용법은 [USAGE.md](./USAGE.md)에 따로 있다.** 이 문서는 개발/운영
> 참고용이다.
>
> **왜 지금 이 구조인가**는 [`CLAUDE.md`](./CLAUDE.md)(원칙·제약)와
> [`HANDOFF.md`](./HANDOFF.md)(현재 상태·다음 할 일)를 먼저 볼 것. 이 문서는 그 둘과
> 어긋나면 안 되고, 어긋난다면 이 문서가 낡은 것이다.
>
> [`INTEGRATION-DESIGN.md`](./INTEGRATION-DESIGN.md)는 2026-08-24에 두 레포를 합칠 때
> 쓴 설계서다 — 그 이후 v1 재기획(2026-09-04, 아래 참고)에서 여러 결정이 뒤집혔으니
> **역사적 기록으로만** 읽을 것.

---

## 지금 상태

```bash
npm install
npm test           # 236개
npm run check      # 구문 검사
npm run core:deps  # core/ 의존성 0 검사
```

2026-08-24에 두 레포(`assistant-instructor-recruiting-agent`, `slack-recruiting-bot`)를
하나로 합쳤고, 2026-09-04에 한 번 재기획했다. 재기획에서 **검산기·`postable` 게이트·
HTML 리포트·리마인더·호출 예산·시트 동기화를 전부 없앴다** — 모든 생성 결과는 무조건
검토대기로 들어가고, 사람이 눈으로 보고 승인 여부를 정한다. 이 결정은 `CLAUDE.md`의
"v1 범위 결정"에 있고, 재논의 대상이 아니다.

즉 아래는 **지금 레포에 없다**: 자동 검산(`postable`), `data/reports/*.html` 리포트,
3영업일 리마인더, 구글 시트/Notion 동기화, 하루 호출 상한·직렬화. 다른 문서나 옛
커밋 메시지에서 이런 언급을 보면 v1 이전 얘기다.

## 써보기 — CLI

CLI는 **추출 검증용**이다. 실제 게재 흐름은 Slack 봇을 통해서만 나간다(아래 참고).
CLI에는 승인 명령이 없다.

```bash
npm run recruit -- init

# 모델을 부르지 않고 실제로 보낼 프롬프트만 남긴다
npm run recruit -- generate --source ./커리큘럼.pdf --dry-run

# 진짜 실행 (구독 토큰 필요). --conditions는 선택 — 생략하면 순수 추출만 한다
npm run recruit -- generate --source ./커리큘럼.pdf --conditions ./ops.json

npm run recruit -- list
npm run recruit -- show --run-id <id>
npm run recruit -- careerday-prepare --run-id <id> --deadline 2026-09-30
```

**PDF · HTML · MD · TXT**를 받는다. 시스템에 따로 설치할 것은 없다(`pdf-parse`, npm
패키지). HTML은 태그를 벗기고 글만 뽑는다(`core/html-text.mjs`) — 인라인 CSS·JS가
본문보다 긴 제안서 덱을 그대로 넣으면 태그 뭉치에 구독 한도를 태우고 정확도도 떨어진다.

입력이 12만 자를 넘으면 **자르지 않고 거절한다.** 조용히 잘린 커리큘럼에서 뽑은
사실은 틀린 줄도 모르고 공고로 나간다.

`--conditions`를 생략하면 커리큘럼만으로 모델이 무엇을 뽑는지 그대로 보인다 — 흐름을
검수할 때는 이쪽이 낫다. 그 대신 공고에는 `[확인 필요]`가 남을 수 있다.

`ops.json`은 봇 모달에 넣을 값과 같은 어휘다:

```json
{
  "instructorRole": "보조강사",
  "location": "실제 교육 장소",
  "headcount": 1,
  "dailySchedule": "10:00-17:00",
  "workingHours": "09:30-17:30",
  "applicationMethod": "실제 지원 경로",
  "deadline": "2026-09-30",
  "deadlineTime": "18:00",
  "travelExpenseIncluded": false,
  "explicitRequirements": ["경력 5년 이상"],
  "customerDisclosure": "hidden"
}
```

한 건이 끝나면 `data/runs/<run-id>/`에 **단계별로** 남는다(검산기가 없어졌으므로
`verification.json`은 더 이상 생기지 않는다).

| 파일 | 무엇을 확인하나 |
|---|---|
| `curriculum.txt` | 파서가 뽑은 텍스트. PDF·HTML이 무엇으로 바뀌었는지 |
| `prompt.txt` | 모델에 보낸 글자 그대로 (전역 규칙) |
| `schema.json` | `outputFormat`으로 함께 보낸 스키마 — 항목별 지시는 여기 `description`에 있다 |

모델이 받는 지시는 **두 곳에서** 온다. `prompt.txt`만 보면 절반이다 — 항목별 기준은
스키마의 `description`에 있다.

`generate`(운영조건 포함, dry-run 아님)를 실제로 돌리면 `data/recruitment.sqlite`에
검토대기 건으로 기록되고, 공고 본문이 콘솔에 JSON으로 출력된다. `show --run-id`로
언제든 다시 볼 수 있다.

## Slack 봇

```bash
cp .env.example .env    # 토큰과 채널을 채운다
npm run bot
```

```
DM에 커리큘럼 파일 → [운영사항 입력] → 사실 추출(진행 로그 실시간 표시)
                                        → 공고 조립 → 검토 미리보기
                                        → [강사료 입력·본문 편집] → [승인]/[반려] → 게시
```

### 운영사항을 먼저 묻는 이유

커리큘럼은 **제안서 단계 산출물**이다. 고객사에 보여주려고 만든 문서라 강사 운영에
필요한 사실이 원래 안 적혀 있고, 적혀 있어도 계약·일정 조율을 거치며 바뀐다.
장소가 옮겨지고 인원이 조정되는 것은 사고가 아니라 정상이다.

파일을 받은 자리에서 바로 묻고, **담당자가 넣은 값이 커리큘럼을 이긴다.** 덮어쓴
항목은 `원문 "서울 성동구" → 입력 "서울시 강남구"`로 미리보기에 남는다. 사람이 넣은
값은 모델이 추측한 것이 아니므로 형식만 검사하고 내용은 검사하지 않는다.

| 받는 것 | 비고 |
|---|---|
| 역할 · 장소 · 인원 · 교육 시간 · 지원 방법 | 필수 |
| 근무 시간 · 마감일 · 출장 여부 | 선택 |
| **고객사 명시 요구사항** (경력 연차·도메인 경력 등) | 선택, 여러 줄. 원문에서 나올 수 없는 종류라 모델이 지어내지 못하게 막아 둔 값을 담당자가 직접 채운다(2026-09-08 추가) |

지난 입력을 기억해 다음 건에 미리 채워 둔다 — **사람이 실제로 친 값만.** 어떤
기본값도 미리 넣지 않는다. 미리 채워 두면 담당자가 확인 없이 넘기고, 그 순간 출처
없는 값이 공고가 된다.

> **운영 조건 파일(`RECRUIT_CONDITIONS_PATH`)은 봇에서 없앴다.** 부팅 때 읽어 모든
> 건의 기본값으로 쓰던 것인데, 그 값들은 출처 없이 검산(형식 검사)을 통과했다.
> 설정돼 있으면 부팅이 멈춘다. CLI의 `--conditions`는 남는다 — 실행할 때마다
> 명시적으로 지정하는 인자라 어디서 왔는지가 명령줄에 그대로 보인다.

### 처리 중 진행 로그 (2026-09-08 추가)

운영사항을 제출하면 슬랙 메시지 하나가 뜨고, 처리되는 동안 **그 메시지가 계속
갱신되며** 실제 단계를 보여준다. 시간 기반 타이머가 아니라 SDK가 실제로 스트리밍하는
이벤트에 맞춰 갱신한다(`adapters/llm/claude-agent.mjs`의 `onMessage`).

```
⏳ 파일 읽는 중 → ⏳ 프롬프트 조립 중 → ⏳ 모델 세션 시작
→ ⏳ 모델 응답 생성 중 (n번째 응답 조각) → ⏳ 공고 조립 중 → ✅ 완료
```

대형 문서는 1분 넘게 걸릴 수 있다. 30초 넘게 신호가 없으면 워치독이 한 번 알려준다
(반복 티커 아님).

### 흐름을 검수하려면 — CLI가 낫다

봇은 Slack UI라 결과만 보인다. **무엇이 어디서 틀어졌는지 보려면 CLI로 같은 걸
돌린다.** 두 경로는 같은 `core/`를 쓰고 `applyConditions`도 같은 옵션으로 부르므로,
CLI에서 본 결과가 곧 봇 동작이다.

```bash
npm run recruit -- generate --source ./커리큘럼.pdf --dry-run
cat data/runs/<run-id>/prompt.txt
cat data/runs/<run-id>/schema.json
```

무엇이 잘못됐을 때 이 순서로 좁힌다. `curriculum.txt`가 이상하면 파서 문제, 모델
호출 결과(`result_json`, DB 안)가 틀렸으면 모델 문제, 둘 다 맞는데 공고가 이상하면
`core/render/job-post.mjs` 문제다.

### 부팅 배너를 반드시 확인할 것

테스트 워크스페이스와 실제 워크스페이스의 설정이 두 벌 존재하게 된다. 그래서 뜰 때
**어디에 쏠 것인지** 크게 찍는다.

```
┌────────────────────────────────────────────────
│ 워크스페이스 : 모두의연구소 (T0123ABCD)
│ 봇          : @recruiting-bot
│ 게시 채널   : #강사구인 (C09CFRJLE7Q)
│ 게시 모드   : slack (실제 게시)
└────────────────────────────────────────────────
```

봇이 채널에 없으면 `← 봇이 채널에 없습니다!`가 붙는다. 게시 직전이 아니라 **부팅
때** 알려주는 것이 요점이다.

`PUBLISH_MODE=clipboard`로 두면 글을 쏘지 않고 흐름만 끝까지 돈다. 새 워크스페이스
에서 처음 돌릴 때 이걸로 한 번 확인하고 `slack`으로 바꾸는 편이 안전하다.

### Slack 앱에 필요한 설정

| 항목 | 값 |
|---|---|
| Socket Mode | 켬 → App-Level Token (`connections:write`) = `SLACK_APP_TOKEN` |
| Bot Token Scopes | `chat:write`, `files:read`, `im:history`, `im:write`, `channels:read`, `groups:read` |
| Event Subscriptions | `message.im` |
| Interactivity | 켬 (버튼·채널 선택이 여기로 온다) |

게시할 채널에 **봇을 초대**해야 한다(`/invite @봇이름`). 비공개 채널이면
`groups:read`도 필요하다.

### 승인 명령이 없는 이유

`approve` / `reject` / `mark-complete` / `outcome` / `due-reminders`를 CLI에 치면
"Slack에서 합니다"라고 답하고 종료 코드 2로 끝난다. 빠뜨린 게 아니라 뺀 것이다 —
공개 승인 지점이 둘이 되면 같은 행의 상태를 두 곳에서 바꾸게 되고, 그 경합은 나중에
재현하기 어려운 버그가 된다. 승인은 Slack 버튼 하나로 간다.

의존성은 `@anthropic-ai/claude-agent-sdk`, `@slack/bolt`, `dotenv`, `pdf-parse`,
`playwright`뿐이고, `core/`는 여전히 의존성 0이다.

---

## 인증 — 정액제 구독으로 돈다

종량제 API 키가 아니다. `claude setup-token`으로 1년짜리 구독 토큰을 발급해 쓴다.

```bash
claude setup-token                       # 브라우저 승인 → 토큰이 터미널에 출력된다
export CLAUDE_CODE_OAUTH_TOKEN=<토큰>     # 어디에도 저장되지 않으니 직접 복사할 것
```

**`ANTHROPIC_API_KEY`를 환경에 두지 말 것.** 인증 우선순위가

```
ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY > apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN > /login
```

이라서, 이 키가 있으면 **구독 토큰이 조용히 무시되고 종량 과금된다.** 조용한 게
문제다. 그래서 `adapters/llm/guards.mjs`가 부팅 때 감지하고 중단한다.

SDK 사용량은 별도 크레딧이 아니라 **구독 사용 한도에서 차감**된다 — 담당자가
대화형 Claude·Cowork를 쓰는 것과 **같은 풀**이다. 지금 코드에는 하루 호출 상한이나
동시 호출 직렬화가 **없다** — v1 재기획에서 "호출 예산" 계열 기능을 없앴다. 월 15건
규모에서는 문제로 드러난 적이 없지만, 동시에 여러 건이 몰리면 그만큼 한도를 빨리
쓴다는 점은 알아 둘 것.

### 토큰은 1년 뒤 조용히 죽는다

만료 경고는 `/login` 자격증명에만 뜨고 `CLAUDE_CODE_OAUTH_TOKEN`에는 안 뜬다.
발급일(`CLAUDE_CODE_OAUTH_TOKEN_ISSUED_AT`)을 적어 두면 `/readyz`가 남은 날짜를
알려준다. 11개월 시점에 재발급한다.

---

## SDK를 에이전트로 쓰지 않는다

`adapters/llm/claude-agent.mjs`의 `ISOLATION_OPTIONS`가 모델을 가둔다. 하나라도
빠지면 추출기가 아니라 에이전트가 된다.

| 설정 | 이유 |
|---|---|
| `allowedTools: []` | 파일·bash 접근 차단 |
| `permissionMode: 'dontAsk'` | 허용 목록 밖은 묻지 않고 거부 |
| `maxTurns: 4` | 대화는 아니지만, 구조화 출력 자체 재시도(SDK 내부)가 추가 왕복을 필요로 한다. 작은 예시 커리큘럼은 1턴에 끝나지만 실제 크기 제안서 PDF는 1로는 막혔다(2026-09 재현) — **작은 예시로 통과했다고 원인을 확정하지 말 것** |
| `settingSources: []` | **SDK 격리 모드.** 빼면 `~/.claude/settings.json`과 CLAUDE.md를 읽어 **개발자의 로컬 설정이 추출 결과에 새어든다** |
| `systemPrompt: <문자열>` | `preset: 'claude_code'`를 쓰면 SDK 기본 프롬프트가 섞인다 |

`outputFormat: { type: 'json_schema' }`로 출력을 강제하지만 **로컬에서 다시
검증한다.** 계약이 깨졌을 때 조용한 null이 흘러가는 것보다 시끄럽게 실패하는 편이
낫다.

SDK가 실제로 스트리밍하는 메시지(`system`/`assistant`/`result`)는 `onMessage`
콜백으로 그대로 넘길 수 있다 — 슬랙 진행 로그가 이걸 쓴다(위 참고).

### `estimatedCostUsd`는 청구액이 아니다

SDK가 돌려주는 `total_cost_usd`는 타입 정의가 직접 못 박아 둔 대로 *"An estimate,
not a billing statement"* — 이번 호출이 쓴 토큰을 **API 표준 요율로 환산하면
얼마인지**를 알려주는 값이다. 구독 인증으로 도는 한 실제로 빠지는 것은 **구독 사용
한도**이고, 그 한도는 달러로 표시되지 않는다. 그래서 코드에서는 이 값을
`estimatedCostUsd`로 부른다. 토큰 소비량의 대리 지표로만 쓴다.

---

## 구조

```
core/       외부 I/O 없음, 의존성 0, 테스트 대상 전부
  schema.mjs        facts 스키마 검증
  derive.mjs        물류 자격·담당 업무 표준세트·주소 일반화
  dates.mjs         영업일 계산 (Asia/Seoul)
  conditions.mjs    운영 조건이 빈 사실을 채움
  compensation.mjs  강사료 줄 조립 (단가 × 시수)
  html-text.mjs     HTML에서 태그를 벗기고 글만 남김
  paths.mjs         데이터 디렉터리
  env.mjs           환경변수 읽기 (빈 문자열도 "설정 안 함"으로 취급)
  render/
    job-post.mjs    슬랙 공고 본문 조립
    careerday.mjs   커리어데이 폼값 조립

adapters/   외부 I/O. 여기만 의존성을 가진다
  llm/          claude-agent(Agent SDK 호출) · prompt · guards(인증 검사)
  slack/        intake · operations-modal · edit-modal · preview
  store/        database.mjs (node:sqlite)
  publisher/    slack 게시 / clipboard 후퇴 경로
  documents/    files.mjs (pdf-parse)
  careerday/    site-adapter.mjs (Playwright 셀렉터)
  server/       health.mjs (/healthz, /readyz)

apps/       bot.mjs (Slack 상주) · cli.mjs (운영자) · careerday-runner.mjs (호스트 전용)
skills/jd-fact-extraction/SKILL.md   전역 규칙. `## Rules` 이하가 프롬프트에 주입된다
schemas/    항목별 추출 기준(각 필드의 description)이 여기 있다.
            scripts/gen-schema.mjs로 생성 — 손으로 고치지 않는다
```

### core의 의존성 0은 규칙이 아니라 검사다

`npm run core:deps`가 `core/`의 모든 import를 훑어 **node: 빌트인과 core 내부 상대
경로만** 허용한다. npm 패키지나 `../adapters`로 나가는 참조가 있으면 종료 코드
1로 실패한다.

Slack 클라이언트 하나를 core에 들이는 순간 테스트가 네트워크를 타기 시작한다.
사람 눈으로 막을 일이 아니라서 스크립트로 막는다.

---

## 원칙 (양보하지 않는 것)

**1. 모델은 사실만 추출하고, 공고 본문은 코드가 조립한다.**
날짜·요일·시간 합계·고정 문구는 모델이 쓰지 않는다. 초판에서 화요일을 `(월)`로 적은
공고가 나갔는데, 그건 사후 교정으로 막을 문제가 아니라 모델에게 시키지 말았어야 할
일이었다.

**2. 추출과 게시는 다르다.** 아래는 정확히 추출해 내부적으로는 갖고 있되 **공고에는
안 나간다.**

| 항목 | 이유 |
|---|---|
| 일차별 커리큘럼 설계 | 커리큘럼 설계 자체가 우리가 파는 상품이다 |
| 고객사명 | 대부분 비공개 계약이다. 익명 라벨(A사)조차 안 쓴다 |
| 강사료 금액 | 원문 금액은 **고객사 예산**이다. 강사에게 제시할 금액과 다르다 — 항상 `______`로 빈칸 |
| 정확한 주소 | `서울 성동구 인근`이면 통근 판단에 충분하다 |

**교육 목표는 공개한다**(2026-09 정정) — "무엇을 갖추게 되는가"는 커리큘럼 설계
자체가 아니라 지원자가 자기 역량과 맞는지 판단하는 정보다.

**3. 규칙은 그 규칙이 걸리는 자리에 있다.**

| 규칙 | 사는 곳 | 모델에게 가는 길 |
|---|---|---|
| 항목별 추출 기준 | 각 필드의 `description` | `outputFormat`의 스키마 |
| 전역 규칙 (금액 금지·출력 규약) | `skills/jd-fact-extraction/SKILL.md` | 프롬프트 `[규칙]` 블록 |

한 필드에 붙는 말을 딴 파일에 두면 코드가 바뀌어도 따라오지 않는다. SKILL.md는
`## Rules` **아래**에 써야 주입된다. 위에 쓰면 무시된다.

**4. 승인 없이는 아무것도 나가지 않는다.** 공개 승인 지점은 Slack 버튼 하나다.
CLI에는 승인 명령이 없다.

---

## 커리어데이 — 3영업일 안에 안 붙었을 때 (수동 트리거)

v1에서 자동 감지·리마인더는 없앴다. **담당자가 직접** 판단해서 시작한다.

```bash
npm run recruit -- careerday-prepare --run-id <id> --deadline 2026-09-30 [--address <상세주소>]
npm run careerday -- login            # 1회, 브라우저에서 로그인
npm run careerday -- fill <run-id>    # 등록 화면이 열리고 자동으로 채워진다
npm run careerday -- inspect          # 폼이 깨졌을 때 구조를 다시 뽑는다
```

**호스트에서 돈다.** 봇이 컨테이너에 있어도 이건 사람 컴퓨터에서 실행한다 —
커리어데이는 로그인 세션이 붙은 브라우저가 필요하고 그 세션은 컨테이너에 없다.
**최종 등록 버튼은 사람이 누른다.**

### 채널마다 노출이 다르다

| 값 | 슬랙 공고 | 커리어데이 폼 |
|---|---|---|
| 강사료 | 빈칸 (담당자가 승인 화면에서 입력) | 같은 금액 (담당자 승인값) |
| 주소 | `서울 강남구 인근` | 상세주소 (담당자 입력, 선택) |
| 업무 내용 | 공고 본문 | **같은 본문 그대로** |

커리큘럼 원문의 금액은 고객사 예산이다. facts에 금액 필드가 아예 없어 이 경로로
흘러들 수 없다.

### 폼이 깨졌을 때

셀렉터 14개가 남의 사이트 DOM에 걸려 있다. 언제든 깨진다. `careerday -- inspect`로
현재 구조를 뽑아 `docs/careerday-form-2026-08-24.json`과 diff 하면 무엇이 달라졌는지
보인다. 한 필드가 실패해도 나머지는 계속 채우므로, 절반이라도 채워진 화면에서 사람이
마저 할 수 있다.
