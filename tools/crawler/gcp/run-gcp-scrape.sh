#!/usr/bin/env bash
set -euo pipefail

# Coordinated multi-job GCP Cloud Run scraper for Jachaikori.
# - Excludes 'skipped' and 'extracted' rows from data/catalog.sqlite
# - Runs HTTP (5 outlets) and Browser/Playwright (3 outlets) Cloud Run Jobs simultaneously
# - Coordinates work chunks via atomic GCS leases so tasks never duplicate work
# - Safe to Ctrl+C anytime; re-running resumes live progress and imports finished results into data/catalog.sqlite
#
# Usage:
#   ./tools/crawler/gcp/run-gcp-scrape.sh [options]
# Options:
#   --rebuild         Rebuild & redeploy the Docker image and Cloud Run Jobs
#   --new             Start a fresh run even if an un-imported run exists in GCS
#   --retry-failed    Include previously failed articles
#   --outlets <csv>   Comma-separated outlet IDs (e.g. daily-star,prothom-alo)
#   --http-tasks <n>  Parallel tasks for HTTP job (default: 8)
#   --browser-tasks <n> Parallel tasks for Browser job (default: 6)
#   --chunk-size <n>  Articles per coordinated chunk (default: 200)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GCP_REGION:-asia-southeast1}"
AR_REPO="${GCP_AR_REPO:-jachaikori}"
BUCKET="${GCP_BUCKET:-jachaikori-backfill-${PROJECT_ID}}"
HTTP_JOB="${GCP_HTTP_JOB:-jachaikori-scrape-http}"
BROWSER_JOB="${GCP_BROWSER_JOB:-jachaikori-scrape-browser}"
HTTP_TASKS="${GCP_HTTP_TASKS:-8}"
BROWSER_TASKS="${GCP_BROWSER_TASKS:-6}"
CHUNK_SIZE="${GCP_CHUNK_SIZE:-200}"

REBUILD=false
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild)
      REBUILD=true
      shift
      ;;
    --http-tasks)
      HTTP_TASKS="$2"
      shift 2
      ;;
    --browser-tasks)
      BROWSER_TASKS="$2"
      shift 2
      ;;
    --chunk-size)
      CHUNK_SIZE="$2"
      shift 2
      ;;
    --new|--retry-failed|--detach)
      EXTRA_ARGS+=("$1")
      shift
      ;;
    --outlets|-o)
      EXTRA_ARGS+=("--outlets" "$2")
      shift 2
      ;;
    --exclude-outlets|-x)
      EXTRA_ARGS+=("--exclude-outlets" "$2")
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "ERROR: Set GCP_PROJECT_ID or run 'gcloud config set project <PROJECT_ID>'" >&2
  exit 1
fi

echo "==> Project: ${PROJECT_ID} | Region: ${REGION} | Bucket: gs://${BUCKET}"

# Check if jobs already exist; only build & deploy if missing or --rebuild passed
JOBS_EXIST=true
if ! gcloud run jobs describe "${HTTP_JOB}" --project="${PROJECT_ID}" --region="${REGION}" >/dev/null 2>&1; then
  JOBS_EXIST=false
fi
if ! gcloud run jobs describe "${BROWSER_JOB}" --project="${PROJECT_ID}" --region="${REGION}" >/dev/null 2>&1; then
  JOBS_EXIST=false
fi

if [[ "${REBUILD}" == "true" || "${JOBS_EXIST}" == "false" ]]; then
  echo "==> Enabling required GCP APIs..."
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

  PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)' 2>/dev/null || true)"
  if [[ -n "${PROJECT_NUMBER}" ]]; then
    COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
    gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
      --member="serviceAccount:${COMPUTE_SA}" \
      --role="roles/storage.objectAdmin" >/dev/null 2>&1 || true
  fi

  echo "==> Ensuring Artifact Registry repository '${AR_REPO}' exists..."
  if ! gcloud artifacts repositories describe "${AR_REPO}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" >/dev/null 2>&1; then
    gcloud artifacts repositories create "${AR_REPO}" \
      --project="${PROJECT_ID}" \
      --location="${REGION}" \
      --repository-format=docker \
      --description="Jachaikori crawler & backfill images"
  fi

  IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/crawler-worker:latest"
  echo "==> Building & pushing crawler worker image (${IMAGE})..."
  gcloud builds submit "${REPO_ROOT}" \
    --project="${PROJECT_ID}" \
    --config="${SCRIPT_DIR}/cloudbuild.yaml" \
    --substitutions="_IMAGE=${IMAGE}" \
    --timeout=1800s

  echo "==> Deploying Cloud Run Job: ${HTTP_JOB} (HTTP outlets)"
  gcloud run jobs deploy "${HTTP_JOB}" \
    --project="${PROJECT_ID}" \
    --image="${IMAGE}" \
    --region="${REGION}" \
    --cpu=1 \
    --memory=1Gi \
    --max-retries=1 \
    --task-timeout=86400 \
    --set-env-vars="GCS_BUCKET=${BUCKET},POOL=http,JOB_NAME=${HTTP_JOB}"

  echo "==> Deploying Cloud Run Job: ${BROWSER_JOB} (Playwright outlets)"
  gcloud run jobs deploy "${BROWSER_JOB}" \
    --project="${PROJECT_ID}" \
    --image="${IMAGE}" \
    --region="${REGION}" \
    --cpu=2 \
    --memory=2Gi \
    --max-retries=1 \
    --task-timeout=86400 \
    --set-env-vars="GCS_BUCKET=${BUCKET},POOL=browser,JOB_NAME=${BROWSER_JOB}"
fi

cd "${REPO_ROOT}"
exec bun run tools/crawler/src/cli.ts gcp-scrape \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --bucket "${BUCKET}" \
  --http-job "${HTTP_JOB}" \
  --browser-job "${BROWSER_JOB}" \
  --http-tasks "${HTTP_TASKS}" \
  --browser-tasks "${BROWSER_TASKS}" \
  --chunk-size "${CHUNK_SIZE}" \
  ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
