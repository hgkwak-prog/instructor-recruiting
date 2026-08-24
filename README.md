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
| P1 | Claude Agent SDK로 모델 호출 교체 (구독 인증) | 대기 |
| P2 | 게시 프로파일 — 채널별 노출 정책 | 대기 |
| P3 | Slack 인테이크·승인·게시 | 대기 |
| P4 | Notion·시트·커리어데이 | 대기 |
| P5 | Docker 배포 | 대기 |

P0는 **동작 변경이 없는 순수 이동**이다. `adapters/llm/claude-cli.mjs`는 옛 CLI 호출본
그대로이며 P1에서 `claude-agent.mjs`로 교체된다.

```bash
npm test         # 120개
npm run check    # 구문 검사
npm run core:deps  # core/ 의존성 0 검사
```

의존성은 아직 **0개**다. `package.json`에 `dependencies`가 없다.

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
