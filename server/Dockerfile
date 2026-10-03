FROM python:3.12-slim AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
# Create a minimal package so pip install . can resolve the project
RUN mkdir -p app && touch app/__init__.py
RUN pip install --no-cache-dir .

FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3001"]
