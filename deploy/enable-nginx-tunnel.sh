#!/bin/sh
set -eu
test "$(id -u)" -eq 0 || { echo 'Run this script with sudo.' >&2; exit 1; }
cd /opt/slop-city
target=/etc/nginx/sites-available/slop-city
enabled=/etc/nginx/sites-enabled/slop-city
if test -e "$target" || test -L "$enabled" || test -e "$enabled"; then
  echo 'Slop City nginx configuration already exists; review it before replacing.' >&2
  exit 1
fi
# Only switch the public hostname after the private game gateway is ready.
curl --fail --silent --show-error -H 'Host: slopcity.fun' http://127.0.0.1:9080/game/health >/dev/null
install -m 0644 deploy/nginx-tunnel.conf "$target"
ln -s "$target" "$enabled"
if ! nginx -t; then
  rm "$enabled" "$target"
  echo 'Nginx validation failed; the new site was removed.' >&2
  exit 1
fi
systemctl reload nginx
install -m 0644 deploy/slop-city-backup.service deploy/slop-city-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now slop-city-backup.timer
echo 'slopcity.fun now proxies to the Docker game gateway; daily local backups are enabled.'
