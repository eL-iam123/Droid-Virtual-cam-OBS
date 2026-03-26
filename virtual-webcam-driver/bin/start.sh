#!/usr/bin/env bash

set -euo pipefail

PROFILE="${PROFILE:-recording}"
SOURCE_MODE="${SOURCE_MODE:-wifi}"
DROIDCAM_HOST="${DROIDCAM_HOST:-}"
DROIDCAM_PORT="${DROIDCAM_PORT:-4747}"
VIDEO_DEVICE="${VIDEO_DEVICE:-}"
ANDROID_SERIAL="${ANDROID_SERIAL:-}"

case "${PROFILE}" in
  gaming)
    DROIDCAM_SIZE="${DROIDCAM_SIZE:-1280x720}"
    ENABLE_AUDIO="${ENABLE_AUDIO:-0}"
    ;;
  recording)
    DROIDCAM_SIZE="${DROIDCAM_SIZE:-1920x1080}"
    ENABLE_AUDIO="${ENABLE_AUDIO:-0}"
    ;;
  recording-audio)
    DROIDCAM_SIZE="${DROIDCAM_SIZE:-1920x1080}"
    ENABLE_AUDIO="${ENABLE_AUDIO:-1}"
    ;;
  low-latency)
    DROIDCAM_SIZE="${DROIDCAM_SIZE:-960x720}"
    ENABLE_AUDIO="${ENABLE_AUDIO:-0}"
    ;;
  *)
    echo "Unsupported PROFILE=${PROFILE}" >&2
    exit 64
    ;;
esac

if ! command -v droidcam-cli >/dev/null 2>&1; then
  echo "droidcam-cli not found on PATH" >&2
  exit 127
fi

ARGS=(-v -nocontrols "-size=${DROIDCAM_SIZE}")

if [[ "${ENABLE_AUDIO}" == "1" ]]; then
  ARGS+=(-a)
fi

if [[ -n "${VIDEO_DEVICE}" ]]; then
  ARGS+=("-dev=${VIDEO_DEVICE}")
fi

case "${SOURCE_MODE}" in
  wifi)
    if [[ -z "${DROIDCAM_HOST}" ]]; then
      echo "DROIDCAM_HOST is required when SOURCE_MODE=wifi" >&2
      exit 64
    fi
    TARGET=("${DROIDCAM_HOST}" "${DROIDCAM_PORT}")
    ;;
  adb)
    TARGET=(adb "${DROIDCAM_PORT}")
    if [[ -n "${ANDROID_SERIAL}" ]]; then
      export ANDROID_SERIAL
    fi
    ;;
  ios)
    TARGET=(ios "${DROIDCAM_PORT}")
    ;;
  listen)
    TARGET=(-l "${DROIDCAM_PORT}")
    ;;
  *)
    echo "Unsupported SOURCE_MODE=${SOURCE_MODE}" >&2
    exit 64
    ;;
esac

echo "[$(date --iso-8601=seconds)] starting profile=${PROFILE} mode=${SOURCE_MODE} target=${TARGET[*]} size=${DROIDCAM_SIZE} audio=${ENABLE_AUDIO} device=${VIDEO_DEVICE:-auto}"
exec droidcam-cli "${ARGS[@]}" "${TARGET[@]}"
