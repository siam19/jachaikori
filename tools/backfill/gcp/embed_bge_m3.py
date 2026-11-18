#!/usr/bin/env python3
"""
Batch embeds chunks.jsonl using BAAI/bge-m3 (1024-dim, L2-normalized, fp16 on GPU)
and writes compact little-endian float32 binary vectors (`vectors.f32.bin`) + `manifest.json`.

Supports local paths (`--input`, `--out-dir`) or direct GCS transfer (`--gcs-bucket`).
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
    parser.add_argument("--out-dir", default="/tmp/out", help="Local output directory for vectors.f32.bin & manifest.json")
    parser.add_argument("--gcs-bucket", default="", help="Optional GCS bucket to pull chunks.jsonl from and push outputs to")
    parser.add_argument("--gcs-input-object", default="chunks.jsonl", help="GCS object name for input JSONL")
    parser.add_argument("--batch-size", type=int, default=64, help="Batch size for GPU inference")
    parser.add_argument("--max-seq-length", type=int, default=2048, help="Max token length per chunk")
    parser.add_argument("--require-gpu", action="store_true", help="Exit with error if CUDA GPU is unavailable")
    args = parser.parse_args()

    cuda_ok = torch.cuda.is_available()
    if args.require_gpu and not cuda_ok:
        log("ERROR: --require-gpu was set, but torch.cuda.is_available() is False.")
        sys.exit(1)

    if args.gcs_bucket:
        download_from_gcs(args.gcs_bucket, args.gcs_input_object, args.input)

    if not os.path.exists(args.input):
        log(f"ERROR: Input file not found: {args.input}")
        sys.exit(1)

    os.makedirs(args.out_dir, exist_ok=True)
    device = "cuda" if cuda_ok else "cpu"
    gpu_name = torch.cuda.get_device_name(0) if cuda_ok else "CPU"
    log(f"Loading BAAI/bge-m3 on device={device} ({gpu_name}, fp16={cuda_ok})...")

    model = SentenceTransformer(
        "BAAI/bge-m3",
        device=device,
        model_kwargs={"torch_dtype": torch.float16} if cuda_ok else {},
    )
    model.max_seq_length = args.max_seq_length

    chunk_ids: list[str] = []
    texts: list[str] = []
    with open(args.input, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            chunk_ids.append(row["id"])
            texts.append(row["text"])

    total = len(texts)
    log(f"Loaded {total:,} chunks. Starting encoding (batch_size={args.batch_size})...")
    t0 = time.time()

    bin_path = os.path.join(args.out_dir, "vectors.f32.bin")
    dims = 1024
    window_size = 4096

    with open(bin_path, "wb") as bin_f:
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
            log(f"{end:,} / {total:,} ({rate:.1f} chunks/sec, ETA {eta:.0f}s)")

    manifest_path = os.path.join(args.out_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as mf:
        json.dump(
            {
                "model": "BAAI/bge-m3",
                "embeddingVersion": "bge-m3-v1",
                "dims": dims,
                "count": total,
                "chunkIds": chunk_ids,
            },
            mf,
        )

    log(f"Encoding complete in {time.time() - t0:.1f}s -> {bin_path} & {manifest_path}")

    if args.gcs_bucket:
        upload_to_gcs(args.gcs_bucket, bin_path, "vectors.f32.bin")
        upload_to_gcs(args.gcs_bucket, manifest_path, "manifest.json")
        log("All artifacts uploaded to GCS.")


if __name__ == "__main__":
    main()
