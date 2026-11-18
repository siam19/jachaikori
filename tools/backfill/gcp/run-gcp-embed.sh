#!/usr/bin/env bash
set -euo pipefail

# Helper script to run BAAI/bge-m3 batch embedding on a GCP Cloud Run GPU job (nvidia-l4).
# Works regardless of current working directory (repo root or tools/backfill/gcp/).
#
# Prerequisites:
#   1. bun run backfill chunk   -> produces data/index/chunks.jsonl
#   2. gcloud auth login && gcloud config set project <YOUR_PROJECT_ID>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
INDEX_DIR="${REPO_ROOT}/data/index"
CHUNKS_FILE="${INDEX_DIR}/chunks.jsonl"

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GCP_REGION:-asia-southeast1}"
AR_REPO="${GCP_AR_REPO:-jachaikori}"
BUCKET="${GCP_BUCKET:-jachaikori-backfill-${PROJECT_ID}}"
JOB_NAME="${GCP_JOB_NAME:-jachaikori-embed}"

if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "ERROR: Set GCP_PROJECT_ID or run 'gcloud config set project <PROJECT_ID>'" >&2
  exit 1
fi

if [[ ! -s "${CHUNKS_FILE}" ]]; then
  echo "ERROR: Missing or empty ${CHUNKS_FILE}" >&2
  echo "Run 'bun run backfill chunk' from ${REPO_ROOT} first." >&2
  exit 1
fi

echo "==> Project: ${PROJECT_ID} | Region: ${REGION} | Bucket: gs://${BUCKET}"

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

echo "==> Uploading ${CHUNKS_FILE} to gs://${BUCKET}/chunks.jsonl"
gcloud storage cp "${CHUNKS_FILE}" "gs://${BUCKET}/chunks.jsonl" --project="${PROJECT_ID}"

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

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/bge-m3:latest"
echo "==> Building & pushing GPU embedder container (${IMAGE})"
gcloud builds submit "${SCRIPT_DIR}" \
  --project="${PROJECT_ID}" \
  --tag="${IMAGE}" \
  --timeout=1800s

echo "==> Deploying & executing Cloud Run GPU Job (${JOB_NAME} on nvidia-l4)"
gcloud run jobs deploy "${JOB_NAME}" \
  --project="${PROJECT_ID}" \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --gpu=1 \
  --gpu-type=nvidia-l4 \
  --no-gpu-zonal-redundancy \
  --cpu=4 \
  --memory=16Gi \
  --max-retries=1 \
  --task-timeout=3600 \
  --args="--gcs-bucket,${BUCKET},--require-gpu"

gcloud run jobs execute "${JOB_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --wait

echo "==> Downloading vectors.f32.bin & manifest.json to ${INDEX_DIR}/"
mkdir -p "${INDEX_DIR}"
gcloud storage cp \
  "gs://${BUCKET}/vectors.f32.bin" \
  "gs://${BUCKET}/manifest.json" \
  "${INDEX_DIR}/" \
  --project="${PROJECT_ID}"

echo "==> Done! Next run from ${REPO_ROOT}:"
echo "    bun run backfill import-vectors && bun run backfill cluster"
