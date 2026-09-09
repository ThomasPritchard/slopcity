#!/bin/sh
set -eu

# Run once with sudo on a fresh Ubuntu 24.04 server. Existing web services and
# firewall rules are left in place for the subsequent site-specific deployment.
test "$(id -u)" -eq 0 || { echo 'Run this script with sudo.' >&2; exit 1; }
deploy_user=${1:-${SUDO_USER:-}}
case "$deploy_user" in ''|root|*[!a-zA-Z0-9_-]*) echo 'Supply the normal deployment username.' >&2; exit 1;; esac
id "$deploy_user" >/dev/null
. /etc/os-release
test "$ID" = ubuntu && test "$VERSION_ID" = 24.04 || { echo 'This bootstrap targets Ubuntu 24.04.' >&2; exit 1; }

for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
  if dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null | grep -qx installed; then
    echo "Existing $package needs review before installing Docker CE; nothing removed." >&2
    exit 1
  fi
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
if ! test -f /etc/apt/keyrings/docker.asc; then
  curl --fail --silent --show-error --location https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc.tmp
  chmod 0644 /etc/apt/keyrings/docker.asc.tmp
  mv /etc/apt/keyrings/docker.asc.tmp /etc/apt/keyrings/docker.asc
fi
if ! test -f /etc/apt/sources.list.d/docker.sources; then
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
fi
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker "$deploy_user"
if ! test -e /opt/slop-city; then
  install -d -m 0755 -o "$deploy_user" -g "$(id -gn "$deploy_user")" /opt/slop-city
fi
docker version --format '{{.Server.Version}}'
docker compose version
echo "Docker is ready. Reconnect SSH to activate $deploy_user's Docker group membership."
echo 'Docker access permits root-equivalent administration. Nginx and firewall configuration are unchanged.'
