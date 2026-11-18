FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/hf_cache

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir -r requirements.txt

# Pre-bake BAAI/bge-m3 weights so Cloud Run GPU job cold-start is instant
RUN python3 -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-m3')" && \
    chmod -R a+rX /app/hf_cache

COPY embed_bge_m3.py .
RUN chmod +x /app/embed_bge_m3.py
ENTRYPOINT ["python3", "/app/embed_bge_m3.py"]
