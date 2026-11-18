#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

PILOT_LIMIT="${PILOT_LIMIT:-200}"
INPUT_JSONL="${INPUT_JSONL:-${REPO_ROOT}/data/index/requests.jsonl}"
OUTPUT_JSONL="${OUTPUT_JSONL:-${REPO_ROOT}/data/index/llm-extractions.jsonl}"

exec python3 "${SCRIPT_DIR}/extract_gemini.py" \
  --input "${INPUT_JSONL}" \
  --output "${OUTPUT_JSONL}" \
  --pilot "${PILOT_LIMIT}" \
  "$@"
