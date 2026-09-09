#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# COMPOSE_FILE in the generated env selects any tunnel override.
exec docker compose --env-file "${SLOP_DEPLOY_DIR:-.deploy}/compose.env" "$@"
