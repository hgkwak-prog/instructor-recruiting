# 강사 구인 자동화

커리큘럼을 넣으면 팀 서식에 맞는 **강사 구인 공고 초안**과 **누락 항목 목록**을 만들고,
담당자가 Slack에서 승인하면 게시하고, 3영업일 뒤 모집 현황을 확인한다.
주강사·보조강사 모두 지원한다.

`assistant-instructor-recruiting-agent`(검산·조립·승인 게이트)와
`slack-recruiting-bot`(Slack 상주·인테이크·게시·커리어데이)을 합친 레포다.

**설계서: [INTEGRATION-DESIGN.md](./INTEGRATION-DESIGN.md)** — 무엇을 왜 이렇게 합쳤는지는 여기 있다.

---

## 지금 상태 — P3 완료

| 단계 | 내용 | 상태 |
|---|---|---|
| **P0** | 뼈대 + `core/` 이관 + 테스트 120개 | ✅ 2026-08-24 |
| **P1** | Claude Agent SDK로 모델 호출 교체 (구독 인증) | ✅ 2026-08-24 · 실호출 검증 완료 |
| **P2** | `apps/cli.mjs` — 커리큘럼 → 검토 리포트까지 돌아감 | ✅ 2026-08-24 |
| **P3** | Slack 인테이크·승인·게시·현황 확인 | ✅ 2026-08-24 · 테스트 워크스페이스 완주 |
| **P4a** | 커리어데이 에스컬레이션 + 게시 프로파일 | ✅ 코드 완료 · **실폼 입력 검증 대기** |
| P4b | Notion 미러 · 시트 성과 기록 | 대기 |
| P5 | Docker 배포 | 대기 |

> 설계서의 원래 P2(게시 프로파일)는 P4로 옮겼다. 두 번째 프로파일인 커리어데이의
> 소비자가 P4에야 생기고, 슬랙 프로파일은 지금 동작 그대로라 당분간 구현체가 하나뿐인
> 추상화가 되기 때문이다. 그보다 **레포를 돌아가게 만드는 쪽**이 먼저였다.

```bash
npm install
npm test           # 265개
npm run check      # 구문 검사
npm run core:deps  # core/ 의존성 0 검사
```

## 써보기

```bash
npm run recruit -- init

# 모델을 부르지 않고 실제로 보낼 프롬프트만 남긴다
npm run recruit -- generate --source ./examples/curriculum.txt \
                            --conditions ./examples/operating-conditions.json --dry-run

# 진짜 실행 (구독 토큰 필요)
npm run recruit -- generate --source ./examples/curriculum.txt \
                            --conditions ./examples/operating-conditions.json

npm run recruit -- list
npm run recruit -- show --run-id <id>
```

`generate`가 끝나면 `data/reports/<run-id>.html`이 나온다. 브라우저로 열면 확인된 사실,
누락 항목, 경고, 완성된 공고를 한 화면에서 보고 복사할 수 있다.

**PDF · HTML · MD · TXT**를 받는다. 시스템에 따로 설치할 것은 없다.

HTML은 태그를 벗기고 글만 뽑아 넣는다(`core/html-text.mjs`). 이 팀의 HTML 산출물은
제안서 덱·리서치 브리프처럼 인라인 CSS·JS가 본문보다 긴 완성 문서라, 그대로 넣으면
태그 뭉치에 구독 한도를 태우고 추출 정확도도 떨어진다. 실제로 682자짜리 덱이 133자로
줄었고 `<!-- 내부: 고객사 예산 -->` 주석도 함께 사라졌다.

표는 셀 사이 탭을, 목록은 글머리표를, 문단은 빈 줄을 남긴다 — 커리큘럼은 구조가
뜻을 나르기 때문이다. 회차 표가 한 줄로 뭉치면 모델이 일정을 못 읽는다.

입력이 12만 자를 넘으면 **자르지 않고 거절한다.** 조용히 잘린 커리큘럼에서 뽑은
사실은 틀린 줄도 모르고 공고로 나간다.

## Slack 봇

```bash
cp .env.example .env    # 토큰과 채널을 채운다
npm run bot
```

DM으로 커리큘럼 파일을 보내면 → 사실 추출 → 공고 조립 → 검토 미리보기가 오고,
[승인하고 게시]를 누르면 봇이 채널에 올린다.

### 부팅 배너를 반드시 확인할 것

테스트 워크스페이스와 실제 워크스페이스의 설정이 두 벌 존재하게 된다.
그래서 뜰 때 **어디에 쏠 것인지** 크게 찍는다.

```
┌────────────────────────────────────────────────
│ 워크스페이스 : 모두의연구소 (T0123ABCD)
│ 봇          : @recruiting-bot
│ 게시 채널   : #강사구인 (C09CFRJLE7Q)
│ 게시 모드   : slack (실제 게시)
└────────────────────────────────────────────────
```

봇이 채널에 없으면 `← 봇이 채널에 없습니다!`가 붙는다. 게시 직전이 아니라
**부팅 때** 알려주는 것이 요점이다.

`PUBLISH_MODE=clipboard`로 두면 글을 쏘지 않고 흐름만 끝까지 돈다.
새 워크스페이스에서 처음 돌릴 때 이걸로 한 번 확인하고 `slack`으로 바꾸는 편이 안전하다.

### Slack 앱에 필요한 설정

| 항목 | 값 |
|---|---|
| Socket Mode | 켬 → App-Level Token (`connections:write`) = `SLACK_APP_TOKEN` |
| Bot Token Scopes | `chat:write`, `files:read`, `im:history`, `im:write`, `channels:read`, `groups:read` |
| Event Subscriptions | `message.im` |
| Interactivity | 켬 (버튼·채널 선택이 여기로 온다) |

게시할 채널에 **봇을 초대**해야 한다(`/invite @봇이름`). 비공개 채널이면 `groups:read`도 필요하다.

### 시운전 데이터 정리

테스트로 만든 건은 `data/recruitment.sqlite`에 그대로 남는다. 이 표가 나중에
**"전화를 끊어도 되는가"를 판정할 성과 데이터**가 되므로, 실사용 전에 비워야
숫자가 오염되지 않는다.

```bash
mv data/recruitment.sqlite data/recruitment.trial.sqlite   # 지우지 말고 옮겨 둔다
```

### 3영업일 현황 확인

게시 후 3영업일이 지나면 **커리큘럼을 올린 사람에게** DM이 간다(승인한 사람이 아니라).
[현황 입력] 버튼으로 슬랙 지원자 수와 최종 결과를 남긴다.

이 알림이 이 프로젝트의 목적 그 자체다. 슬랙 공고로 3영업일 안에 지원자가 붙는지가
**"강사 풀에 전화 돌리기를 끊어도 되는가"** 를 가른다. 45~60건 쌓이면 판단이 선다.
그래서 알림은 재촉이 아니라 숫자를 받아내는 장치이고, **지원자 0명도 반드시 기록해야 한다** —
0이 판단 근거다.

한 건당 **한 번만** 보낸다. 두 번 오면 사람이 무시하기 시작하고, 무시하면 숫자가 안 쌓이고,
숫자가 없으면 애초에 이걸 만든 이유가 없어진다. 그래서 Slack 발송이 실패해도 재발송하지
않는다 — 한 번 덜 가는 쪽이 두 번 가는 쪽보다 낫다.

> **구글 시트 Apps Script의 이메일 시간 트리거는 꺼야 한다.** 예전에는 시트에 기록된 건을
> Apps Script가, 아닌 건을 CLI가 알렸다. 이제 봇이 전담하므로 트리거를 켜 두면 두 번 간다.

`RECRUITMENT_WAIT_DAYS` / `RECRUITMENT_DAY_MODE`(business·calendar) /
`RECRUITMENT_REMINDER_POLL_MS`로 조정한다.

### 승인 명령이 없는 이유

`approve` / `reject` / `mark-complete` / `outcome` / `sync`를 치면 "Slack에서 합니다"라고
답하고 종료 코드 2로 끝난다. 빠뜨린 게 아니라 뺀 것이다 — 공개 승인 지점이 둘이 되면
같은 행의 상태를 두 곳에서 바꾸게 되고, 그 경합은 나중에 재현하기 어려운 버그가 된다.
승인은 Slack 버튼 하나로 간다(설계서 §6.4).

의존성은 `@anthropic-ai/claude-agent-sdk` 하나뿐이고, `core/`는 여전히 0개다.

---

## 인증 — 정액제 구독으로 돈다

종량제 API 키가 아니다. `claude setup-token`으로 1년짜리 구독 토큰을 발급해 쓴다.

```bash
claude setup-token                       # 브라우저 승인 → 토큰이 터미널에 출력된다
export CLAUDE_CODE_OAUTH_TOKEN=<토큰>     # 어디에도 저장되지 않으니 직접 복사할 것
```

**`ANTHROPIC_API_KEY`를 환경에 두지 말 것.** Claude Code의 인증 우선순위가

```
ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY > apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN > /login
```

이라서, 이 키가 있으면 **구독 토큰이 조용히 무시되고 종량 과금된다.** 조용한 게 문제다.
그래서 `adapters/llm/guards.mjs`가 부팅 때 감지하고 중단한다.

### 사용량은 담당자 본인 한도에서 빠진다

SDK 사용량은 별도 크레딧이 아니라 **구독 사용 한도에서 차감**된다. 2026-06-15에 예고됐던
Agent SDK 월 크레딧은 보류돼 제공되지 않는다. 그 한도는 담당자가 대화형 Claude·Cowork를
쓰는 것과 **같은 풀**이라, 봇이 폭주하면 사람이 Claude를 못 쓴다.
Team 플랜은 usage credits가 켜져 있으면 초과분이 API 요율로 과금되기까지 한다.

그래서 기본 동작은 "넘으면 과금으로 넘어가기"가 아니라 **"멈추고 알리기"** 다.

- 하루 호출 상한 (기본 30, `RECRUIT_DAILY_CALL_LIMIT`) — 넘으면 호출 자체가 안 나간다
- 재시도도 한도를 태운다 (실패한 호출도 토큰을 쓰기 때문)
- 호출 직렬화 — 동시 실행 없음

### 토큰은 1년 뒤 조용히 죽는다

만료 경고는 `/login` 자격증명에만 뜨고 `CLAUDE_CODE_OAUTH_TOKEN`에는 안 뜬다.
발급일(`CLAUDE_CODE_OAUTH_TOKEN_ISSUED_AT`)을 적어 두면 `/readyz`가 남은 날짜를 알려준다.
11개월 시점에 재발급한다.

---

## SDK를 에이전트로 쓰지 않는다

`adapters/llm/claude-agent.mjs`의 `ISOLATION_OPTIONS`가 모델을 가둔다. 하나라도 빠지면
추출기가 아니라 에이전트가 된다.

| 설정 | 이유 |
|---|---|
| `allowedTools: []` | 파일·bash 접근 차단 |
| `permissionMode: 'dontAsk'` | 허용 목록 밖은 묻지 않고 거부 |
| `maxTurns: 1` | 대화가 아니다 |
| `settingSources: []` | **SDK 격리 모드.** 빼면 `~/.claude/settings.json`과 CLAUDE.md를 읽어 **개발자의 로컬 설정이 추출 결과에 새어든다** |
| `systemPrompt: <문자열>` | `preset: 'claude_code'`를 쓰면 SDK 기본 프롬프트가 섞인다 |

`outputFormat: { type: 'json_schema' }`로 출력을 강제하지만 **로컬에서 다시 검증한다.**
계약이 깨졌을 때 조용한 null이 흘러가는 것보다 시끄럽게 실패하는 편이 낫다.

### P1 전환 검증 결과 (2026-08-24)

옛 CLI 경로와 SDK 경로에 **같은 프롬프트**를 먹여 대조했다.

| 항목 | 결과 |
|---|---|
| facts 구조 (확정된 키 / 빈 키) | **동일** |
| 조립된 공고 골격 | **동일** — 34줄, 차이는 모델이 쓰는 4개 텍스트 필드뿐 |
| `postable` | 양쪽 `true`, 오류 0, `[확인 필요]` 0 |
| 값 차이 | 4건, 모두 같은 뜻의 다른 표현 (모델 흔들림) |

날짜·요일은 독립 검산했다. `2026-09-01 / 09-08 / 09-15` 전부 실제 화요일이고
공고의 `(화)` 표기와 일치한다. 시간 합계 `7시간 × 3일 = 21시간`도 맞다.
이 항목들을 모델이 쓰지 않는 이유가 그것이다.

비공개 정책과 자격 가드도 이 결과물로 확인했다.

- 고객사명 없음 / 강사료 `총 ______ 원` 빈칸 / 장소 `서울 인근` / 교육 목표·일차별 커리큘럼 없음
- 상세주소를 주입해도 `서울시 강남구 테헤란로 123 5층` → `서울 강남구 인근`으로 잘린다
- 제안 자격을 4건으로 늘리면 검산이 막는다. 우대에 제안을 넣어도 막는다

대조군 `claude-cli.mjs`와 `compare-extractors.mjs`는 검증 후 삭제했다.

### `costUsd`는 청구액이 아니다

비교 실행이 `$0.1888`을 찍었지만 **이 돈은 나가지 않는다.** SDK의 `total_cost_usd`는
타입 정의가 직접 못 박아 둔 대로 *"An estimate, not a billing statement"* —
이번 호출이 쓴 토큰을 **API 표준 요율로 환산하면 얼마인지**를 알려주는 값이다.

구독 인증으로 도는 한 실제로 빠지는 것은 **구독 사용 한도**이고, 그 한도는 달러로
표시되지 않는다. 그래서 코드에서는 이 값을 `estimatedCostUsd`로 부른다.

쓸모가 없다는 뜻은 아니다. 쓸 데는 두 가지다.

1. **토큰 소비량의 대리 지표.** 모델을 바꿔가며 비교하거나, 어느 날 갑자기 커진 커리큘럼이
   한도를 얼마나 태우는지 감을 잡을 때. `claude-sonnet-5` 기준 커리큘럼 1건에 $0.19어치.
2. **Team 플랜에서 usage credits가 켜져 있다면** 구독 한도를 넘긴 순간부터는 API 요율로
   실제 과금된다. 그때는 이 숫자가 미리보기가 된다.

일일 상한을 **달러가 아니라 호출 건수**로 건 이유가 이것이다. 구독제에서 의미 있는
단위는 달러가 아니다. `maxBudgetUsd`도 청구 통제가 아니라 폭주 차단기로만 쓴다.

---

## 구조

```
core/       외부 I/O 없음, 의존성 0, 테스트 대상 전부
  schema      facts 스키마 검증
  verify      산술·달력·운영조건·기밀 검산
  derive      물류 자격·담당 업무 표준세트·주소 일반화
  dates       영업일 계산 (Asia/Seoul)
  conditions  운영 조건이 빈 사실을 채움
  render/     job-post.mjs (슬랙) · careerday.mjs (커리어데이 폼값)
  report      HTML 검토 리포트
  paths       데이터 디렉터리

  compensation  강사료 줄 조립 (단가 × 시수)
  publish-guard 게시 직전 검사 — 미완성은 막고 나머지는 알린다

adapters/   외부 I/O. 여기만 의존성을 가진다
  llm/          claude-agent(Agent SDK) · prompt · guards(인증·한도·직렬화)
  slack/        intake · preview · edit-modal · reminder
  store/        database.mjs (node:sqlite)
  publisher/    slack 게시 / clipboard 후퇴 경로
  documents/    files.mjs (pdf-parse)
  server/       health.mjs (/healthz, /readyz)
  reminder-config.mjs
  sheets/       아직 아무도 부르지 않는다. P4에서 성과 기록용으로 붙인다

apps/       bot.mjs (Slack 상주) · cli.mjs (운영자) · careerday-runner.mjs (호스트)
skills/jd-writer/SKILL.md   `## Rules` 이하가 프롬프트에 주입되는 규칙 원본
schemas/    scripts/gen-schema.mjs로 생성 — 손으로 고치지 않는다
```

### core의 의존성 0은 규칙이 아니라 검사다

`npm run core:deps`가 `core/`의 모든 import를 훑어 **node: 빌트인과 core 내부 상대 경로만**
허용한다. npm 패키지나 `../adapters`로 나가는 참조가 있으면 종료 코드 1로 실패한다.

Slack 클라이언트 하나를 core에 들이는 순간 테스트가 네트워크를 타기 시작한다.
사람 눈으로 막을 일이 아니라서 스크립트로 막는다.

---

## 원칙 (양보하지 않는 것)

**1. 모델은 사실만 추출하고, 공고 본문은 코드가 조립한다.**
날짜·요일·시간 합계·고정 문구는 모델이 쓰지 않는다. 초판에서 화요일을 `(월)`로 적은 공고가
나갔는데, 그건 사후 교정으로 막을 문제가 아니라 모델에게 시키지 말았어야 할 일이었다.

**2. 추출과 게시는 다르다.** 아래는 정확히 추출해 검토 리포트에는 띄우되 **공고에는 안 나간다.**

| 항목 | 이유 |
|---|---|
| 교육 목표·일차별 커리큘럼 | 커리큘럼 설계가 우리가 파는 상품이다 |
| 고객사명 | 대부분 비공개 계약이다 |
| 강사료 금액 | 원문 금액은 **고객사 예산**이다. 강사에게 제시할 금액과 다르다 |
| 정확한 주소 | `서울 성동구 인근`이면 통근 판단에 충분하다 |

**3. 규칙은 한 군데에만 있다.** `skills/jd-writer/SKILL.md`의 `## Rules` 이하가 그대로
프롬프트에 주입된다. `## Rules` **아래**에 써야 주입된다 — 위에 쓰면 무시되고, 테스트가 잡는다.

**4. 승인 없이는 아무것도 나가지 않는다.** `검토대기 → 승인됨 → 게시완료`가 강제되고,
초안에 `[확인 필요: …]`가 하나라도 남아 있으면 **승인 자체가 거부된다.**
공개 승인 지점은 Slack 버튼 하나다(P3).

---

## 커리어데이 에스컬레이션

슬랙에서 3영업일 안에 안 붙었을 때만 간다. 현황 입력에서 *커리어데이로 넘어감*을
고르면 [커리어데이 준비] 버튼이 뜨고, 마감일·상세주소를 넣으면 폼 계획이 완성된다.

```bash
npm run careerday -- login            # 1회, 브라우저에서 로그인
npm run careerday -- fill <run-id>    # 등록 화면이 열리고 자동으로 채워진다
npm run careerday -- inspect          # 폼이 깨졌을 때 구조를 다시 뽑는다
```

**호스트에서 돈다.** 봇이 컨테이너에 있어도 이건 사람 컴퓨터에서 실행한다 —
커리어데이는 로그인 세션이 붙은 브라우저가 필요하고 그 세션은 컨테이너에 없다.
**최종 등록 버튼은 누르지 않는다.**

### 채널마다 노출이 다르다

| 값 | 슬랙 공고 | 커리어데이 폼 |
|---|---|---|
| 강사료 | 금액 표기 | 같은 금액 (담당자 승인값) |
| 주소 | `서울 강남구 인근` | 상세주소 (담당자 입력, 선택) |
| 업무 내용 | 공고 본문 | **같은 본문 그대로** |

커리큘럼 원문의 금액은 고객사 예산이다. facts에 금액 필드가 아예 없어 이 경로로
흘러들 수 없다.

### 보상 단위는 시간을 먼저 쓴다

커리어데이 화면이 직접 권한다 — *"1개월에 300,000원"보다 "12시간에 300,000원"으로
표기를 권장합니다. 총 사용시간을 나타낼 때 지원율이 가장 높습니다.*
우리는 확정 시수를 갖고 있으니 그대로 맞춘다. 드롭다운에 없으면 `일 → 개월` 순으로
내려가되 **횟수도 함께 바뀐다** — 21시간과 3일은 같은 뜻이지만 숫자만 두고 단위를
갈면 21개월이 된다.

### 폼이 깨졌을 때

셀렉터 14개가 남의 사이트 DOM에 걸려 있다. 언제든 깨진다.
`careerday -- inspect`로 현재 구조를 뽑아 `docs/careerday-form-2026-08-24.json`과
diff 하면 무엇이 달라졌는지 보인다. 한 필드가 실패해도 나머지는 계속 채우므로,
절반이라도 채워진 화면에서 사람이 마저 할 수 있다.
