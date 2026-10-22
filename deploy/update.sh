#!/usr/bin/env bash
# Installs a new version of the code that was unpacked into /opt/sao-portal, then restarts the app.
# The database and uploads (/var/lib/sao-portal) are not touched; a backup is taken first.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
/usr/local/bin/sao-backup || true
cd /opt/sao-portal && npm ci --omit=dev --no-audit --no-fund
chown -R root:root /opt/sao-portal
systemctl restart sao-portal
sleep 2
curl -fsS http://127.0.0.1:3000/api/session >/dev/null && echo "Updated and running." || { echo "The app did not start: journalctl -u sao-portal -n 50"; exit 1; }
