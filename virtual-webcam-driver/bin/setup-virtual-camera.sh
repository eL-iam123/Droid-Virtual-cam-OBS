#!/usr/bin/env bash

set -euo pipefail

VIDEO_NR="${VIDEO_NR:-10}"
CARD_LABEL="${CARD_LABEL:-Virtual Webcam Driver}"

run_modprobe() {
  local args=(
    v4l2loopback
    "devices=1"
    "video_nr=${VIDEO_NR}"
    "card_label=${CARD_LABEL}"
    "exclusive_caps=1"
  )

  if [[ "$(id -u)" -eq 0 ]]; then
    /usr/sbin/modprobe "${args[@]}"
    return
  fi

  if [[ -t 0 ]] && command -v sudo >/dev/null 2>&1; then
    sudo /usr/sbin/modprobe "${args[@]}"
    return
  fi

  if command -v pkexec >/dev/null 2>&1; then
    pkexec /usr/sbin/modprobe "${args[@]}"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo /usr/sbin/modprobe "${args[@]}"
    return
  fi

  echo "No privilege escalation tool is available. Install pkexec or sudo." >&2
  exit 1
}

if [[ -e "/dev/video${VIDEO_NR}" ]]; then
  echo "Virtual camera already available at /dev/video${VIDEO_NR}"
  exit 0
fi

if ! command -v modprobe >/dev/null 2>&1; then
  echo "modprobe is not available on this system." >&2
  exit 1
fi

echo "Creating V4L2 loopback device at /dev/video${VIDEO_NR}..."
run_modprobe

if [[ -e "/dev/video${VIDEO_NR}" ]]; then
  echo "Virtual camera ready: /dev/video${VIDEO_NR}"
  exit 0
fi

echo "v4l2loopback was loaded, but /dev/video${VIDEO_NR} was not created." >&2
exit 1
