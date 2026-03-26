#!/usr/bin/env bash

set -euo pipefail

run_modprobe() {
  local args=(snd_aloop)

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

if [[ -d /sys/module/snd_aloop || -e /proc/asound/Loopback ]]; then
  echo "ALSA loopback already available."
  exit 0
fi

if ! command -v modprobe >/dev/null 2>&1; then
  echo "modprobe is not available on this system." >&2
  exit 1
fi

echo "Creating ALSA loopback device for DroidCam audio..."
run_modprobe

if [[ -d /sys/module/snd_aloop || -e /proc/asound/Loopback ]]; then
  echo "ALSA loopback ready."
  exit 0
fi

echo "snd_aloop was loaded, but the ALSA loopback device was not created." >&2
exit 1
