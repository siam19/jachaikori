#!/usr/bin/env python3
"""
Zero-dependency Async Vertex AI Batch Prediction runner for Jachaikori Entity Resolution v2.
Uses only Python stdlib + `gcloud` CLI (no pip packages required!).

Supports all 4 Sprint 5 stages using `gemini-2.5-flash` with `thinkingBudget: 0`:
  - Stage A:  verify-candidates (grouped 25 candidates/prompt)
  - Stage A2: judge-merges      (borderline cross-script / variant entity pairs)
  - Stage B:  extract-events    (17-type directional relations + structured claims on multi-outlet clusters)
  - Stage C:  generate-dossiers (corpus-grounded bilingual entity bios + taglines)

Modes:
  - Default: Official Vertex AI Batch Prediction REST API via GCS (50% off standard pricing, async parallel)
  - --direct: Concurrent online Vertex REST API mode (ThreadPoolExecutor) for fast <=200-request pilots
  - --dry-run: Print exact request count, token estimate, and USD estimate without spending credits
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Vertex AI Gemini 2.5 Flash pricing (USD per 1M tokens)
BATCH_INPUT_PRICE_PER_M = 0.15
BATCH_OUTPUT_PRICE_PER_M = 1.25
ONLINE_INPUT_PRICE_PER_M = 0.30
ONLINE_OUTPUT_PRICE_PER_M = 2.50

ARTICLE_ID_RE = re.compile(r"ARTICLE_ID:\s*([A-Za-z0-9_-]+)")
ENTITY_ID_RE = re.compile(r'"id"\s*:\s*"([^"]+)"')


def run_cmd(cmd: list[str], capture: bool = False) -> str:
    res = subprocess.run(cmd, check=True, text=True, capture_output=capture)
    return res.stdout.strip() if capture else ""


def detect_gcp_project() -> str:
    env_proj = os.environ.get("GCP_PROJECT_ID") or os.environ.get("GOOGLE_CLOUD_PROJECT")
    if env_proj:
        return env_proj.strip()
    try:
        proj = run_cmd(["gcloud", "config", "get-value", "project"], capture=True)
        if proj and proj != "(unset)":
            return proj
    except Exception:
        pass
    return ""


class TokenProvider:
    def __init__(self) -> None:
        self._token = ""
        self._fetched_at = 0.0

    def invalidate(self) -> None:
        self._token = ""
        self._fetched_at = 0.0

    def get(self, force_refresh: bool = False) -> str:
        # Refresh every 15 minutes (or immediately on force_refresh after 401)
        if force_refresh or not self._token or (time.time() - self._fetched_at) > 900:
            self._token = run_cmd(["gcloud", "auth", "print-access-token"], capture=True)
            self._fetched_at = time.time()
        return self._token


def http_json(
    url: str,
    token: str,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    timeout: int = 90,
) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"HTTP {e.code} on {method} {url}: {err_body}") from e


def slice_and_estimate(
    input_path: Path,
    sliced_path: Path,
    pilot: int | None,
    avg_out_tokens: int,
    direct: bool,
) -> tuple[int, int, int, float]:
    count = 0
    total_chars = 0
    sliced_path.parent.mkdir(parents=True, exist_ok=True)
    with input_path.open("r", encoding="utf-8") as src, sliced_path.open("w", encoding="utf-8") as dst:
        for line in src:
            if not line.strip():
                continue
            dst.write(line)
            total_chars += len(line)
            count += 1
            if pilot is not None and pilot > 0 and count >= pilot:
                break

    est_in_tokens = int(total_chars / 3.2)
    est_out_tokens = count * avg_out_tokens
    in_rate = ONLINE_INPUT_PRICE_PER_M if direct else BATCH_INPUT_PRICE_PER_M
    out_rate = ONLINE_OUTPUT_PRICE_PER_M if direct else BATCH_OUTPUT_PRICE_PER_M
    est_usd = (est_in_tokens / 1_000_000) * in_rate + (est_out_tokens / 1_000_000) * out_rate
    return count, est_in_tokens, est_out_tokens, est_usd


def extract_text_from_response_dict(resp_obj: dict[str, Any]) -> tuple[str | None, str | None]:
    candidates = resp_obj.get("candidates") or []
    if not candidates:
        return None, "no_candidates"
    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    texts = [p.get("text", "") for p in parts if isinstance(p, dict) and "text" in p and not p.get("thought")]
    joined = "".join(texts).strip()
    if not joined:
        return None, "empty_text"
    return joined, None


def recover_key_from_row(row: dict[str, Any], idx: int) -> str:
    key = row.get("key") or row.get("custom_id")
    if key:
        return str(key)
    # Fallback: recover ARTICLE_ID or entity id from echoed request prompt if Vertex dropped `key`
    try:
        prompt = row["request"]["contents"][0]["parts"][0]["text"]
        m_art = ARTICLE_ID_RE.search(prompt)
        if m_art:
            return m_art.group(1)
        m_ent = ENTITY_ID_RE.search(prompt)
        if m_ent:
            return m_ent.group(1)
    except Exception:
        pass
    return f"row_{idx}"


def normalize_batch_output_shards(shard_files: list[Path], out_path: Path) -> tuple[int, int, int, int]:
    ok_count = 0
    err_count = 0
    in_tokens = 0
    out_tokens = 0
    row_idx = 0

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as dst:
        for sf in sorted(shard_files):
            with sf.open("r", encoding="utf-8") as src:
                for line in src:
                    if not line.strip():
                        continue
                    row_idx += 1
                    row = json.loads(line)
                    key = recover_key_from_row(row, row_idx)
                    status = row.get("status")
                    resp_obj = row.get("response") or {}

                    usage = resp_obj.get("usageMetadata") or {}
                    in_tokens += int(usage.get("promptTokenCount") or 0)
                    out_tokens += int(usage.get("candidatesTokenCount") or 0)

                    if status:
                        err_count += 1
                        dst.write(json.dumps({"key": key, "error": str(status)}, ensure_ascii=False) + "\n")
                        continue

                    text, err = extract_text_from_response_dict(resp_obj)
                    if err or not text:
                        err_count += 1
                        dst.write(json.dumps({"key": key, "error": err or "empty"}, ensure_ascii=False) + "\n")
                        continue

                    try:
                        parsed = json.loads(text)
                        ok_count += 1
                        dst.write(json.dumps({"key": key, "parsed": parsed}, ensure_ascii=False) + "\n")
                    except json.JSONDecodeError as je:
                        err_count += 1
                        dst.write(
                            json.dumps({"key": key, "error": f"json_decode:{je}", "raw": text[:400]}, ensure_ascii=False)
                            + "\n"
                        )

    return ok_count, err_count, in_tokens, out_tokens


def api_host(location: str) -> str:
    return "https://aiplatform.googleapis.com" if location == "global" else f"https://{location}-aiplatform.googleapis.com"


def run_direct_concurrent(
    sliced_path: Path,
    out_path: Path,
    model: str,
    project: str,
    location: str,
    workers: int,
    overwrite: bool,
) -> int:
    tokens = TokenProvider()
    endpoint = (
        f"{api_host(location)}/v1/projects/{project}"
        f"/locations/{location}/publishers/google/models/{model}:generateContent"
    )

    seen_keys: set[str] = set()
    if out_path.exists() and not overwrite:
        with out_path.open("r", encoding="utf-8") as existing:
            for line in existing:
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                    if "parsed" in obj and obj.get("key"):
                        seen_keys.add(obj["key"])
                except json.JSONDecodeError:
                    continue

    items: list[dict[str, Any]] = []
    with sliced_path.open("r", encoding="utf-8") as src:
        for line in src:
            if not line.strip():
                continue
            row = json.loads(line)
            k = row.get("key") or row.get("custom_id") or ""
            if k in seen_keys:
                continue
            items.append(row)

    print(
        f"Direct concurrent REST mode: {len(items)} pending requests ({len(seen_keys)} cached), "
        f"workers={workers}, model={model}, location={location}"
    )
    if not items:
        return 0

    def process_one(row: dict[str, Any]) -> tuple[str, dict[str, Any] | None, str | None, int, int]:
        key = row.get("key") or row.get("custom_id") or ""
        req_body = row["request"]

        for attempt in range(6):
            try:
                resp = http_json(endpoint, tokens.get(), method="POST", body=req_body, timeout=120)
                usage = resp.get("usageMetadata") or {}
                in_t = int(usage.get("promptTokenCount") or 0)
                out_t = int(usage.get("candidatesTokenCount") or 0)
                text, err = extract_text_from_response_dict(resp)
                if err or not text:
                    return key, None, err or "empty", in_t, out_t
                parsed = json.loads(text)
                return key, parsed, None, in_t, out_t
            except Exception as exc:
                err_str = str(exc)
                if "HTTP 401" in err_str and attempt < 5:
                    tokens.invalidate()
                    time.sleep(1)
                    continue
                if ("429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "503" in err_str or "500" in err_str) and attempt < 5:
                    time.sleep(min(45, 2 ** (attempt + 1)))
                    continue
                return key, None, err_str[:1000], 0, 0
        return key, None, "max_retries_exceeded", 0, 0

    mode = "w" if overwrite or not out_path.exists() else "a"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ok = 0
    err = 0
    total_in = 0
    total_out = 0
    started = time.time()

    with out_path.open(mode, encoding="utf-8") as dst:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futs = [pool.submit(process_one, row) for row in items]
            for idx, fut in enumerate(concurrent.futures.as_completed(futs), 1):
                key, parsed, error, in_t, out_t = fut.result()
                total_in += in_t
                total_out += out_t
                if error or parsed is None:
                    err += 1
                    dst.write(json.dumps({"key": key, "error": error or "unknown"}, ensure_ascii=False) + "\n")
                else:
                    ok += 1
                    dst.write(json.dumps({"key": key, "parsed": parsed}, ensure_ascii=False) + "\n")
                dst.flush()

                if idx % 10 == 0 or idx == len(items):
                    elapsed = max(time.time() - started, 0.1)
                    cost = (total_in / 1_000_000) * ONLINE_INPUT_PRICE_PER_M + (total_out / 1_000_000) * ONLINE_OUTPUT_PRICE_PER_M
                    print(
                        f"[{idx}/{len(items)}] ok={ok} err={err} · {idx / elapsed:.1f} req/s · "
                        f"tokens in={total_in:,} out={total_out:,} · est ${cost:.4f}",
                        flush=True,
                    )

    print(f"Finished direct run -> {out_path} (ok={ok}, err={err}, in={total_in:,}, out={total_out:,})")
    return 0 if ok > 0 or len(items) == 0 else 1


def run_vertex_batch(
    sliced_path: Path | None,
    out_path: Path,
    job_tag: str,
    model: str,
    project: str,
    location: str,
    bucket: str,
    poll_interval: int,
    resume_job: str = "",
) -> int:
    tokens = TokenProvider()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    gcs_output_prefix = ""

    if resume_job:
        job_name = resume_job.strip()
        poll_url = f"{api_host(location)}/v1/{job_name}"
        print(f"Resuming Vertex AI Batch Prediction Job: {job_name}")
        job: dict[str, Any] = {}
    else:
        assert sliced_path is not None
        gcs_base = f"gs://{bucket}/vertex-batch/{job_tag}-{run_id}"
        gcs_input_uri = f"{gcs_base}/input.jsonl"
        gcs_output_prefix = f"{gcs_base}/output/"

        # Ensure bucket exists
        try:
            run_cmd(["gcloud", "storage", "buckets", "describe", f"gs://{bucket}"], capture=True)
        except Exception:
            bucket_loc = "asia-southeast1" if location == "global" else location
            print(f"Creating GCS bucket gs://{bucket} in {bucket_loc}...")
            run_cmd(["gcloud", "storage", "buckets", "create", f"gs://{bucket}", f"--location={bucket_loc}"])

        print(f"Uploading {sliced_path} -> {gcs_input_uri} ...")
        run_cmd(["gcloud", "storage", "cp", str(sliced_path), gcs_input_uri])

        create_url = (
            f"{api_host(location)}/v1/projects/{project}"
            f"/locations/{location}/batchPredictionJobs"
        )
        payload = {
            "displayName": f"jachaikori-{job_tag}-{run_id}",
            "model": f"publishers/google/models/{model}",
            "inputConfig": {
                "instancesFormat": "jsonl",
                "gcsSource": {"uris": [gcs_input_uri]},
            },
            "outputConfig": {
                "predictionsFormat": "jsonl",
                "gcsDestination": {"outputUriPrefix": gcs_output_prefix},
            },
        }

        print(f"Submitting Vertex AI Batch Prediction Job (model={model}, location={location})...")
        job = http_json(create_url, tokens.get(), method="POST", body=payload)
        job_name = job["name"]
        poll_url = f"{api_host(location)}/v1/{job_name}"
        print(f"Submitted batch job: {job_name}")
        print(f"Initial state: {job.get('state')}")

    terminal_states = {
        "JOB_STATE_SUCCEEDED",
        "JOB_STATE_FAILED",
        "JOB_STATE_CANCELLED",
        "JOB_STATE_EXPIRED",
        "JOB_STATE_PAUSED",
    }

    started = time.time()
    final_job = job
    consecutive_net_errors = 0
    while True:
        try:
            cur = http_json(poll_url, tokens.get(), method="GET")
            consecutive_net_errors = 0
        except Exception as exc:
            err_str = str(exc)
            if "HTTP 401" in err_str:
                tokens.invalidate()
            consecutive_net_errors += 1
            elapsed_min = (time.time() - started) / 60.0
            print(
                f"  [{elapsed_min:5.1f}m] transient poll error #{consecutive_net_errors}: {err_str[:140]} — retrying...",
                flush=True,
            )
            if consecutive_net_errors >= 30:
                print("ERROR: Too many consecutive network errors while polling.", file=sys.stderr)
                return 1
            time.sleep(min(60, poll_interval))
            continue

        final_job = cur
        state_name = str(cur.get("state", "UNKNOWN"))
        stats = cur.get("completionStats") or {}
        succ = stats.get("successfulCount")
        fail = stats.get("failedCount")
        stat_str = f" (ok={succ}, fail={fail})" if succ is not None or fail is not None else ""
        elapsed_min = (time.time() - started) / 60.0
        print(f"  [{elapsed_min:5.1f}m] state={state_name}{stat_str}", flush=True)
        if state_name in terminal_states:
            if state_name != "JOB_STATE_SUCCEEDED":
                print(f"ERROR: Batch job ended in {state_name}: {cur.get('error')}", file=sys.stderr)
                return 1
            break
        time.sleep(poll_interval)

    out_dir_uri = (
        (final_job.get("outputInfo") or {}).get("gcsOutputDirectory")
        or ((final_job.get("outputConfig") or {}).get("gcsDestination") or {}).get("outputUriPrefix", "").rstrip("/")
        or gcs_output_prefix.rstrip("/")
    )
    local_shard_dir = out_path.parent / f".shards-{job_tag}-{run_id}"
    local_shard_dir.mkdir(parents=True, exist_ok=True)
    print(f"Downloading batch outputs from {out_dir_uri} -> {local_shard_dir}/ ...")
    run_cmd(["gcloud", "storage", "cp", "-r", f"{out_dir_uri.rstrip('/')}/*", str(local_shard_dir)])

    shard_files = list(local_shard_dir.rglob("*.jsonl"))
    if not shard_files:
        print(f"ERROR: No *.jsonl output shards found in {local_shard_dir}", file=sys.stderr)
        return 1

    ok, err, in_t, out_t = normalize_batch_output_shards(shard_files, out_path)
    actual_cost = (in_t / 1_000_000) * BATCH_INPUT_PRICE_PER_M + (out_t / 1_000_000) * BATCH_OUTPUT_PRICE_PER_M
    print(
        f"Batch complete -> {out_path}\n"
        f"  Parsed OK:      {ok:,} (errors: {err:,})\n"
        f"  Tokens used:    input={in_t:,} · output={out_t:,}\n"
        f"  Est. Batch USD: ${actual_cost:.4f}"
    )
    return 0


def run_probe(project: str) -> int:
    tokens = TokenProvider()
    tok = tokens.get()
    candidates = [
        ("global", "gemini-3.5-flash"),
        ("global", "gemini-3.8-flash"),
        ("global", "gemini-2.5-flash"),
        ("global", "gemini-2.5-flash-lite"),
        ("us-central1", "gemini-2.5-flash"),
        ("us-central1", "gemini-2.5-flash-lite"),
        ("us-central1", "gemini-3.5-flash"),
        ("asia-south1", "gemini-2.5-flash"),
        ("asia-south1", "gemini-3.5-flash"),
    ]
    body = {
        "contents": [{"role": "user", "parts": [{"text": "Reply with JSON: {\"ok\": true}"}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.0},
    }
    print(f"Probing Vertex AI Gemini Flash models in project '{project}'...")
    for loc, mod in candidates:
        url = f"{api_host(loc)}/v1/projects/{project}/locations/{loc}/publishers/google/models/{mod}:generateContent"
        try:
            resp = http_json(url, tok, method="POST", body=body, timeout=20)
            text, _ = extract_text_from_response_dict(resp)
            print(f"  [OK]   {loc:12s} | {mod:24s} -> {(text or '')[:60]}")
        except Exception as exc:
            msg = str(exc).replace("\n", " ")
            print(f"  [FAIL] {loc:12s} | {mod:24s} -> {msg[:180]}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Jachaikori Vertex AI Batch Prediction jobs (zero-dependency REST)")
    parser.add_argument("--probe", action="store_true", help="Probe active Gemini Flash model IDs & regions in this GCP project")
    parser.add_argument("--input", default="", help="Input Vertex Batch JSONL path")
    parser.add_argument("--output", default="", help="Normalized output JSONL path")
    parser.add_argument("--tag", default="extract", help="Short job tag (candidates|merges|events|dossiers)")
    parser.add_argument("--model", default=os.environ.get("VERTEX_GEMINI_MODEL", "gemini-3.5-flash"))
    parser.add_argument("--project", default=detect_gcp_project())
    parser.add_argument("--location", default=os.environ.get("VERTEX_LOCATION", "global"))
    parser.add_argument("--bucket", default=os.environ.get("GCP_BUCKET", ""))
    parser.add_argument("--pilot", type=int, default=0, help="Limit to first N requests (0 = all)")
    parser.add_argument("--avg-out-tokens", type=int, default=450, help="Expected output tokens/request for cost guard")
    parser.add_argument("--max-usd", type=float, default=60.0, help="Hard estimated USD cost ceiling")
    parser.add_argument("--direct", action="store_true", help="Use concurrent online REST API instead of GCS Vertex Batch")
    parser.add_argument("--workers", type=int, default=12, help="Concurrency for --direct mode")
    parser.add_argument("--poll-interval", type=int, default=20, help="Seconds between Vertex Batch status polls")
    parser.add_argument("--overwrite", action="store_true", help="Ignore existing cached rows in --direct mode")
    parser.add_argument("--resume-job", default="", help="Resume polling & downloading an existing Vertex Batch job name")
    parser.add_argument("--dry-run", action="store_true", help="Estimate tokens & cost without submitting")
    args = parser.parse_args()

    if args.probe:
        if not args.project:
            print("ERROR: No GCP project configured.", file=sys.stderr)
            return 1
        return run_probe(args.project)

    if args.resume_job:
        if not args.output:
            print("ERROR: --output is required with --resume-job.", file=sys.stderr)
            return 1
        return run_vertex_batch(
            sliced_path=None,
            out_path=Path(args.output),
            job_tag=args.tag,
            model=args.model,
            project=args.project,
            location=args.location,
            bucket=args.bucket,
            poll_interval=args.poll_interval,
            resume_job=args.resume_job,
        )

    if not args.input or not args.output:
        print("ERROR: --input and --output are required (unless --probe is set).", file=sys.stderr)
        return 1

    in_path = Path(args.input)
    out_path = Path(args.output)
    if not in_path.exists():
        print(f"ERROR: Input JSONL not found: {in_path}", file=sys.stderr)
        return 1

    pilot = args.pilot if args.pilot and args.pilot > 0 else None
    sliced_path = out_path.with_suffix(".pilot-input.jsonl") if pilot else in_path
    if pilot:
        count, est_in, est_out, est_usd = slice_and_estimate(
            in_path, sliced_path, pilot, args.avg_out_tokens, args.direct
        )
    else:
        total_chars = 0
        count = 0
        with in_path.open("r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    count += 1
                    total_chars += len(line)
        est_in = int(total_chars / 3.2)
        est_out = count * args.avg_out_tokens
        in_rate = ONLINE_INPUT_PRICE_PER_M if args.direct else BATCH_INPUT_PRICE_PER_M
        out_rate = ONLINE_OUTPUT_PRICE_PER_M if args.direct else BATCH_OUTPUT_PRICE_PER_M
        est_usd = (est_in / 1_000_000) * in_rate + (est_out / 1_000_000) * out_rate

    mode_label = "DIRECT (online)" if args.direct else "VERTEX BATCH (50% off)"
    print(
        f"[{args.tag}] Mode: {mode_label} | Model: {args.model}\n"
        f"  Requests:         {count:,}\n"
        f"  Est. input tok:   {est_in:,}\n"
        f"  Est. output tok:  {est_out:,}\n"
        f"  Est. cost (USD):  ${est_usd:.4f} (cap: ${args.max_usd:.2f})"
    )

    if est_usd > args.max_usd:
        print(
            f"ERROR: Estimated cost (${est_usd:.2f}) exceeds --max-usd (${args.max_usd:.2f}). "
            f"Increase --max-usd or pass --pilot N.",
            file=sys.stderr,
        )
        return 2

    if args.dry_run:
        print("[dry-run] Passed cost guard. Exiting without calling Vertex AI.")
        return 0

    if not args.project:
        print("ERROR: Set GCP_PROJECT_ID / GOOGLE_CLOUD_PROJECT or run `gcloud config set project <ID>`.", file=sys.stderr)
        return 1

    if args.direct:
        return run_direct_concurrent(
            sliced_path=sliced_path,
            out_path=out_path,
            model=args.model,
            project=args.project,
            location=args.location,
            workers=args.workers,
            overwrite=args.overwrite,
        )

    bucket = args.bucket or f"jachaikori-backfill-{args.project}"
    return run_vertex_batch(
        sliced_path=sliced_path,
        out_path=out_path,
        job_tag=args.tag,
        model=args.model,
        project=args.project,
        location=args.location,
        bucket=bucket,
        poll_interval=args.poll_interval,
    )


if __name__ == "__main__":
    raise SystemExit(main())
