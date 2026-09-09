#!/bin/sh
set -eu
# Compose file secrets retain host ownership. Read while root, before the official
# entrypoint drops privileges to postgres; never make host credentials world-readable.
SLOP_APP_PASSWORD=$(cat /run/secrets/app_password)
export SLOP_APP_PASSWORD
exec /usr/local/bin/docker-entrypoint.sh "$@"
