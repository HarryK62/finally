#!/usr/bin/env bash
#
# Stop FinAlly (macOS / Linux).
#
# Idempotent: safe to run when the container is already stopped or was never
# created. Never touches the 'finally-data' volume, so your portfolio, trades
# and chat history survive.

set -euo pipefail

CONTAINER="finally"
VOLUME="finally-data"

usage() {
    cat <<EOF
Usage: $(basename "$0")

Stops and removes the '${CONTAINER}' container. The '${VOLUME}' volume (your
SQLite database) is left intact.

To delete the data too, run explicitly:
    docker volume rm ${VOLUME}
EOF
}

case "${1:-}" in
    "")        ;;
    -h|--help) usage; exit 0 ;;
    *)
        echo "Unknown option: $1" >&2
        usage >&2
        exit 2
        ;;
esac

if ! command -v docker >/dev/null 2>&1; then
    echo "Error: 'docker' was not found on your PATH - nothing to stop." >&2
    echo "Install Docker from https://docs.docker.com/get-docker/ if you expected a container here." >&2
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "Error: Docker is installed but the daemon is not responding." >&2
    echo "Start Docker Desktop (or 'sudo systemctl start docker'), then run this script again." >&2
    exit 1
fi

state="$(docker container inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true)"

if [ -z "$state" ]; then
    echo "No '${CONTAINER}' container exists - nothing to do."
else
    if [ "$state" = "running" ]; then
        echo "Stopping ${CONTAINER}..."
        docker stop "$CONTAINER" >/dev/null
    else
        echo "Container '${CONTAINER}' is not running (state: ${state})."
    fi
    docker rm "$CONTAINER" >/dev/null
    echo "Removed container '${CONTAINER}'."
fi

echo "Data volume '${VOLUME}' left intact. Run ./scripts/start_mac.sh to resume."
