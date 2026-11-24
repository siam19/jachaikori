FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/hf_cache

WORKDIR /app
COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

# Pre-bake BAAI/bge-m3 weights so Cloud Run GPU job cold-start is instant
RUN python3 -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-m3')" && \
    chmod -R a+rX /app/hf_cache

COPY embed_bge_m3.py .
RUN chmod +x /app/embed_bge_m3.py
ENTRYPOINT ["python3", "/app/embed_bge_m3.py"]
