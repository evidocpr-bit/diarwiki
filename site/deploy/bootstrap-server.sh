#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

DEPLOY_USER="diarwiki"
SITE_ROOT="/srv/diarwiki"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  apt-transport-https \
  ca-certificates \
  curl \
  debian-archive-keyring \
  debian-keyring \
  fail2ban \
  gnupg \
  rsync \
  ufw

if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    -o /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
fi

if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos '' "${DEPLOY_USER}"
fi
usermod -aG caddy "${DEPLOY_USER}"

install -d -o "${DEPLOY_USER}" -g caddy -m 2750 "${SITE_ROOT}"
install -d -o "${DEPLOY_USER}" -g caddy -m 2750 \
  "${SITE_ROOT}/releases" \
  "${SITE_ROOT}/backups" \
  "${SITE_ROOT}/shared"

if [[ -f /root/.ssh/authorized_keys ]]; then
  install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 0700 "/home/${DEPLOY_USER}/.ssh"
  install -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 0600 \
    /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
fi

install -o root -g root -m 0644 ./Caddyfile /etc/caddy/Caddyfile
install -o root -g root -m 0644 ./10-diarwiki-security.conf /etc/ssh/sshd_config.d/10-diarwiki-security.conf
install -o root -g root -m 0644 ./fail2ban-diarwiki.local /etc/fail2ban/jail.d/diarwiki.local
install -o root -g root -m 0755 ./activate-release.sh /usr/local/sbin/diarwiki-activate
install -o root -g root -m 0755 ./rollback-release.sh /usr/local/sbin/diarwiki-rollback
install -o root -g root -m 0755 ./record-release-result.sh /usr/local/sbin/diarwiki-record-release
install -o root -g root -m 0755 ./verify-release.sh /usr/local/sbin/diarwiki-verify-release
install -o root -g root -m 0755 ./backup-server.sh /usr/local/sbin/diarwiki-backup

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

sshd -t
systemctl reload ssh
systemctl enable --now fail2ban
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload-or-restart caddy

echo "Server bootstrap complete. Caddy is running and will obtain TLS when public DNS is valid."
