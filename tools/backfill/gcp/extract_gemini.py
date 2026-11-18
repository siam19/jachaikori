#!/usr/bin/env python3
"""
Vertex AI Batch / Gemini Flash entity & claim extraction runner.
Supports --pilot N (default 200) to gate batch size before full-corpus runs.
"""

import argparse
import json
import os
import sys
import time
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
    parser.add_argument("--model", default=os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"))
    parser.add_argument("--project", default=os.environ.get("GOOGLE_CLOUD_PROJECT", ""))
    parser.add_argument("--location", default=os.environ.get("GOOGLE_CLOUD_LOCATION", "asia-south1"))
    parser.add_argument("--dry-run", action="store_true", help="Validate & slice without calling Vertex AI")
    parser.add_argument("--overwrite", action="store_true", help="Re-extract even if articleId already exists in output")
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

    if args.project:
        client = genai.Client(
            vertexai=True,
            project=args.project,
            location=args.location,
        )
    else:
        client = genai.Client()

    seen_ids: set[str] = set()
    if out_path.exists() and not args.overwrite:
        with out_path.open("r", encoding="utf-8") as existing:
            for line in existing:
                if not line.strip():
                    continue
                try:
                    seen_ids.add(json.loads(line).get("articleId", ""))
                except json.JSONDecodeError:
                    continue

    mode = "w" if args.overwrite or not out_path.exists() else "a"
    written = 0
    skipped = 0
    input_tokens = 0
    output_tokens = 0

    EXTRACTION_SCHEMA = {
        "type": "OBJECT",
        "properties": {
            "entities": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "entityId": {"type": "STRING", "nullable": True},
                        "canonicalBn": {"type": "STRING", "nullable": True},
                        "canonicalEn": {"type": "STRING", "nullable": True},
                        "entityType": {"type": "STRING", "enum": ["person", "org", "location", "role", "event_topic"]},
                        "surfaceForm": {"type": "STRING"},
                        "role": {"type": "STRING", "enum": ["quoted_speaker", "actor", "subject", "location", "mentioned"]},
                    },
                    "required": ["entityId", "entityType", "surfaceForm", "role"],
                },
            },
            "claims": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "claimText": {"type": "STRING"},
                        "claimType": {"type": "STRING"},
                        "subjectEntityId": {"type": "STRING", "nullable": True},
                        "objectEntityId": {"type": "STRING", "nullable": True},
                        "evidenceSnippet": {"type": "STRING", "nullable": True},
                    },
                    "required": ["claimText", "evidenceSnippet"],
                },
            },
        },
        "required": ["entities", "claims"],
    }

    with sliced_path.open("r", encoding="utf-8") as src, out_path.open(mode, encoding="utf-8") as dst:
        for line in src:
            if not line.strip():
                continue
            row = json.loads(line)
            article_id = row.get("custom_id")
            if article_id in seen_ids:
                skipped += 1
                continue
            prompt_text = row["request"]["contents"][0]["parts"][0]["text"]
            resp = None
            for attempt in range(6):
                try:
                    resp = client.models.generate_content(
                        model=args.model,
                        contents=prompt_text,
                        config={
                            "response_mime_type": "application/json",
                            "response_schema": EXTRACTION_SCHEMA,
                            "temperature": 0.1,
                        },
                    )
                    break
                except Exception as exc:
                    err_str = str(exc)
                    if ("429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "503" in err_str) and attempt < 5:
                        wait_s = min(60, 2 ** (attempt + 1))
                        print(f"Rate-limited on {article_id}, retrying in {wait_s}s (attempt {attempt + 1}/5)...")
                        time.sleep(wait_s)
                        continue
                    raise
            assert resp is not None
            usage = getattr(resp, "usage_metadata", None)
            if usage is not None:
                input_tokens += getattr(usage, "prompt_token_count", 0) or 0
                output_tokens += getattr(usage, "candidates_token_count", 0) or 0
            extraction = json.loads(resp.text)
            dst.write(json.dumps({"articleId": article_id, "extraction": extraction}, ensure_ascii=False) + "\n")
            dst.flush()
            written += 1

            entities = extraction.get("entities") or []
            claims = extraction.get("claims") or []
            ent_labels = []
            for ent in entities:
                label = ent.get("canonicalEn") or ent.get("canonicalBn") or ent.get("surfaceForm") or "?"
                eid = ent.get("entityId")
                ent_labels.append(f"{label}({eid})" if eid else f"{label}[new]")
            ent_preview = ", ".join(ent_labels) if ent_labels else "none"
            print(
                f"[{skipped + written}/{count}] {str(article_id)[:10]} | "
                f"{len(entities)} entities: {ent_preview} | {len(claims)} claims",
                flush=True,
            )
            if written % 20 == 0:
                print(f"--- Tokens so far: in={input_tokens:,} out={output_tokens:,} ---", flush=True)

    print(
        f"Wrote {written} extractions to {out_path} "
        f"(skipped={skipped}, tokens: input={input_tokens:,}, output={output_tokens:,})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
