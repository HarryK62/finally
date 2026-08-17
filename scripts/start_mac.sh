#!/usr/bin/env bash
#
# Start FinAlly in Docker (macOS / Linux).
#
#   ./scripts/start_mac.sh              build if the image is missing, then run
#   ./scripts/start_mac.sh --build      force a rebuild first
#   ./scripts/start_mac.sh --no-browser don't open a browser
#
# Idempotent: running it again while the container is up is a no-op that just
# prints the URL.

set -euo pipefail

IMAGE="finally:latest"
CONTAINER="finally"
VOLUME="finally-data"
PORT="8000"
URL="http://localhost:${PORT}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
    cat <<EOF
Usage: $(basename "$0") [--build] [--no-browser]

  --build        Rebuild the Docker image even if it already exists.
  --no-browser   Do not open ${URL} when the app is ready.
  -h, --help     Show this help.
EOF
}

force_build=0
open_browser=1

while [ $# -gt 0 ]; do
    case "$1" in
        --build)      force_build=1 ;;
        --no-browser) open_browser=0 ;;
        -h|--help)    usage; exit 0 ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

# --- preflight -------------------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
    cat >&2 <<EOF
Error: 'docker' was not found on your PATH.

FinAlly runs in a container. Install Docker Desktop (macOS) or Docker Engine
(Linux) from https://docs.docker.com/get-docker/ and run this script again.

To run without Docker instead:
    cd frontend && npm ci && npm run build
    cp -r frontend/out backend/static
    cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
EOF
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    cat >&2 <<EOF
Error: Docker is installed but the daemon is not responding.

Start Docker Desktop (or 'sudo systemctl start docker' on Linux), wait for it
to report "running", then run this script again.
EOF
    exit 1
fi

cd "$REPO_ROOT"

if [ ! -f .env ]; then
    echo "No .env found - creating one from .env.example."
    echo "Edit it to add OPENROUTER_API_KEY if you want the AI chat panel."
    cp .env.example .env
fi

# --- already running? ------------------------------------------------------

container_state() {
    docker container inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true
}

state="$(container_state)"

if [ "$state" = "running" ] && [ "$force_build" -eq 0 ]; then
    echo "FinAlly is already running at ${URL}"
    exit 0
fi

# Any other state (created/exited/paused, or a stale container from an older
# image) gets replaced so the run below always starts from a known state.
if [ -n "$state" ]; then
    echo "Removing existing '${CONTAINER}' container (state: ${state})..."
    docker rm -f "$CONTAINER" >/dev/null
fi

# --- build -----------------------------------------------------------------

if [ "$force_build" -eq 1 ] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Building ${IMAGE} (first build takes a few minutes)..."
    docker build -t "$IMAGE" .
else
    echo "Using existing image ${IMAGE} (pass --build to rebuild)."
fi

# --- run -------------------------------------------------------------------

echo "Starting ${CONTAINER}..."
docker run -d \
    --name "$CONTAINER" \
    --restart unless-stopped \
    -p "${PORT}:8000" \
    --env-file .env \
    -v "${VOLUME}:/app/db" \
    "$IMAGE" >/dev/null

# --- wait for health -------------------------------------------------------

if command -v curl >/dev/null 2>&1; then
    printf 'Waiting for the app to come up'
    ready=0
    for _ in $(seq 1 60); do
        if curl -fsS "${URL}/api/health" >/dev/null 2>&1; then
            ready=1
            break
        fi
        # If the container died, stop waiting and show why.
        if [ "$(container_state)" != "running" ]; then
            echo
            echo "Error: the container exited during startup. Logs:" >&2
            docker logs "$CONTAINER" >&2 || true
            exit 1
        fi
        printf '.'
        sleep 1
    done
    echo
    if [ "$ready" -eq 0 ]; then
        echo "Warning: no healthy response after 60s. Check 'docker logs ${CONTAINER}'." >&2
    fi
fi

echo
echo "FinAlly is running at ${URL}"
echo "  logs:  docker logs -f ${CONTAINER}"
echo "  stop:  ./scripts/stop_mac.sh"

if [ "$open_browser" -eq 1 ]; then
    if command -v open >/dev/null 2>&1; then
        open "$URL" >/dev/null 2>&1 || true
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL" >/dev/null 2>&1 || true
    fi
fi
