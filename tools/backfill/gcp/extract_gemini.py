#!/usr/bin/env python3
"""
Vertex AI Batch / Gemini Flash entity & claim extraction runner.
Supports --pilot N (default 200) to gate batch size before full-corpus runs.
"""

import argparse
import json
import os
import sys
from pathlib import Path


def build_pilot_slice(input_path: Path, output_path: Path, pilot: int | None) -> int:
    count = 0
    with input_path.open("r", encoding="utf-8") as src, output_path.open("w", encoding="utf-8") as dst:
        for line in src:
            if not line.strip():
                continue
            dst.write(line)
            count += 1
            if pilot is not None and pilot > 0 and count >= pilot:
                break
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Gemini Flash extraction on requests.jsonl")
    parser.add_argument("--input", default="data/index/requests.jsonl", help="Input Vertex Batch JSONL")
    parser.add_argument("--output", default="data/index/llm-extractions.jsonl", help="Output extractions JSONL")
    parser.add_argument("--pilot", type=int, default=200, help="Gate max requests (0 = all)")
    parser.add_argument("--model", default=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"))
    parser.add_argument("--project", default=os.environ.get("GOOGLE_CLOUD_PROJECT", ""))
    parser.add_argument("--location", default=os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1"))
    parser.add_argument("--dry-run", action="store_true", help="Validate & slice without calling Vertex AI")
    args = parser.parse_args()

    in_path = Path(args.input)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not in_path.exists():
        print(f"Error: input file not found: {in_path}", file=sys.stderr)
        return 1

    pilot_limit = args.pilot if args.pilot and args.pilot > 0 else None
    sliced_path = out_path.with_suffix(".pilot.jsonl") if pilot_limit else in_path
    count = build_pilot_slice(in_path, sliced_path, pilot_limit) if pilot_limit else sum(
        1 for line in in_path.open("r", encoding="utf-8") if line.strip()
    )
    print(f"Prepared {count} requests (pilot={pilot_limit or 'ALL'}, model={args.model}).")

    if args.dry_run:
        print(f"[dry-run] Would submit {sliced_path} to Vertex AI ({args.project or 'unset-project'}/{args.location}).")
        return 0

    try:
        from google import genai  # type: ignore
    except ImportError:
        print("Error: google-genai package not installed. Run `pip install google-genai`.", file=sys.stderr)
        return 1

    client = genai.Client(
        vertexai=bool(args.project),
        project=args.project or None,
        location=args.location,
    )

    written = 0
    with sliced_path.open("r", encoding="utf-8") as src, out_path.open("w", encoding="utf-8") as dst:
        for line in src:
            if not line.strip():
                continue
            row = json.loads(line)
            article_id = row.get("custom_id")
            prompt_text = row["request"]["contents"][0]["parts"][0]["text"]
            resp = client.models.generate_content(
                model=args.model,
                contents=prompt_text,
                config={"response_mime_type": "application/json", "temperature": 0.1},
            )
            extraction = json.loads(resp.text)
            dst.write(json.dumps({"articleId": article_id, "extraction": extraction}, ensure_ascii=False) + "\n")
            written += 1

    print(f"Wrote {written} extractions to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
