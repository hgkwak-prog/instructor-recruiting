#!/data/data/com.termux/files/usr/bin/bash
#
# proot-distro가 이미 받아둔 Ubuntu rootfs로 "진짜" chroot 진입한다.
# proot(ptrace 기반 에뮬레이션)보다 오버헤드가 적다 — 대신 root가 필요하고,
# /dev·/proc·/sys를 bind mount해야 한다. 이 스크립트가 그 과정을 대신 한다.
#
# 사용법:
#   bash scripts/termux-chroot.sh                 # 대화형 셸 (테스트용)
#   bash scripts/termux-chroot.sh '<명령어>'       # 그 명령을 포그라운드로 실행
#
# **더 이상 자동으로 언마운트하지 않는다(2026-09-15 변경).** 예전엔 대화형
# 셸이 끝나거나 넘겨준 명령이 끝나면 trap으로 /dev·/proc·/sys를 자동
# 언마운트했는데, 이게 실전에서 문제를 일으켰다: 봇을 nohup으로 띄워 상주시킨
# 뒤에도 같은 rootfs에 대해 진단용으로 이 스크립트를 짧게 여러 번 더 실행하는
# 일이 흔했고(예: curl로 토큰 확인, tmp 정리 등), 그 "다른" 실행이 끝나면서
# 언마운트가 걸리면 옆에서 계속 돌고 있던 봇 프로세스 밑에서 /dev·/proc·/sys가
# 뽑혀 나가 버렸다. 봇이 죽지는 않지만 /dev/urandom 같은 걸 새로 열어야 하는
# 시점에 이상 동작을 일으켰고, 그게 "세션 로그가 바뀌면서 첨부 요청이 반복해서
# 뜨는" 증상의 원인으로 의심된다.
#
# 이제 마운트는 한 번 걸리면 그대로 유지된다. 봇을 재시작하거나 rootfs를
# 정리하는 등 명시적으로 마운트를 풀어야 할 때만 아래처럼 직접 unmount한다:
#
#   su -c 'umount $ROOTFS/dev $ROOTFS/proc $ROOTFS/sys'
#
# 봇 상주 실행:
#   nohup bash scripts/termux-chroot.sh \
#     'cd /root/instructor-recruiting && exec npm run bot' \
#     > ~/bot.log 2>&1 &
#   disown
#
# root가 아니면 자동으로 su로 재실행한다. PATH/HOME이 안 잡히는 문제와
# 매번 마운트 순서를 손으로 챙겨야 하는 문제를 여기서 한 번에 해결한다.

set -e

ROOTFS="${TERMUX_CHROOT_ROOTFS:-/data/data/com.termux/files/usr/var/lib/proot-distro/containers/ubuntu/rootfs}"

# `su`가 띄우는 쉘은 안드로이드 기본 쉘(/system/bin/sh)이라 Termux의 PATH를
# 안 물려받는다 — "bash"라고만 부르면 못 찾는다. 절대경로를 미리 잡아 둔다.
BASH_BIN="${BASH_BIN:-/data/data/com.termux/files/usr/bin/bash}"

if [ "$(id -u)" -ne 0 ]; then
  echo "root 권한이 필요합니다 — su로 재실행합니다."
  # 넘겨받은 인자(봇 실행 명령 등)를 안전하게 이스케이프해서 su -c로 그대로 전달한다.
  quoted_args=""
  for arg in "$@"; do
    quoted_args="$quoted_args $(printf '%q' "$arg")"
  done
  exec su -c "TERMUX_CHROOT_ROOTFS='$ROOTFS' '$BASH_BIN' '$0'$quoted_args"
fi

if [ ! -d "$ROOTFS" ]; then
  echo "rootfs를 찾을 수 없습니다: $ROOTFS"
  echo "proot-distro install ubuntu 를 먼저 실행했는지, 경로가 바뀌지 않았는지 확인하세요."
  exit 1
fi

# 소스 경로 -> rootfs 안 같은 경로에 bind mount. 이미 마운트돼 있으면 건너뛴다
# (재실행해도 안전하게).
bind_into_rootfs() {
  local path="$1"
  local target="$ROOTFS$path"
  mkdir -p "$target"
  # `mountpoint` 명령이 Termux 기본 설치엔 없을 수 있어 /proc/self/mounts를
  # 직접 본다 — 이미 마운트돼 있으면 다시 mount하지 않는다(중복 마운트 방지).
  if grep -qs " $(printf '%s' "$target" | sed 's/ /\\040/g') " /proc/self/mounts; then
    return 0
  fi
  if [ ! -e "$path" ]; then
    echo "건너뜀 (호스트에 없음): $path"
    return 0
  fi
  mount --bind "$path" "$target"
  echo "마운트: $path -> $target"
}

bind_into_rootfs /dev
bind_into_rootfs /proc
bind_into_rootfs /sys
# /sdcard는 일부러 안 건다 — 최신 안드로이드에서 FUSE 기반이라 SELinux가
# bind mount 자체를 막는 경우가 흔하고, 실제 봇은 커리큘럼 파일을 로컬
# 저장소가 아니라 슬랙 API로 받으므로 애초에 필요 없다. CLI로 손수 테스트할
# 파일이 있으면 `cp /sdcard/파일 $ROOTFS/root/...`로 복사해 넣는 편이 낫다.

# 자동 언마운트 없음(2026-09-15) — 마운트는 그대로 두고 나간다. 상주 중인
# 다른 프로세스(봇 등)가 같은 rootfs를 쓰고 있을 수 있어서, 이 실행이 끝난다고
# /dev·/proc·/sys를 뽑아버리면 그쪽이 깨진다. 필요하면 위 안내대로 손으로 umount.

# env -i로 밖의 환경변수를 깨끗이 지우고 필요한 것만 명시적으로 넣는다.
# 이게 없으면 Termux의 PATH를 그대로 물려받아 안쪽 바이너리를 못 찾는
# "ls: command not found" 문제가 재발한다.
if [ "$#" -eq 0 ]; then
  echo "chroot 진입 (대화형): $ROOTFS"
  echo "(exit 또는 Ctrl+D로 나가도 /dev·/proc·/sys는 마운트된 채로 남습니다 — 자동 언마운트 없음)"
  echo ""
  chroot "$ROOTFS" /usr/bin/env -i \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/root \
    TERM="${TERM:-xterm}" \
    /bin/bash --login
else
  # 명령을 넘겨받으면 그걸 메인 프로세스로 포그라운드 실행한다. 이 명령이
  # 실제로 끝날 때만(봇이 죽거나 사람이 Ctrl+C 하거나) 언마운트가 일어난다.
  # 상주 실행은 항상 이 경로를 쓸 것 — 대화형 셸에서 `&`로 백그라운드
  # 던지고 exit하면 그 순간 /dev·/proc·/sys가 뽑혀 나간다.
  echo "chroot 진입 (명령 실행): $ROOTFS"
  echo "명령: $*"
  chroot "$ROOTFS" /usr/bin/env -i \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/root \
    TERM="${TERM:-xterm}" \
    /bin/bash -lc "$*"
fi
