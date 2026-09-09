#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Use the same Node major as the game without installing Node on the VPS.
exec docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$(pwd),dst=/workspace" --workdir /workspace \
  node:24-bookworm-slim node scripts/configure-deploy.mjs "$@"
