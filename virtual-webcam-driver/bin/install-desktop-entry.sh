#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_TEMPLATE="${ROOT_DIR}/Virtual Webcam Driver.desktop"
APPLICATIONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
TARGET_DESKTOP_FILE="${APPLICATIONS_DIR}/virtual-webcam-driver.desktop"

mkdir -p "${APPLICATIONS_DIR}"

ESCAPED_ROOT_DIR="${ROOT_DIR//\\/\\\\}"
ESCAPED_ROOT_DIR="${ESCAPED_ROOT_DIR//&/\\&}"

sed "s|__APP_ROOT__|${ESCAPED_ROOT_DIR}|g" "${DESKTOP_TEMPLATE}" > "${TARGET_DESKTOP_FILE}"
chmod +x "${TARGET_DESKTOP_FILE}"

echo "Installed desktop entry:"
echo "  ${TARGET_DESKTOP_FILE}"
echo
echo "You can now launch Virtual Webcam Driver from your applications menu."
