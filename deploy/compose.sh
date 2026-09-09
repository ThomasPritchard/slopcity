#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec docker compose --env-file "${SLOP_DEPLOY_DIR:-.deploy}/compose.env" -f compose.yaml "$@"
