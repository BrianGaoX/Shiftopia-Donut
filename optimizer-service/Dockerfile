FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

# Run gunicorn with uvicorn workers for multi-process production deployment.
# WEB_CONCURRENCY controls the number of worker processes (default 2).
# --timeout 180 gives CP-SAT solves up to 3 min before gunicorn kills a worker.
# NOTE: OPTIMIZER_MAX_CONCURRENT_SOLVES is per-process; effective cluster-wide
# concurrency cap = WEB_CONCURRENCY × OPTIMIZER_MAX_CONCURRENT_SOLVES.
CMD gunicorn ortools_runner:app \
    -k uvicorn.workers.UvicornWorker \
    -w ${WEB_CONCURRENCY:-2} \
    -b 0.0.0.0:${PORT:-8080} \
    --timeout 180
