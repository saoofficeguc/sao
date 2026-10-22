#!/usr/bin/env bash
# One-time setup of the SAO Portal on a fresh Ubuntu 24.04 server. Run as root:
#   bash /opt/sao-portal/deploy/setup.sh [your-domain]
# Without a domain the site gets a free address based on the server's IP (e.g. 203-0-113-5.sslip.io) with HTTPS.
# Installs: Node.js 22, LibreOffice (for the PDFs) + fonts, Caddy (HTTPS), a firewall, the app as a service, and daily backups.
set -euo pipefail

APP_DIR=/opt/sao-portal
DATA_DIR=/var/lib/sao-portal
BACKUP_DIR=/var/backups/sao-portal
ENV_FILE=/etc/sao-portal.env
PORT=3000

[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
[ -f "$APP_DIR/server.js" ] || { echo "The app is not in $APP_DIR."; exit 1; }

IP=$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')
DOMAIN="${1:-${IP//./-}.sslip.io}"
echo "==> Setting up the SAO Portal at https://$DOMAIN"

export DEBIAN_FRONTEND=noninteractive

# Small servers (1 GB) get 2 GB of swap so PDF conversion never runs out of memory
if [ ! -f /swapfile ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 3000000 ]; then
  echo "==> Adding 2 GB swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> System packages, LibreOffice and fonts"
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw sqlite3 debian-keyring debian-archive-keyring apt-transport-https \
  libreoffice-writer-nogui fonts-liberation fonts-dejavu fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core

echo "==> Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Caddy (HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "==> App account, folders and packages"
id sao >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin sao
mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chown -R sao:sao "$DATA_DIR"
chmod 750 "$DATA_DIR" "$BACKUP_DIR"
cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund
chown -R root:root "$APP_DIR"

# Settings file (the Claude API key for "Draft with AI" goes here)
if [ ! -f "$ENV_FILE" ]; then
  printf '# SAO Portal settings. After editing: systemctl restart sao-portal\n# ANTHROPIC_API_KEY=your-key\n' > "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

echo "==> Service"
cat > /etc/systemd/system/sao-portal.service <<EOF
[Unit]
Description=SAO Portal
After=network.target

[Service]
User=sao
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=$PORT
Environment=SAO_DATA_DIR=$DATA_DIR
Environment=SAO_SECURE_COOKIES=1
Environment=HOME=$DATA_DIR
EnvironmentFile=-$ENV_FILE
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now sao-portal
systemctl restart sao-portal

echo "==> Web address and HTTPS"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	request_body {
		max_size 60MB
	}
	reverse_proxy 127.0.0.1:$PORT
	header Strict-Transport-Security "max-age=31536000"
}
EOF
systemctl reload caddy || systemctl restart caddy

echo "==> Firewall: only SSH and the website"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> Daily backup at 02:30 (keeps 14 days)"
cat > /usr/local/bin/sao-backup <<EOF
#!/usr/bin/env bash
set -euo pipefail
STAMP=\$(date +%F)
[ -f $DATA_DIR/sao.db ] || exit 0
sqlite3 $DATA_DIR/sao.db ".backup '$BACKUP_DIR/sao-\$STAMP.db'"
tar -czf $BACKUP_DIR/uploads-\$STAMP.tar.gz -C $DATA_DIR uploads
find $BACKUP_DIR -type f -mtime +14 -delete
EOF
chmod 750 /usr/local/bin/sao-backup
echo "30 2 * * * root /usr/local/bin/sao-backup" > /etc/cron.d/sao-backup

sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/session" >/dev/null; then echo "==> The app is running."; else echo "!! The app did not start. See: journalctl -u sao-portal -n 50"; exit 1; fi
echo
echo "Done. Open https://$DOMAIN and create the SAO Office account straight away."
