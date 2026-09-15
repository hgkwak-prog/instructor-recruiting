# Termux(안드로이드) 배포 — 검증 순서

이 브랜치(`termux-android`)는 강사 구인 봇을 루팅된 안드로이드 폰 위 Termux에서
상주 실행하기 위한 작업 공간이다. **아직 실사용 검증 전.** 순서대로 확인할 것.

## 상주 실행 중 SIGABRT/포트 충돌이 보이면 좀비 프로세스부터 의심할 것 (2026-09-15)

모델 호출용 네이티브 `claude` 바이너리(`@anthropic-ai/claude-agent-sdk-linux-arm64`)는
Bun으로 빌드돼 있고, Bun 자체는 리눅스 커널 5.1 이상을 최소로 요구, 5.6 이상을
권장한다(갤럭시 A23의 커널은 `4.14.83`으로 이 요구치에 못 미친다). 처음엔
이 때문에 "이 폰에서 모델 호출이 원천적으로 불가능하다"고 판단했지만 **틀렸다**
— 실제 원인은 커널이 아니라 **좀비 프로세스**였다. 예전에 띄운 봇이 안 죽고
포트 3000을 계속 쥐고 있었고, 그게 자원을 갉아먹으며 새 인스턴스와 충돌해
간헐적 SIGABRT와 "커리큘럼 파일을 첨부해 주세요" 중복 발송을 일으켰다
(`su -c "ps aux | grep node"`로는 안 잡혔지만 `su -c 'netstat -tlnp | grep
3000'`으로 실제 PID를 찾아 `kill -9`로 정리하니 해소됨). 자세한 경위는
`HANDOFF.md`의 "Termux/안드로이드 배포" 항목(2026-09-15) 참고.

**그러니 SIGABRT나 EADDRINUSE, 이상한 메시지 중복이 보이면 커널 탓으로 먼저
넘겨짚지 말고**, 순서대로 확인한다: (1) `su -c 'netstat -tlnp | grep 3000'`
(또는 `ss -tlnp`)으로 포트를 쥔 PID 확인·정리, (2) `su -c 'free -h'`로
`available` 컬럼(버퍼/캐시 반영 안 된 옛날 포맷이면 `-/+ buffers/cache`
줄)이 넉넉한지 확인, (3) 그래도 재현되면 그때 가서 커널 버전(`uname -r`)을
참고 정보로만 본다.

## 왜 "슬랙 키만 바꾸면 된다"가 아닌가

`@anthropic-ai/claude-agent-sdk`는 플랫폼별 네이티브 바이너리를
`optionalDependencies`로 받는다(`linux-x64`/`linux-arm64`/`linux-x64-musl`/
`linux-arm64-musl`/`darwin-*`/`win32-*`). Termux 기본 유저랜드는 커널은
리눅스지만 **libc가 Bionic(안드로이드 고유)** 이라 glibc도 musl도 아니다.
`npm install`은 조용히 끝나도 `import`하는 순간 네이티브 바이너리가 안 맞아서
깨질 수 있다 — 이 프로젝트가 이미 한 번 겪은 "샌드박스 아키텍처 불일치"
(`CLAUDE.md` 참고)와 같은 종류 문제다.

## 결론 (2026-09-14) — 진짜 chroot, 단 래퍼 스크립트로

- Termux 기본 유저랜드의 Node는 `process.platform`을 `linux`가 아니라
  **`android`로 보고한다.** SDK의 `optionalDependencies`에는 애초에 android
  빌드가 없으므로("Native CLI binary for android-arm64 not found"), libc
  문제 이전에 그런 패키지 자체가 존재하지 않는다. Termux 유저랜드 그대로는
  절대 해결 안 된다.
- `proot-distro install ubuntu` → 그 안에서 `npm run termux:smoke`, `npm test`
  **통과 확인함(2026-09-14).** 다만 proot는 매 시스템콜을 ptrace로 가로채는
  방식이라 오버헤드가 있다.
- 루팅을 활용하면 **같은 rootfs로 진짜 `chroot`도 된다** — ptrace 오버헤드가
  없다. 문제는 그 자체가 아니라 손으로 할 때의 번거로움이었다: `su`로 들어갈
  때마다 `/dev`·`/proc`·`/sys`·`/sdcard`를 순서대로 bind mount해야 하고,
  PATH·HOME이 안 잡혀서 `ls: command not found`가 나고, 나갈 때 언마운트를
  잊기 쉬웠다.
- 그래서 이 과정을 `scripts/termux-chroot.sh`로 스크립트화했다 — 마운트
  (이미 됐으면 건너뜀) → `env -i`로 깨끗한 PATH/HOME 설정 → `chroot` 진입까지
  한 번에 한다. **이제부터는 이 스크립트로만 chroot에 들어간다** — 손으로
  mount/chroot 치지 않는다.
- **2026-09-15부터 자동 언마운트를 없앴다.** 원래는 대화형 셸이 끝나거나
  넘겨준 명령이 끝나면 `trap`으로 `/dev`·`/proc`·`/sys`를 자동 언마운트했는데,
  실사용에서 문제를 일으켰다: 봇을 nohup으로 상주시켜 둔 상태에서 같은
  rootfs에 대해 진단용으로 이 스크립트를 짧게 또 실행하면(토큰 확인, tmp
  정리 등), 그 진단 실행이 끝나며 걸리는 언마운트가 옆에서 계속 돌고 있던
  봇 프로세스 밑에서 `/dev`·`/proc`·`/sys`를 뽑아버렸다. 봇이 즉시 죽지는
  않지만 `/dev/urandom`처럼 새로 열어야 하는 리소스에서 이상 동작(세션이
  꼬이며 첨부 요청이 반복되는 등)을 일으킨 것으로 보인다. 지금은 마운트가
  한 번 걸리면 그대로 유지되고, 필요할 때만 손으로 푼다:
  ```bash
  su -c 'umount $ROOTFS/dev $ROOTFS/proc $ROOTFS/sys'
  ```

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

### 1-b단계 — proot 대신 진짜 chroot로 (권장, 루팅 기기)

`proot-distro install ubuntu`로 받아둔 rootfs를 그대로 재사용한다 — 다시
받을 필요 없다.

```bash
bash scripts/termux-chroot.sh
```

- root가 아니면 스크립트가 알아서 `su`로 재실행한다(비밀번호/권한 팝업이 뜨면 허용).
- `/dev`·`/proc`·`/sys`를 자동으로 bind mount한다(이미 마운트돼 있으면
  건너뛴다 — 여러 번 실행해도 안전).
- `/sdcard`는 **일부러 자동으로 안 건다.** 최신 안드로이드에서 `/sdcard`는
  FUSE 기반이라 SELinux가 `mount --bind` 자체를 막는 경우가 흔했다
  (2026-09-14 실사용에서 확인). 실제 봇은 커리큘럼 파일을 로컬 저장소가
  아니라 슬랙 API로 받으므로 애초에 `/sdcard` 접근이 필요 없다. CLI로 손수
  테스트할 파일이 있으면 마운트 대신 그냥 복사해 넣는다:
  ```bash
  ROOTFS=/data/data/com.termux/files/usr/var/lib/proot-distro/containers/ubuntu/rootfs
  cp /sdcard/커리큘럼.pdf $ROOTFS/root/instructor-recruiting/
  ```
- PATH·HOME을 깨끗하게 다시 설정하므로 `ls: command not found` 같은 문제가
  없다.
- 안에서 `exit`(또는 Ctrl+D)해도 `/dev`·`/proc`·`/sys`는 마운트된 채로
  남는다 — **2026-09-15부터 자동 언마운트 없음**(위 "결론" 항목 참고).
  다른 프로세스(봇 등)가 같은 rootfs를 계속 쓰고 있을 수 있기 때문이다.
- rootfs 경로가 바뀌었다면 `TERMUX_CHROOT_ROOTFS=/다른/경로 bash scripts/termux-chroot.sh`로
  덮어쓸 수 있다.

이후 안에서는 그냥 `cd /root/instructor-recruiting`처럼 **절대경로**로 이동한다.

### 상주 실행

자동 언마운트가 없어졌으므로, 예전처럼 대화형 셸에서 `&`로 띄우고 `exit`해도
마운트가 빠지지 않는다. 다만 상주 실행은 여전히 명령을 인자로 넘기는 형태를
권장한다 — 그래야 봇이 스크립트의 "메인 프로세스"가 되어 `nohup`/`disown`으로
깔끔하게 백그라운드에 둘 수 있고, 로그도 한 파일로 모인다.

```bash
bash scripts/termux-chroot.sh 'cd /root/instructor-recruiting && exec npm run bot'
```

이걸 Termux 쪽에서 백그라운드로 던져서 상주시킨다.

```bash
nohup bash scripts/termux-chroot.sh \
  'cd /root/instructor-recruiting && exec npm run bot' \
  > ~/bot.log 2>&1 &
disown
```

Termux:Boot 스크립트(`~/.termux/boot/`)에도 이 `nohup ... & disown` 줄을
그대로 넣으면 재부팅 시 자동 기동된다. 로그는 `~/bot.log`에서 `tail -f`로
확인한다.

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
