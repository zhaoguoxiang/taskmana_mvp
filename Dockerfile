# ---- Build stage ----
FROM python:3.14-slim AS builder

# Install uv for fast Python package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy dependency files first for better layer caching
COPY pyproject.toml uv.lock ./

# Install dependencies into a virtual environment
RUN uv sync --frozen --no-dev --no-install-project

# ---- Runtime stage ----
FROM python:3.14-slim

WORKDIR /app

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application code
COPY . .

# Create directories for data persistence
RUN mkdir -p /app/data /app/uploads

# Set environment
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

EXPOSE 8000

# Use a shell script as entrypoint to check for secret key
COPY <<'ENTRY' /app/docker-entrypoint.sh
#!/bin/bash
set -e

if [ -z "$TASKMANA_SECRET_KEY" ]; then
    if [ -f /run/secrets/taskmana_secret_key ]; then
        export TASKMANA_SECRET_KEY=$(cat /run/secrets/taskmana_secret_key)
    else
        echo "ERROR: TASKMANA_SECRET_KEY is required."
        echo "  Pass it via: -e TASKMANA_SECRET_KEY=... or Docker secret"
        exit 1
    fi
fi

exec python main.py --db /app/data/taskmana.db "$@"
ENTRY

RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
