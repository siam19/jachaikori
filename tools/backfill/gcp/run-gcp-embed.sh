#!/usr/bin/env bash
set -euo pipefail

# Helper script to run BAAI/bge-m3 batch embedding concurrently across multiple
# GCP Cloud Run GPU tasks (nvidia-l4) using modulo sharding.
# Works regardless of current working directory (repo root or tools/backfill/gcp/).
#
# Prerequisites:
#   1. bun run backfill chunk   -> produces data/index/chunks.jsonl
#   2. gcloud auth login && gcloud config set project <YOUR_PROJECT_ID>
#
# Usage:
#   ./tools/backfill/gcp/run-gcp-embed.sh [options]
# Options:
#   --tasks <n>          Total parallel shards / Cloud Run tasks (default: 8)
#   --parallelism <n>    Max simultaneous GPU tasks (default: same as --tasks; lower if L4 quota caps concurrency)
#   --batch-size <n>     GPU inference batch size (default: 64)
#   --run-id <id>        Explicit run ID (default: timestamp; saved to data/index/.gcp-embed-run)
#   --skip-build         Skip Docker image rebuild & push
#   --skip-upload        Reuse chunks.jsonl already in GCS for --run-id
#   --download-only      Only download shards from --run-id into data/index/shards/latest/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
INDEX_DIR="${REPO_ROOT}/data/index"
CHUNKS_FILE="${INDEX_DIR}/chunks.jsonl"
STATE_FILE="${INDEX_DIR}/.gcp-embed-run"
SHARDS_OUT_DIR="${INDEX_DIR}/shards/latest"

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GCP_REGION:-asia-southeast1}"
AR_REPO="${GCP_AR_REPO:-jachaikori}"
BUCKET="${GCP_BUCKET:-jachaikori-backfill-${PROJECT_ID}}"
JOB_NAME="${GCP_JOB_NAME:-jachaikori-embed}"

TASKS="${GCP_EMBED_TASKS:-8}"
PARALLELISM="${GCP_EMBED_PARALLELISM:-}"
BATCH_SIZE="${GCP_BATCH_SIZE:-64}"
RUN_ID=""
SKIP_BUILD=false
SKIP_UPLOAD=false
DOWNLOAD_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tasks)
      TASKS="$2"
      shift 2
      ;;
    --parallelism)
      PARALLELISM="$2"
      shift 2
      ;;
    --batch-size)
      BATCH_SIZE="$2"
      shift 2
      ;;
    --run-id)
      RUN_ID="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-upload)
      SKIP_UPLOAD=true
      shift
      ;;
    --download-only)
      DOWNLOAD_ONLY=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${PARALLELISM}" ]]; then
  PARALLELISM="${TASKS}"
fi

if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "ERROR: Set GCP_PROJECT_ID or run 'gcloud config set project <PROJECT_ID>'" >&2
  exit 1
fi

if [[ -z "${RUN_ID}" ]]; then
  if [[ "${SKIP_UPLOAD}" == "true" || "${DOWNLOAD_ONLY}" == "true" ]] && [[ -f "${STATE_FILE}" ]]; then
    RUN_ID="$(cat "${STATE_FILE}")"
  else
    RUN_ID="$(date -u +%Y%m%d-%H%M%S)"
  fi
fi

mkdir -p "${INDEX_DIR}"
printf "%s" "${RUN_ID}" > "${STATE_FILE}"

GCS_RUN_PREFIX="gs://${BUCKET}/embed-runs/${RUN_ID}"
GCS_CHUNKS_URI="${GCS_RUN_PREFIX}/chunks.jsonl"
GCS_SHARDS_URI="${GCS_RUN_PREFIX}/shards"

echo "==> Project: ${PROJECT_ID} | Region: ${REGION} | Bucket: gs://${BUCKET}"
echo "==> Run ID: ${RUN_ID} | Shards (tasks): ${TASKS} | Max concurrent GPUs: ${PARALLELISM} | Batch size: ${BATCH_SIZE}"

if [[ "${DOWNLOAD_ONLY}" == "false" ]]; then
  if [[ ! -s "${CHUNKS_FILE}" && "${SKIP_UPLOAD}" == "false" ]]; then
    echo "ERROR: Missing or empty ${CHUNKS_FILE}" >&2
    echo "Run 'bun run backfill chunk' from ${REPO_ROOT} first." >&2
    exit 1
  fi

  echo "==> Enabling required GCP APIs (Storage, Artifact Registry, Cloud Build, Cloud Run)..."
  gcloud services enable \
    storage.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    --project="${PROJECT_ID}"

  echo "==> Ensuring GCS bucket gs://${BUCKET} exists..."
  if ! gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud storage buckets create "gs://${BUCKET}" \
      --project="${PROJECT_ID}" \
      --location="${REGION}" \
      --uniform-bucket-level-access
  fi

  # Ensure default compute service account (used by Cloud Run Jobs) can read/write the bucket
  PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)' 2>/dev/null || true)"
  if [[ -n "${PROJECT_NUMBER}" ]]; then
    COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
    gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
      --member="serviceAccount:${COMPUTE_SA}" \
      --role="roles/storage.objectAdmin" >/dev/null 2>&1 || true
  fi

  if [[ "${SKIP_UPLOAD}" == "false" ]]; then
    echo "==> Uploading ${CHUNKS_FILE} to ${GCS_CHUNKS_URI}..."
    gcloud storage cp "${CHUNKS_FILE}" "${GCS_CHUNKS_URI}" --project="${PROJECT_ID}"
  else
    echo "==> Reusing existing ${GCS_CHUNKS_URI} (--skip-upload)"
  fi

  IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/bge-m3:latest"

  if [[ "${SKIP_BUILD}" == "false" ]]; then
    echo "==> Ensuring Artifact Registry Docker repository '${AR_REPO}' exists..."
    if ! gcloud artifacts repositories describe "${AR_REPO}" \
      --project="${PROJECT_ID}" \
      --location="${REGION}" >/dev/null 2>&1; then
      gcloud artifacts repositories create "${AR_REPO}" \
        --project="${PROJECT_ID}" \
        --location="${REGION}" \
        --repository-format=docker \
        --description="Jachaikori GPU batch embedding images"
    fi

    echo "==> Building & pushing GPU embedder container (${IMAGE})..."
    gcloud builds submit "${SCRIPT_DIR}" \
      --project="${PROJECT_ID}" \
      --tag="${IMAGE}" \
      --timeout=1800s
  else
    echo "==> Skipping Cloud Build (--skip-build), using ${IMAGE}"
  fi

  echo "==> Deploying Cloud Run GPU Job (${JOB_NAME}: tasks=${TASKS}, parallelism=${PARALLELISM}, nvidia-l4)..."
  gcloud run jobs deploy "${JOB_NAME}" \
    --project="${PROJECT_ID}" \
    --image="${IMAGE}" \
    --region="${REGION}" \
    --gpu=1 \
    --gpu-type=nvidia-l4 \
    --no-gpu-zonal-redundancy \
    --cpu=4 \
    --memory=16Gi \
    --tasks="${TASKS}" \
    --parallelism="${PARALLELISM}" \
    --max-retries=1 \
    --task-timeout=3600 \
    --set-env-vars="GCS_BUCKET=${BUCKET},RUN_ID=${RUN_ID},BATCH_SIZE=${BATCH_SIZE}" \
    --args="--require-gpu"

  echo "==> Executing Cloud Run GPU Job (${JOB_NAME})..."
  echo "    (If regional L4 GPU quota rejects parallelism=${PARALLELISM}, re-run with:"
  echo "     $0 --skip-build --skip-upload --run-id ${RUN_ID} --tasks ${TASKS} --parallelism 3)"
  gcloud run jobs execute "${JOB_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --wait
fi

echo "==> Downloading sharded vectors & manifests from ${GCS_SHARDS_URI}/ to ${SHARDS_OUT_DIR}/..."
rm -rf "${SHARDS_OUT_DIR}"
mkdir -p "${SHARDS_OUT_DIR}"
gcloud storage cp -r \
  "${GCS_SHARDS_URI}/*" \
  "${SHARDS_OUT_DIR}/" \
  --project="${PROJECT_ID}"

echo "==> Done! Downloaded $(ls -1 "${SHARDS_OUT_DIR}"/part-*.manifest.json 2>/dev/null | wc -l) shard(s)."
echo "    Next run from ${REPO_ROOT}:"
echo "    bun run backfill import-vectors && bun run backfill cluster && bun run backfill resolve-entities"
