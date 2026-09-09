#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Build first, keeping the current game playable if the build fails.
sh deploy/compose.sh config --quiet
sh deploy/compose.sh build
if test -n "$(sh deploy/compose.sh ps --status running -q postgres)"; then
  sh deploy/backup.sh
fi
# A stop/start release: overlapping game processes cannot safely recover wagers.
sh deploy/compose.sh stop edge game
sh deploy/compose.sh up -d --wait --wait-timeout 120
echo 'Containers started. Check HTTPS, join town and voice before inviting players.'
