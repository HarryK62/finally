# syntax=docker/dockerfile:1

# FinAlly — AI Trading Workstation
#
# Multi-stage build:
#   1. node:20-slim      builds the Next.js static export  -> /build/out
#   2. python:3.12-slim  installs the backend with uv and serves both the API
#                        and that export from a single uvicorn process on :8000
#
# Both stages copy their dependency manifests before their source so that a
# source-only change does not invalidate the (slow) dependency install layers.

# ---------------------------------------------------------------------------
# Stage 1 — frontend: Next.js static export
# ---------------------------------------------------------------------------
FROM node:20-slim AS frontend-builder

ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=true

WORKDIR /build

# Dependency layer. package-lock.json is committed, so `npm ci` is reproducible.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Source layer. node_modules is excluded via .dockerignore, so the layer above
# survives this copy.
COPY frontend/ ./

# next.config.ts sets `output: "export"` for a production build, which emits
# `out/`. Fail the build loudly here rather than shipping an empty static dir.
RUN npm run build && test -f out/index.html

# ---------------------------------------------------------------------------
# Stage 2 — backend: FastAPI + uv, serving the export
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

# Pinned to the uv that produced backend/uv.lock (lock revision 3).
COPY --from=ghcr.io/astral-sh/uv:0.9.24 /uv /uvx /usr/local/bin/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PATH="/app/backend/.venv/bin:$PATH"

# app/config.py derives REPO_ROOT from its own location:
#   /app/backend/app/config.py -> /app
# so these are also the defaults. Set explicitly so the runtime contract does
# not silently depend on that derivation.
ENV DB_PATH=/app/db/finally.db \
    STATIC_DIR=/app/backend/static

WORKDIR /app/backend

# Dependency layer: manifests only. README.md is referenced by pyproject.toml's
# `readme` field and must exist for the project metadata to resolve.
COPY backend/pyproject.toml backend/uv.lock backend/README.md ./
RUN uv sync --frozen --no-dev --no-install-project

# Source layer, then install the project itself (dev extras stay out).
COPY backend/ ./
RUN uv sync --frozen --no-dev

# Static export from stage 1 -> STATIC_DIR. main.py mounts this last, after the
# /api routers, with an index.html fallback for unknown non-/api paths.
COPY --from=frontend-builder /build/out ./static

# Volume mount point for the SQLite file (finally-data:/app/db).
RUN mkdir -p /app/db

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
