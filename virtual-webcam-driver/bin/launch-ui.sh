#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

LOG_DIR="${ROOT_DIR}/.logs"
LOG_FILE="${LOG_DIR}/launcher.log"
mkdir -p "${LOG_DIR}"

if [[ ! -x "${ROOT_DIR}/node_modules/.bin/electron" ]]; then
  echo "electron is not installed yet. Run npm install once in ${ROOT_DIR}." | tee -a "${LOG_FILE}" >&2
  exit 1
fi

export ELECTRON_ENABLE_LOGGING="${ELECTRON_ENABLE_LOGGING:-1}"

{
  echo "[$(date --iso-8601=seconds)] launching virtual-webcam-driver"
  exec env -u ELECTRON_RUN_AS_NODE "${ROOT_DIR}/node_modules/.bin/electron" .
} >>"${LOG_FILE}" 2>&1
