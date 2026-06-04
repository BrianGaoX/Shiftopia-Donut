FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

CMD uvicorn ortools_runner:app --host 0.0.0.0 --port ${PORT:-8080}
