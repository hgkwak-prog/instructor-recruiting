# 인수인계 — 2026-09-14 기준

다른 계정(조직만 다름, 안 쓰던 팀 계정)으로 세션을 옮기기 위해 갱신했던 문서.
2026-09-14에 한 세션 안에서 많이 바뀌어서 다시 갱신한다. 새 세션에서 이 파일을
읽으면 지금까지의 결정과 상태를 대부분 이어받을 수 있다.

## 하는 일

PDF/HTML/MD로 된 커리큘럼·제안서를 받아 → 모델이 사실만 추출 → **코드가** 강사
구인 공고(JD) 본문을 조립 → 슬랙에서 사람이 검토·편집·승인 → 게시.

핵심 원칙: **모델은 사실만 추출하고, 공고 본문은 코드가 조립한다.** 이게 이 코드베이스
전체에서 제일 중요한 불변식이다.

## 지금 상태 (v1.0.0, 실사용 검증 완료 + GitHub 이관)

- `npm test` 236개 전부 통과, `npm run check` 통과, `npm audit` 0건
  (2026-09-14: `qs`/`hono` moderate 취약점 2건 패치 버전으로 해소).
- 버전 `1.0.0`으로 태깅. GitHub `hgkwak-prog/instructor-recruiting`에 이관
  완료(`master` 푸시됨). **문서(`README.md`/`INTEGRATION-DESIGN.md`)도
  2026-09-14에 v1 실제 상태 기준으로 다시 정리했다** — 그 전까지는 재기획
  이전(P0~P5 로드맵, 검산기, HTML 리포트, 리마인더 등 실제로 없는 것들)을
  그대로 담고 있어서 신뢰할 수 없었다. `INTEGRATION-DESIGN.md`는 전면
  재작성 대신 맨 위에 "이후 뒤집힌 결정" 표를 달아 역사적 기록으로만
  남겼다.
- 실제 제안서 PDF 2건(이지스엔터프라이즈, 비개발자 맞춤형 하네스 엔지니어링)으로
  `node apps/cli.mjs generate --source <pdf>` → `show --run-id <id>` 흐름 검증 완료.
- JD 본문 포맷을 2026-09 실제 슬랙 게시글 5건 기준으로 다시 맞췄다
  (`core/render/job-post.mjs`): 상단 고정 문구 제거, 헤더를 `*[역할 모집] 과정명*`으로,
  섹션에 이모지(📌🎯📖✅💰), 교육목표는 공개(일차별 커리큘럼은 여전히 비공개),
  모든 섹션 불릿+줄바꿈 통일(강사료 줄 포함).
- 슬랙 봇(`apps/bot.mjs`)에 운영사항 입력 모달(`OPERATIONS_MODAL`)과 공고 편집
  모달(`EDIT_MODAL`)이 이미 구현되어 있다. CLI(`generate`)는 추출 검증용이고,
  실제 게재 흐름은 봇을 통해서만 나간다(설계서 §6.4 — 승인 지점은 슬랙 버튼 하나뿐).
- 비개발자용 사용법 매뉴얼 `USAGE.md` 추가 (2026-09-08). 피드백은 비즈팀
  곽형곤에게 DM으로 받기로 함.
- **봇을 실제로 처음 실행까지는 해봤다**(2026-09-14, 안드로이드에서 —
  아래 "Termux/안드로이드 배포" 참고). `SLACK_BOT_TOKEN`이 `invalid_auth`로
  막혀서 end-to-end는 아직 미완 — 내일 토큰 재발급 예정.

## v1 범위 결정 (재기획 때 정한 것, 뒤집지 않을 것)

1. 검산기(`core/verify.mjs`) 제거. 모든 생성 결과는 무조건 검토대기로 들어가고
   사람이 눈으로 보고 승인 여부를 결정한다. `postable` 게이트도 없앴다.
2. 커리어데이 자동화는 CLI 수동 트리거(`careerday-prepare`)로 축소.
   Playwright 자동 폼 채우기는 없앴다.
3. 승인은 슬랙 버튼 하나로만 간다. CLI에는 승인 명령이 없다.
4. 구인 실행(파일을 봇에 올리는 것) 트리거는 사람이 수동으로 한다.
5. 운영조건(장소·일정·지원방법 등)은 파일 기본값이 아니라 건별로 슬랙 모달에서
   사람이 입력한다 — 출처 없는 값이 사실인 척 공고에 새는 걸 막기 위함.

## 아직 안 한 것 / 다음에 다룰 것

1. **실 워크스페이스 슬랙 토큰 미발급.** 지금은 테스트 워크스페이스 토큰으로
   돌리면 된다 — 워크스페이스는 `.env`의 `SLACK_BOT_TOKEN`/`SLACK_APP_TOKEN`
   교체만으로 바뀌므로 나중에 실제 워크스페이스로 옮기는 건 토큰만 바꾸면 된다.
2. 슬랙 봇을 실제로 돌려서 운영사항 모달 → 편집 모달 → 승인 → 게시까지
   end-to-end 검증한 적은 아직 없다 (CLI 경로만 검증됨). **2026-09-14: 안드로이드에서
   `npm run bot`을 처음 실행은 해봤으나 `SLACK_BOT_TOKEN`이 `invalid_auth`로
   막혀 auth.test조차 못 넘겼다** — 아래 "Termux/안드로이드 배포" 참고.
   내일 토큰 재발급 후 이어서 검증.
3. **[완료, 미검증] "고객사 명시 요구사항" 필드 (2026-09-08).** 경력 연차·도메인
   경력처럼 requiredQualifications가 일부러 못 쓰게 막아둔 종류(문서에서 나올 수
   없는 기준을 모델이 지어내지 못하게)라, 원문에 실제로 있어도 담을 곳이 없었다.
   방향 결정: LLM 추출이 아니라 **운영사항 모달에서 담당자가 직접 입력**(사용자
   확정, 2026-09-08) — 지금 v1 원칙(운영조건은 모달에서 사람이 입력)과 같은
   패턴이라 스키마/프롬프트는 안 건드렸다.
   - `adapters/slack/operations-modal.mjs`: `EXPLICIT_REQUIREMENTS_BLOCK` 여러
     줄 자유 텍스트 입력(선택), 줄 단위로 배열로 파싱. 아무것도 안 적으면
     빈 배열이 아니라 `null`(applyConditions가 ''/null만 조건 없음으로 봄 —
     빈 배열을 넘기면 "확인했는데 없더라"로 잘못 채워진다).
   - `core/conditions.mjs`의 `CONDITION_TO_FACT`에 `explicitRequirements` 매핑
     추가. 모델 스키마(`core/schema.mjs`)에는 없는, 운영조건 전용 사실이다.
   - `core/render/job-post.mjs`: "강사 지원 자격" 섹션에 기존 역량 조건 뒤로
     불릿 추가. 새 섹션은 안 만들었다 — 실제 슬랙 사례 없이 포맷을 새로
     만들지 말라는 원칙(§JD 본문 포맷) 때문에, 있는 섹션에 자연스럽게 얹었다.
   - 테스트 6개 추가(claude-agent 2, operations-modal 2, render 2),
     `npm test` 236개 전부 통과, `npm run check` 통과. 봇 자체는 실 슬랙 연동
     없이는 못 돌려서(§환경 제약) **실사용 미검증** — 실제 모달에 이 칸이
     자연스러운 위치에 뜨는지, 담당자가 뭘 적어야 할지 헷갈리지 않는지 확인할 것.
4. 커리큘럼 여러 건 더 돌려서 포맷 다듬을 부분 있는지 확인 중(사용자가 직접
   봇으로 검증하기로 함 — 대신 돌려주지 말 것).
5. **[논의만 됨, 미착수] 커리큘럼 신뢰도 문제 (2026-09-08 제기).** 커리큘럼은
   "교육이 흘러가는 참고자료"이지 100% 확실한 운영사실이 아니다. 사용자 의견:
   모델은 큰 흐름과 필요 역량 스택 추출까지만 하고, 날짜·운영사 요구사항·시간
   같은 건 사람이 직접 입력하는 게 더 정확할 가능성이 높다. 제안된 방향—
   (a) 운영사항 모달의 필수 입력 칸/정형 스키마를 줄이고, (b) 공고 게시 시점에
   전문을 자유롭게 수정할 수 있게 하고, (c) LLM+사람 이중 검수로 "필수 항목이
   빠지지 않았는지"만 확인 후 승인. 지금 구조(모달에서 정형 입력 → 코드가 조립)
   와 정면으로 다른 방향이라 재설계 필요 — v1 범위 결정을 뒤집는 수준이므로
   다음 세션에서 먼저 이 문서 §v1 범위 결정 섹션과 맞대어 논의할 것.
   **2026-09-14 추가 생각(아직 결론 아님):** 지금은 제안서 커리큘럼 기반이지만,
   나중에 운영사항이 더 많이 반영되는 쪽으로 가면 지금의 "필드 하나하나
   스키마로 못박기" 방식보다 **구조화 아웃풋(structured output) 자체를
   다른 형태로 다시 설계해야 할 수도 있다**는 문제의식. 아직 선임(선임님)과
   방향을 더 논의해야 하는 단계라 — 다음 세션에서 코드로 바로 들어가지 말고
   이 논의부터 다시 확인할 것.
6. **[완료, 미검증] 슬랙 진행상황 로그 (2026-09-08 추가, 같은 날 시간 티커 →
   이벤트 기반으로 교체).** 운영사항 모달 제출 후 "20초쯤 걸립니다"라고만
   찍고 끝까지 무응답이던 문제 — 실사용에서 대형 문서는 그보다 훨씬 오래
   걸려서 멈춘 건지 알 수 없었다.
   처음엔 15초마다 경과 시간을 찍는 하트비트로 구현했는데, 실제 단계와
   안 맞는 "그냥 초 세는 티커"라는 피드백을 받아 같은 날 다시 고쳤다:
   - `adapters/llm/claude-agent.mjs`의 `invokeOnce`/`extractFacts`가 SDK
     스트리밍 메시지(`system`/`assistant`/`result`)를 `onMessage` 콜백으로
     그대로 넘긴다(전에는 `result`만 보고 나머지는 버렸다).
   - `apps/bot.mjs`의 `createProgressReporter`는 이제 시간 타이머가 아니라
     실제 단계 전환(파일 읽기 → 프롬프트 조립 → 모델 세션 시작 → 모델 응답
     조각마다 → 응답 수신 완료 → 공고 조립 → 완료)에서만 슬랙 메시지를
     갱신한다. 재시도가 걸리면 몇 차 시도인지도 보여준다.
   - 그래도 30초 넘게 아무 신호가 없으면 워치독이 한 번은 알려준다(반복
     티커 아님 — "이상하게 조용하다"는 신호 1회성).
   - `test/claude-agent.test.mjs`에 `onMessage` 전달 검증 테스트 2개 추가,
     `npm test` 232개 전부 통과. `apps/bot.mjs` 자체는 여전히 테스트 대상
     밖(실제 슬랙+SDK 필요)이라 **실사용 검증 전**이다. 다음에 봇 돌릴 때
     이 로그가 실제로 단계를 잘 짚는지 확인할 것.
7. **[진행 중] Termux/안드로이드 배포 (`termux-android` 브랜치, 2026-09-14
   착수).** 회사 안 쓰는 루팅 안드로이드 폰(갤럭시 A23)에 봇을 상주시켜볼
   수 있는지 검증 중. 자세한 절차는 `docs/termux-setup.md` 참고, 핵심만
   요약:
   - Termux 기본 유저랜드의 Node는 `process.platform`을 `linux`가 아니라
     **`android`로 보고한다.** `@anthropic-ai/claude-agent-sdk`의
     `optionalDependencies`엔 android 빌드가 아예 없어서
     ("Native CLI binary for android-arm64 not found") Termux 유저랜드
     그대로는 절대 해결 안 된다.
   - `proot-distro install ubuntu`로 진짜 Linux(glibc) 유저랜드를 깔면
     해결된다 — `npm run termux:smoke`, `npm test` 통과 확인함.
   - 루팅을 살려서 **진짜 `chroot`**(proot의 ptrace 오버헤드 없이)도 되는
     걸 확인했지만, 손으로 하면 마운트 순서·PATH/HOME·언마운트 챙기는 게
     너무 번거로워서 `scripts/termux-chroot.sh`로 스크립트화했다. 대화형
     모드와, 상주 실행용 "명령을 인자로 받아 그걸 메인 프로세스로 붙잡는"
     모드 둘 다 지원한다 — **상주시킬 땐 반드시 후자를 쓸 것**(대화형
     셸에서 `&`로 백그라운드 던지고 exit하면 그 순간 `/dev`·`/proc`·`/sys`
     언마운트돼서 봇이 나중에 깨질 수 있다).
   - `/sdcard`는 스크립트에서 자동 마운트 안 함 — 최신 안드로이드에서 FUSE
     기반이라 root라도 SELinux가 bind mount를 막는 경우가 흔했고, 실제
     봇은 커리큘럼을 슬랙 API로 받지 로컬 저장소를 안 봐서 애초에 필요
     없다.
   - `nohup bash scripts/termux-chroot.sh 'cd /root/instructor-recruiting && exec npm run bot' > ~/bot.log 2>&1 & disown`
     로 상주 실행. Termux:Boot 스크립트에 같은 줄 넣으면 재부팅 시 자동
     기동.
   - **막힌 지점(해소, 2026-09-15)**: `SLACK_BOT_TOKEN` `invalid_auth`는
     재발급으로 해결. 봇이 실제로 뜨는 것까지는 확인함.
   - **간헐적 SIGABRT + 포트 충돌(해소, 2026-09-15)**: 모델 호출 중
     `Claude Code process terminated by signal SIGABRT`(Bun 패닉,
     `Linux Kernel v4.14.83`)가 보였던 사례. 처음엔 "Bun이 요구하는 커널
     5.1+(권장 5.6+)에 못 미쳐서 이 폰에서 원천적으로 안 된다"고 단정했다가,
     같은 세션에서 바로 다음 시도가 정상 성공해서 뒤집었다. 실제 원인은
     **좀비 프로세스**였다 — `~/bot.log`에 새 인스턴스가 시작하자마자
     `Error: listen EADDRINUSE: address already in use 0.0.0.0:3000`가
     찍혀 있어서, 예전에 띄웠던 봇이 안 죽고 포트 3000을 쥔 채 계속 돌고
     있었다는 게 확인됐다(`su -c "ps aux | grep node"`로는 안 잡혔지만
     `su -c 'netstat -tlnp | grep 3000'`으로 실제 PID를 찾아 `kill -9`로
     정리함). 좀비를 죽이자 `free -h`도 (`available` 기준) 4.3G로 넉넉해져서,
     SIGABRT도 이 좀비가 자원을 갉아먹던 부작용이었을 가능성이 높다 —
     **커널 버전 자체가 하드 블로커라는 판단은 근거 부족이었다.** 다만
     이 좀비가 정확히 언제부터 왜 안 죽고 남았는지(자동 언마운트 trap이
     있던 구버전 스크립트로 띄웠던 게 마지막까지 살아있었을 가능성이 큼)는
     소급 확인 못 함 — `scripts/termux-chroot.sh`를 고친 뒤로 새로 띄우는
     인스턴스는 정상 종료되는지 계속 지켜볼 것.
     - 교훈: 작은 예시로 한 번 안 되거나 된다고 결론 내리지 말라는 원칙
       (§알아둘 것)은 거꾸로도 적용된다 — 한 번 실패했다고 "전면 불가"로
       단정한 것도 같은 종류의 실수였다. 프로세스/포트 상태를 실제로
       확인하기 전에는 "이 환경에서 근본적으로 안 된다"는 결론을 내리지
       말 것.
     - `scripts/termux-smoke-test.mjs`가 "성공"으로 보고하는 건 SDK
       `import`만 확인한 것이지 실제 호출 성공을 보장하지 않는다는 점은
       여전히 유효(스크립트 주석에도 명시돼 있음).
   - **진행상황 로그가 "파일 첨부해주세요"를 반복 발송하는 버그(해소,
     2026-09-15)**: 실제로는 좀비 프로세스와 별개의, 진짜 코드 버그였다.
     `createProgressReporter`(§6)가 같은 슬랙 메시지를 `chat.update`로
     계속 고쳐 쓰는데, 슬랙은 편집마다 `subtype: 'message_changed'`(지우면
     `message_deleted`)인 `message` 이벤트를 새로 보낸다. 이런 이벤트는
     `bot_id`/`user`가 최상위가 아니라 `event.message` 안에 들어있어서
     `adapters/slack/intake.mjs`의 `shouldIntake`가 봇 자신의 메시지로
     인식을 못 하고 그냥 통과시켰고, `files`도 없으니 매번 "커리큘럼 파일을
     첨부해 주세요"를 새로 보냈다 — 진행 단계를 몇 번 갱신하느냐만큼
     반복됐다(실사용에서 "모델 세션 시작" 뒤에 3번 연속 재현). **수정**:
     `shouldIntake`에 `message_changed`/`message_deleted`/`message_replied`/
     `thread_broadcast`/`channel_join`/`channel_leave` 서브타입을 걸러내는
     `NON_CONTENT_SUBTYPES` 체크를 맨 앞에 추가(`reason: 'edit'`,
     `rejectionMessage`는 이미 default가 `null`이라 조용히 무시됨).
     `test/slack.test.mjs`에 회귀 테스트 추가, `npm test` 237개 전부 통과.
   - 회사 정책/유지보수 관점에서 "굳이 법인폰을 루팅해야 하나, 차라리 팀
     공용 윈도우 노트북에 붙이는 게 낫지 않나"는 논의가 나왔었다 — 위
     커널 이슈로 이 방향이 유력해졌다. proot-distro만 쓰면 루팅 자체가
     필요 없다는 점(그래도 커널 버전 문제는 동일하게 남는다), 삼성 기기는
     일반 배터리 최적화 제외만으로 안 되고 "절전 앱"/"深 절전 앱" 리스트도
     따로 빼야 한다는 점도 참고.
   - **별건으로 의심되는 것**: 같은 시점에 슬랙 DM에 "커리큘럼 파일을
     첨부해 주세요"(intake.mjs의 `no_file` 거절 메시지)가 3번 연속 찍힌
     사례 있음. 이전에 자동 언마운트 trap이 상주 중인 봇 밑에서
     `/dev`·`/proc`·`/sys`를 뽑아버려 봇이 죽는 문제가 있었는데(2026-09-15
     `scripts/termux-chroot.sh`에서 trap 제거로 고침), 그 여파로 좀비
     프로세스가 여러 개 남아 있진 않은지 `su -c "ps aux | grep node"`로
     확인 필요 — node 프로세스가 1개보다 많으면 그게 중복 응답의 원인.
     아직 확인 결과 대기 중.

## 알아둘 것 (다시 겪지 않기 위해)

- **디바이스 브리지 제약**: 연결된 폴더(`~/Developer/instructor-recruiting`)는
  OS 레벨에서 `unlink`/`rm`/`mv`를 막는다. bash 도구, `node:sqlite` 쓰기,
  git의 내부 lock 파일 정리까지 전부 영향받는다. git 커밋 자체는 성공하지만
  (내부적으로 atomic rename을 쓰므로) 그 뒤 `index.lock`/`HEAD.lock`이 남아
  다음 git 명령을 막는다. **사용자가 자기 터미널에서 `rm -f .git/index.lock
  .git/HEAD.lock` 해줘야 풀린다.** 파일을 진짜로 지워야 할 때도 마찬가지로
  사용자가 직접 `rm`/`git rm`을 실행해야 한다 — Claude 쪽 도구로는 못 지운다.
  (합의된 방식: Claude가 락 삭제 명령 + 커밋 명령을 한 번에 같이 준다.)
  **오해하지 말 것**: 이 lock은 "진짜 동시에 뭔가 돌고 있다"는 신호가
  아니다 — 커밋 자체는 이미 끝났고, git이 뒷정리(lock 파일 삭제)만 못 한
  찌꺼기다. 안전하게 지워도 된다.
- **샌드박스 아키텍처 불일치**: bash 도구의 리눅스 샌드박스(`linux-arm64`)에
  `@anthropic-ai/claude-agent-sdk`의 네이티브 바이너리가 없다고 오래 알고
  있었는데, **2026-09-14에 다시 확인해보니 이 샌드박스에서 SDK import는
  성공한다**(`scripts/termux-smoke-test.mjs`로 직접 확인함 — SDK 버전이
  올라가며 linux-arm64 빌드가 추가됐을 가능성). 다만 이건 **import만
  확인한 것**이고 실제 모델 호출(`invokeOnce`)까지 되는지는 별개 문제라
  과신하지 말 것 — 실제 모델 호출은 여전히 **사용자가 자기 맥 터미널에서
  직접 실행**해서 결과를 붙여넣는 방식을 기본으로 한다. `--dry-run`으로
  프롬프트 조립만 Claude 쪽에서 확인 가능.
- **플랫폼 이름 자체가 다를 수 있다**: 안드로이드(Termux)에서는 Node가
  `process.platform`을 `linux`가 아니라 `android`로 보고해서, SDK가
  `optionalDependencies`에 없는 플랫폼이라 아예 못 찾는 사고가 났다
  ("Native CLI binary for android-arm64 not found", 2026-09-14). libc
  문제(`musl`/`glibc`)보다 먼저 **플랫폼 이름 자체가 지원 목록에 있는지**를
  확인할 것. 새 실행 환경을 만날 때마다
  `node -e "console.log(process.platform, process.arch)"`로 먼저 확인하고
  SDK의 `optionalDependencies` 목록과 대조하는 습관을 들일 것.
- **작은 예시로 결론 내리지 말 것**: `maxTurns: 1` 버그를 작은 428바이트 예시
  커리큘럼으로 재현 안 된다고 "문제없음"으로 결론지었다가, 실제 크기의 PDF로는
  똑같이 실패해서 뒤집은 적이 있다. 실사용 규모로 재현해야 확정할 수 있다.
- **예시 없이 하드코딩하지 말 것**: JD 포맷은 실제 슬랙 게시글을 먼저 받고
  거기 맞춰 코드를 고치는 순서로 가야 한다. 거꾸로 하면(포맷을 먼저 정하고
  나중에 사례로 검증) 매번 다시 뜯어고치게 된다 — 실제로 강사료 줄 불릿 누락,
  교육목표/주요내용 join 방식 등 여러 번 겪었다.

## 알아두면 편한 것

- `node apps/cli.mjs generate --source <파일>` → runId 나옴 →
  `node apps/cli.mjs show --run-id <id>`로 조립된 JD 확인.
- `node apps/cli.mjs list`로 진행 중인 작업 전체 확인.
- 실제 게재 흐름 돌리려면 `.env`에 `SLACK_BOT_TOKEN`(xoxb-), `SLACK_APP_TOKEN`
  (xapp-) 설정 후 `npm run bot`. `SLACK_CHANNEL_ID`는 선택(안 정하면 승인 화면
  에서 매번 채널 선택). `PUBLISH_MODE=clipboard`로 실제 게시 없이 테스트 가능.
- 토큰이 `xoxb-`/`xapp-` 형식은 맞는데 `invalid_auth`가 뜨면, 형식 체크
  (`requireEnv`)는 통과했지만 값 자체가 무효라는 뜻 — 아래로 직접 찔러서
  확인:
  `curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" https://slack.com/api/auth.test`
- 안드로이드/Termux 배포는 `docs/termux-setup.md` + `scripts/termux-chroot.sh` +
  `scripts/termux-smoke-test.mjs` 참고 (`termux-android` 브랜치).
