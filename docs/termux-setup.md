# Termux(안드로이드) 배포 — 검증 순서

이 브랜치(`termux-android`)는 강사 구인 봇을 루팅된 안드로이드 폰 위 Termux에서
상주 실행하기 위한 작업 공간이다. **아직 실사용 검증 전.** 순서대로 확인할 것.

## 왜 "슬랙 키만 바꾸면 된다"가 아닌가

`@anthropic-ai/claude-agent-sdk`는 플랫폼별 네이티브 바이너리를
`optionalDependencies`로 받는다(`linux-x64`/`linux-arm64`/`linux-x64-musl`/
`linux-arm64-musl`/`darwin-*`/`win32-*`). Termux 기본 유저랜드는 커널은
리눅스지만 **libc가 Bionic(안드로이드 고유)** 이라 glibc도 musl도 아니다.
`npm install`은 조용히 끝나도 `import`하는 순간 네이티브 바이너리가 안 맞아서
깨질 수 있다 — 이 프로젝트가 이미 한 번 겪은 "샌드박스 아키텍처 불일치"
(`CLAUDE.md` 참고)와 같은 종류 문제다.

## 0단계 — 지금 유저랜드에서 바로 확인

```bash
node scripts/termux-smoke-test.mjs
```

여기서 성공(`✅ SDK 로드 성공`)하면 아래 1~2단계는 건너뛰어도 된다 — Termux가
이미 이 SDK와 호환되는 바이너리를 받았다는 뜻이다. 실패하면 1단계로.

## 1단계 — proot-distro로 진짜 glibc 유저랜드 준비 (실패 시)

루팅 여부와 무관하게 동작하지만, 루팅돼 있으면 더 안정적이다.

```bash
pkg install proot-distro
proot-distro install ubuntu
proot-distro login ubuntu

# --- 여기부터는 Ubuntu(glibc) 안 ---
apt update && apt install -y curl git build-essential
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
node --version   # v24.x 인지 확인 (package.json engines 요구사항)
```

## 2단계 — 레포를 다시 클론하고 스모크 테스트

Termux의 홈 디렉터리는 proot-distro 안에서도 보통 `/root` 아래 별도 파일시스템이라,
레포를 Ubuntu 유저랜드 안에 다시 받는 편이 안전하다(심볼릭 링크나 바인드 마운트로
공유할 수도 있지만, 처음엔 단순하게 간다).

```bash
git clone <이 레포 URL> instructor-recruiting
cd instructor-recruiting
git checkout termux-android
npm install
node scripts/termux-smoke-test.mjs
```

## 3단계 — 통과하면 정상 흐름대로

```bash
npm test            # 236개 통과해야 함 — core/ 로직은 플랫폼 무관
npm run check
cp .env.example .env
# CLAUDE_CODE_OAUTH_TOKEN, SLACK_BOT_TOKEN, SLACK_APP_TOKEN 채우기
npm run recruit -- generate --source ./샘플커리큘럼.pdf --dry-run   # 모델 호출 없이 프롬프트만 확인
npm run recruit -- generate --source ./샘플커리큘럼.pdf             # 실제 모델 호출 검증
```

여기까지 되면 `npm run bot`으로 상주시켜도 된다.

## 이 배포에서 제외할 것

- **커리어데이 자동화(Playwright)는 폰에서 돌릴 이유가 없다.** 원래 설계도
  "사람 컴퓨터에서 수동 실행"이다(`README.md` 참고). `apps/careerday-runner.mjs`는
  이 배포 대상에서 아예 안 써도 된다 — Playwright 브라우저 설치도 필요 없다.

## 상주 실행 관련 (이미 해둔 것 확인용)

- 배터리 최적화 제외 완료
- Termux:Boot로 재부팅 시 자동 기동 설정 완료

추가로 고려할 것: 화면이 꺼져도 프로세스가 죽지 않게 `termux-wake-lock`을
부팅 스크립트에 같이 걸어 둘 것. Socket Mode라 인바운드 포트는 필요 없다.

## 알게 된 것을 기록할 곳

이 문서에서 확인한 내용(스모크 테스트 통과 여부, proot-distro 필요했는지,
Node 버전, 실제 봇 상주 여부)은 `HANDOFF.md`에 날짜와 함께 옮겨 적을 것 —
이 문서는 절차서이고, HANDOFF.md가 "무엇이 실제로 됐는가"의 기록이다.
