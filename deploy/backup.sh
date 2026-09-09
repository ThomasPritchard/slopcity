#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")/.."
backup_dir=${SLOP_BACKUP_DIR:-backups}
mkdir -p "$backup_dir"
backup_file="$backup_dir/slop-city-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
trap 'rm -f "$backup_file.partial"' EXIT HUP INT TERM
sh deploy/compose.sh exec -T postgres pg_dump -U postgres -d slop_city --format=custom --no-owner > "$backup_file.partial"
test -s "$backup_file.partial"
mv "$backup_file.partial" "$backup_file"
echo "Database backup: $backup_file"
