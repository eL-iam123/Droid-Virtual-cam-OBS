#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

LOG_DIR="${ROOT_DIR}/.logs"
mkdir -p "${LOG_DIR}"

print_step() {
  printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$1"
}

pause_on_failure() {
  local exit_code=$?
  if [[ "${exit_code}" -ne 0 && -t 0 ]]; then
    echo
    echo "Setup did not complete."
    read -r -p "Press Enter to close this window..." _ || true
  fi
  exit "${exit_code}"
}

has_loopback_device() {
  local sys_path
  for sys_path in /sys/class/video4linux/video*; do
    [[ -e "${sys_path}" ]] || continue
    local name
    local device_real_path
    name="$(cat "${sys_path}/name" 2>/dev/null || true)"
    device_real_path="$(realpath "${sys_path}/device" 2>/dev/null || true)"

    if [[ "${device_real_path}" == *"/devices/virtual/"* ]]; then
      return 0
    fi

    if [[ "${name}" =~ loopback|Loopback|virtual|Virtual|Dummy|dummy ]]; then
      return 0
    fi
  done

  return 1
}

trap pause_on_failure EXIT

print_step "Starting Virtual Webcam Driver setup"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required before the app can run." >&2
  exit 1
fi

if [[ ! -x "${ROOT_DIR}/node_modules/.bin/electron" ]]; then
  print_step "Installing app dependencies"
  npm install
else
  print_step "Dependencies already installed"
fi

if [[ ! -e "${XDG_DATA_HOME:-$HOME/.local/share}/applications/virtual-webcam-driver.desktop" ]]; then
  print_step "Installing desktop launcher"
  "${ROOT_DIR}/bin/install-desktop-entry.sh"
fi

if has_loopback_device; then
  print_step "Virtual camera already available"
else
  print_step "Creating virtual camera for OBS"
  "${ROOT_DIR}/bin/setup-virtual-camera.sh"
fi

if ! command -v droidcam-cli >/dev/null 2>&1; then
  print_step "droidcam-cli not found"
  echo "The desktop app will open, but camera start will fail until droidcam-cli is installed."
fi

print_step "Launching app"
trap - EXIT
exec "${ROOT_DIR}/bin/launch-ui.sh"
