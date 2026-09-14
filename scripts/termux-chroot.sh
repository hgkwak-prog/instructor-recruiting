#!/data/data/com.termux/files/usr/bin/bash
#
# proot-distro가 이미 받아둔 Ubuntu rootfs로 "진짜" chroot 진입한다.
# proot(ptrace 기반 에뮬레이션)보다 오버헤드가 적다 — 대신 root가 필요하고,
# /dev·/proc·/sys·/sdcard를 bind mount해야 한다. 이 스크립트가 그 과정을
# 전부 대신 하고, 안에서 나가면(exit) 자동으로 언마운트까지 한다.
#
# 사용법:
#   bash scripts/termux-chroot.sh
#
# root가 아니면 자동으로 su로 재실행한다. PATH/HOME이 안 잡히는 문제와
# 매번 마운트 순서를 손으로 챙겨야 하는 문제를 여기서 한 번에 해결한다.

set -e

ROOTFS="${TERMUX_CHROOT_ROOTFS:-/data/data/com.termux/files/usr/var/lib/proot-distro/containers/ubuntu/rootfs}"

if [ "$(id -u)" -ne 0 ]; then
  echo "root 권한이 필요합니다 — su로 재실행합니다."
  exec su -c "TERMUX_CHROOT_ROOTFS='$ROOTFS' bash '$0'"
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
  if mountpoint -q "$target"; then
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
bind_into_rootfs /sdcard

cleanup() {
  echo ""
  echo "정리 중 — bind mount 해제..."
  umount "$ROOTFS/sdcard" 2>/dev/null || true
  umount "$ROOTFS/sys" 2>/dev/null || true
  umount "$ROOTFS/proc" 2>/dev/null || true
  umount "$ROOTFS/dev" 2>/dev/null || true
  echo "완료."
}
trap cleanup EXIT

echo "chroot 진입: $ROOTFS"
echo "(exit 또는 Ctrl+D로 나가면 자동으로 언마운트됩니다)"
echo ""

# env -i로 밖의 환경변수를 깨끗이 지우고 필요한 것만 명시적으로 넣는다.
# 이게 없으면 Termux의 PATH를 그대로 물려받아 안쪽 바이너리를 못 찾는
# "ls: command not found" 문제가 재발한다.
chroot "$ROOTFS" /usr/bin/env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root \
  TERM="${TERM:-xterm}" \
  /bin/bash --login
