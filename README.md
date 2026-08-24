# 강사 구인 자동화

커리큘럼을 넣으면 팀 서식에 맞는 **강사 구인 공고 초안**과 **누락 항목 목록**을 만들고,
담당자가 Slack에서 승인하면 게시하고, 3영업일 뒤 모집 현황을 확인한다.
주강사·보조강사 모두 지원한다.

`assistant-instructor-recruiting-agent`(검산·조립·승인 게이트)와
`slack-recruiting-bot`(Slack 상주·인테이크·게시·커리어데이)을 합친 레포다.

**설계서: [INTEGRATION-DESIGN.md](./INTEGRATION-DESIGN.md)** — 무엇을 왜 이렇게 합쳤는지는 여기 있다.

---

## 지금 상태 — P0 완료

| 단계 | 내용 | 상태 |
|---|---|---|
| **P0** | 뼈대 + `core/` 이관 + 테스트 120개 | ✅ 2026-08-24 |
| **P1** | Claude Agent SDK로 모델 호출 교체 (구독 인증) | ✅ 코드 완료 · **실호출 A/B 검증 대기** |
| P2 | 게시 프로파일 — 채널별 노출 정책 | 대기 |
| P3 | Slack 인테이크·승인·게시 | 대기 |
| P4 | Notion·시트·커리어데이 | 대기 |
| P5 | Docker 배포 | 대기 |

```bash
npm install
npm test           # 148개
npm run check      # 구문 검사
npm run core:deps  # core/ 의존성 0 검사
```

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
발급일을 적어 두고 11개월 시점에 재발급한다. (P3에서 `/readyz`에 잔여일 체크를 넣는다.)

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

### P1 검증 — 아직 남은 한 걸음

전환이 추출 능력을 바꾸지 않았는지 **실호출로** 확인해야 한다. 프롬프트는 `prompt.mjs`가
한 번만 조립해 양쪽에 같은 글자를 먹이므로, 차이가 나면 그건 전환이 만든 차이다.

```bash
npm run compare:extractors -- --source ./examples/curriculum.txt \
                              --conditions ./examples/operating-conditions.json
```

구조(어떤 키가 확정되고 어떤 키가 비었나)가 어긋나면 종료 코드 1이다.
값 차이는 모델 흔들림일 수 있으니 사람이 읽고 판단한다.
확인이 끝나면 대조군인 `adapters/llm/claude-cli.mjs`를 지운다.

---

## 구조

```
core/       외부 I/O 없음, 의존성 0, 테스트 대상 전부
  schema      facts 스키마 검증
  verify      산술·달력·운영조건·기밀 검산
  derive      물류 자격·담당 업무 표준세트·주소 일반화
  dates       영업일 계산 (Asia/Seoul)
  conditions  운영 조건이 빈 사실을 채움
  render/     job-post.mjs — 공고 본문 조립
  report      HTML 검토 리포트
  paths       데이터 디렉터리

adapters/   외부 I/O. 여기만 의존성을 가진다
  llm/claude-cli.mjs   ← P1에서 claude-agent.mjs로 교체
  store/database.mjs   node:sqlite
  documents/files.mjs  ← P1에서 pdf-parse로 교체 (현재 pdftotext)
  sheets/, reminders.mjs

apps/       (P1~) bot.mjs / cli.mjs / careerday-runner.mjs
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
