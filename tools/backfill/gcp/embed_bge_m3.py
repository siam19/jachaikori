#!/usr/bin/env python3
"""
Batch embeds chunks.jsonl using BAAI/bge-m3 (1024-dim, L2-normalized, fp16 on GPU)
and writes compact little-endian float32 binary vectors + manifest JSON.

Supports sharded execution across multiple concurrent Cloud Run GPU tasks via
CLOUD_RUN_TASK_INDEX / CLOUD_RUN_TASK_COUNT (or --shard-index / --shard-count).
"""

import argparse
import json
import os
import sys
import time
import numpy as np
import torch
from sentence_transformers import SentenceTransformer


def log(msg: str) -> None:
    print(f"[embed_bge_m3] {msg}", flush=True)


def gcs_blob_exists(bucket_name: str, blob_name: str) -> bool:
    from google.cloud import storage

    client = storage.Client()
    return client.bucket(bucket_name).blob(blob_name).exists()


def download_from_gcs(bucket_name: str, blob_name: str, dest_path: str) -> None:
    from google.cloud import storage

    t0 = time.time()
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    os.makedirs(os.path.dirname(os.path.abspath(dest_path)), exist_ok=True)
    log(f"Downloading gs://{bucket_name}/{blob_name} -> {dest_path} ...")
    blob.download_to_filename(dest_path, timeout=600)
    size_mb = os.path.getsize(dest_path) / (1024 * 1024)
    log(f"Downloaded {size_mb:.1f} MiB in {time.time() - t0:.1f}s")


def upload_to_gcs(bucket_name: str, src_path: str, blob_name: str) -> None:
    from google.cloud import storage

    t0 = time.time()
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    size_mb = os.path.getsize(src_path) / (1024 * 1024)
    log(f"Uploading {src_path} ({size_mb:.1f} MiB) -> gs://{bucket_name}/{blob_name} ...")
    blob.upload_from_filename(src_path, timeout=600)
    log(f"Uploaded gs://{bucket_name}/{blob_name} in {time.time() - t0:.1f}s")


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch embed Jachaikori chunks with BAAI/bge-m3")
    parser.add_argument("--input", default="/tmp/chunks.jsonl", help="Local path to chunks.jsonl")
    parser.add_argument("--out-dir", default="/tmp/out", help="Local output directory for vectors & manifest")
    parser.add_argument("--gcs-bucket", default=os.environ.get("GCS_BUCKET", ""), help="Optional GCS bucket")
    parser.add_argument("--gcs-input-object", default=os.environ.get("GCS_INPUT_OBJECT", ""), help="GCS object name for input JSONL")
    parser.add_argument("--run-id", default=os.environ.get("RUN_ID", ""), help="Run ID for sharded GCS output")
    parser.add_argument(
        "--shard-index",
        type=int,
        default=int(os.environ.get("CLOUD_RUN_TASK_INDEX", "0")),
        help="0-based shard index (defaults to CLOUD_RUN_TASK_INDEX)",
    )
    parser.add_argument(
        "--shard-count",
        type=int,
        default=int(os.environ.get("CLOUD_RUN_TASK_COUNT", "1")),
        help="Total shard count (defaults to CLOUD_RUN_TASK_COUNT)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=int(os.environ.get("BATCH_SIZE", "64")),
        help="Batch size for GPU inference",
    )
    parser.add_argument("--max-seq-length", type=int, default=2048, help="Max token length per chunk")
    parser.add_argument("--require-gpu", action="store_true", help="Exit with error if CUDA GPU is unavailable")
    parser.add_argument("--no-skip-existing", action="store_true", help="Re-compute even if shard manifest already exists in GCS")
    args = parser.parse_args()

    shard_index = args.shard_index
    shard_count = max(1, args.shard_count)
    sharded = shard_count > 1 or bool(args.run_id)

    if args.gcs_input_object:
        input_blob = args.gcs_input_object
    elif args.run_id:
        input_blob = f"embed-runs/{args.run_id}/chunks.jsonl"
    else:
        input_blob = "chunks.jsonl"

    if sharded:
        run_prefix = f"embed-runs/{args.run_id}" if args.run_id else "embed-runs/default"
        bin_name = f"part-{shard_index:04d}.f32.bin"
        manifest_name = f"part-{shard_index:04d}.manifest.json"
        out_bin_blob = f"{run_prefix}/shards/{bin_name}"
        out_manifest_blob = f"{run_prefix}/shards/{manifest_name}"
    else:
        bin_name = "vectors.f32.bin"
        manifest_name = "manifest.json"
        out_bin_blob = bin_name
        out_manifest_blob = manifest_name

    log(f"Shard {shard_index + 1}/{shard_count} starting (run_id={args.run_id or 'single'})")

    if args.gcs_bucket and not args.no_skip_existing:
        if gcs_blob_exists(args.gcs_bucket, out_manifest_blob) and gcs_blob_exists(args.gcs_bucket, out_bin_blob):
            log(f"Shard output gs://{args.gcs_bucket}/{out_manifest_blob} already exists; skipping.")
            return

    cuda_ok = torch.cuda.is_available()
    if args.require_gpu and not cuda_ok:
        log("ERROR: --require-gpu was set, but torch.cuda.is_available() is False.")
        sys.exit(1)

    if args.gcs_bucket:
        download_from_gcs(args.gcs_bucket, input_blob, args.input)

    if not os.path.exists(args.input):
        log(f"ERROR: Input file not found: {args.input}")
        sys.exit(1)

    # Stream and retain only this shard's modulo slice so balanced short/long chunks distribute evenly
    chunk_ids: list[str] = []
    texts: list[str] = []
    total_rows = 0
    with open(args.input, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if shard_count == 1 or (total_rows % shard_count) == shard_index:
                row = json.loads(line)
                chunk_ids.append(row["id"])
                texts.append(row["text"])
            total_rows += 1

    total = len(texts)
    log(f"Retained {total:,} / {total_rows:,} chunks for shard {shard_index}/{shard_count}.")

    os.makedirs(args.out_dir, exist_ok=True)
    bin_path = os.path.join(args.out_dir, bin_name)
    manifest_path = os.path.join(args.out_dir, manifest_name)
    dims = 1024

    if total > 0:
        device = "cuda" if cuda_ok else "cpu"
        gpu_name = torch.cuda.get_device_name(0) if cuda_ok else "CPU"
        log(f"Loading BAAI/bge-m3 on device={device} ({gpu_name}, fp16={cuda_ok})...")

        model = SentenceTransformer(
            "BAAI/bge-m3",
            device=device,
            model_kwargs={"torch_dtype": torch.float16} if cuda_ok else {},
        )
        model.max_seq_length = args.max_seq_length

        log(f"Encoding {total:,} chunks (batch_size={args.batch_size})...")
        t0 = time.time()
        window_size = 4096

        with open(bin_path, "wb") as bin_f, torch.inference_mode():
            for start in range(0, total, window_size):
                end = min(start + window_size, total)
                batch_texts = texts[start:end]
                embs = model.encode(
                    batch_texts,
                    batch_size=args.batch_size,
                    normalize_embeddings=True,
                    show_progress_bar=False,
                    convert_to_numpy=True,
                ).astype(np.dtype("<f4"))
                dims = int(embs.shape[1])
                bin_f.write(embs.tobytes())
                elapsed = time.time() - t0
                rate = end / max(elapsed, 0.001)
                eta = (total - end) / max(rate, 0.001)
                log(f"[shard {shard_index}] {end:,} / {total:,} ({rate:.1f} chunks/sec, ETA {eta:.0f}s)")
    else:
        open(bin_path, "wb").close()

    with open(manifest_path, "w", encoding="utf-8") as mf:
        json.dump(
            {
                "model": "BAAI/bge-m3",
                "embeddingVersion": "bge-m3-v1",
                "dims": dims,
                "count": total,
                "shardIndex": shard_index,
                "shardCount": shard_count,
                "chunkIds": chunk_ids,
            },
            mf,
        )

    log(f"Encoding complete -> {bin_path} & {manifest_path}")

    if args.gcs_bucket:
        # Upload binary first, manifest second (manifest presence marks shard complete)
        upload_to_gcs(args.gcs_bucket, bin_path, out_bin_blob)
        upload_to_gcs(args.gcs_bucket, manifest_path, out_manifest_blob)
        log(f"Shard {shard_index + 1}/{shard_count} artifacts uploaded to GCS.")


if __name__ == "__main__":
    main()
