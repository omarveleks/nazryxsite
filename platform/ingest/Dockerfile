FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app/ingest
COPY ingest/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ingest/ /app/ingest/
COPY db/ /app/db/
RUN useradd --create-home --uid 1001 nazryx
RUN mkdir -p /data/uploads && chown -R nazryx /data/uploads
USER nazryx
CMD ["python", "worker.py"]
