#!/usr/bin/env bash
set -euo pipefail

# Wrapper for official Vertex AI Batch Prediction (gemini-2.5-flash, thinking_budget=0)
# Usage:
#   ./tools/backfill/gcp/run-vertex-batch.sh \
#     --tag candidates \
#     --input data/index/batch-stage-a-candidates.jsonl \
#     --output data/index/batch-stage-a-results.jsonl \
#     [--pilot 10] [--direct] [--dry-run] [--max-usd 50]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${SCRIPT_DIR}/vertex_batch.py" "$@"
