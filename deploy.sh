#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Build a Hostinger-uploadable bundle for this app. (Build only — never uploads.)
#
# Mirrors the hosting layout used by the apartment project: the PHP backend lives
# ABOVE the web root, with a tiny bridge inside public_html/api.
#
#   <domain>/
#   ├── .htaccess          root safety deny (domain root, above public_html)
#   ├── .env               API secrets — ABOVE the web root (read by backend/config)
#   ├── UPLOAD_MAP.txt      where each folder goes on Hostinger
#   ├── README.md
#   ├── database/schema.sql ONE structure-only file to import via phpMyAdmin (NOT web-served)
#   ├── backend/            the PHP API (private, above the web root)
#   │   └── index.php, core/, controllers/, models/, …
#   └── public_html/        ← upload to domains/<domain>/public_html/
#       ├── index.html, assets/, *.ico …   the built admin SPA (VITE_API_BASE_URL=/api)
#       ├── .htaccess        SPA routing + /api passthrough + secret denies
#       └── api/index.php    bridge → ../../backend/index.php
#
# Usage:
#   ./deploy.sh                         build the bundle
#   DEPLOY_DOMAIN=foo.example.com ./deploy.sh
#   REGENERATE_ENV=1 ./deploy.sh        force a fresh .env (new JWT)
#   WITH_DEALER=1 ./deploy.sh           also build the dealer-portal subdomain bundle
#
# This script ONLY builds the local <domain>/ bundle. It never connects to any
# server. Upload it yourself (VSCode SFTP extension, hPanel File Manager, or FTP).
#
# When WITH_DEALER=1 a second bundle is produced under <DEALER_DOMAIN>/ (default
# dealer.<DEPLOY_DOMAIN>/) holding ONLY a static SPA in public_html/. It calls the
# main domain's API cross-origin (DEALER_API_BASE_URL, default https://<DEPLOY_DOMAIN>/api),
# so the main .env's CORS_ORIGIN must include https://<DEALER_DOMAIN>.
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-vbsolar.kynetropo.com}"
SERVER_DIR="${SERVER_DIR:-$ROOT_DIR/$DEPLOY_DOMAIN}"
PUBLIC_HTML_DIR="$SERVER_DIR/public_html"
BACKEND_DIR="$SERVER_DIR/backend"
DATABASE_DIR="$SERVER_DIR/database"
ENV_FILE="$SERVER_DIR/.env"

API_BASE_URL="${VITE_API_BASE_URL:-/api}"
APP_URL="${APP_URL:-https://$DEPLOY_DOMAIN}"
CORS_ORIGIN="${CORS_ORIGIN:-https://$DEPLOY_DOMAIN}"

# ── Dealer portal (opt-in: WITH_DEALER=1) ────────────────────────────────────
# A standalone SPA on its own subdomain that talks to the MAIN domain's API
# cross-origin (no /api bridge of its own). Off by default — existing behavior
# is unchanged unless WITH_DEALER=1.
WITH_DEALER="${WITH_DEALER:-0}"
DEALER_DOMAIN="${DEALER_DOMAIN:-dealer.$DEPLOY_DOMAIN}"
DEALER_API_BASE_URL="${DEALER_API_BASE_URL:-https://$DEPLOY_DOMAIN/api}"
DEALER_SERVER_DIR="${DEALER_SERVER_DIR:-$ROOT_DIR/$DEALER_DOMAIN}"
DEALER_PUBLIC_HTML_DIR="$DEALER_SERVER_DIR/public_html"

# DB name/user default to the values captured during rebrand (rebrand/brand.config.json,
# the `database` block) so the name you entered in `rebrand init` flows straight into the
# generated .env. Env vars (DB_NAME=… ./deploy.sh) still override. The password is NEVER
# read from the config (secrets stay out of it) — pass DB_PASS=… or edit .env on the server.
BRAND_CFG="$ROOT_DIR/rebrand/brand.config.json"
cfg_db() { [ -f "$BRAND_CFG" ] && command -v node >/dev/null 2>&1 \
  && node -e 'try{const c=require(process.argv[1]);process.stdout.write(String((c.database&&c.database[process.argv[2]])||""))}catch{}' "$BRAND_CFG" "$1" || true; }

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-$(cfg_db name)}"; DB_NAME="${DB_NAME:-REPLACE_WITH_HOSTINGER_DATABASE_NAME}"
DB_USER="${DB_USER:-$(cfg_db user)}"; DB_USER="${DB_USER:-REPLACE_WITH_HOSTINGER_DATABASE_USER}"
DB_PASS="${DB_PASS:-REPLACE_WITH_HOSTINGER_DATABASE_PASSWORD}"

GROQ_API_KEY="${GROQ_API_KEY:-REPLACE_WITH_GROQ_API_KEY}"
GROQ_API_KEY_NEW="${GROQ_API_KEY_NEW:-}"
GEMINI_API_KEY="${GEMINI_API_KEY:-REPLACE_WITH_GEMINI_API_KEY}"

case "$SERVER_DIR" in
  "$ROOT_DIR"/"$DEPLOY_DOMAIN"|"$ROOT_DIR"/"$DEPLOY_DOMAIN"/*) ;;
  *) echo "Refusing to deploy outside $ROOT_DIR/$DEPLOY_DOMAIN/: $SERVER_DIR" >&2; exit 1 ;;
esac

if [ "$WITH_DEALER" = "1" ]; then
  case "$DEALER_SERVER_DIR" in
    "$ROOT_DIR"/"$DEALER_DOMAIN"|"$ROOT_DIR"/"$DEALER_DOMAIN"/*) ;;
    *) echo "Refusing to deploy dealer outside $ROOT_DIR/$DEALER_DOMAIN/: $DEALER_SERVER_DIR" >&2; exit 1 ;;
  esac
fi

need_command() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }; }
random_hex() { php -r 'echo bin2hex(random_bytes((int) $argv[1]));' "$1"; }

need_command npm
need_command rsync
need_command php

mkdir -p "$PUBLIC_HTML_DIR" "$BACKEND_DIR" "$DATABASE_DIR"

# ── 1. Build the admin SPA into public_html ──────────────────────────────────
if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  (cd "$ROOT_DIR/frontend" && npm ci)
fi

# Gate: render the invoice + quotation PDF templates and fail the deploy if they
# don't paginate/render cleanly — so templates are verified automatically every
# rebrand instead of being hand-tested. Set SKIP_TEMPLATE_VERIFY=1 to bypass.
if [ "${SKIP_TEMPLATE_VERIFY:-0}" != "1" ]; then
  echo "Verifying PDF templates render correctly ..."
  (cd "$ROOT_DIR/frontend" && npm run verify:templates) \
    || { echo "PDF template verification FAILED — fix the template def/engine before deploying." >&2; exit 1; }
fi

echo "Building frontend into $DEPLOY_DOMAIN/public_html ..."
(cd "$ROOT_DIR/frontend" && VITE_API_BASE_URL="$API_BASE_URL" npm run build -- --outDir "$PUBLIC_HTML_DIR" --emptyOutDir)

# ── 2. public_html/api bridge → ../../backend/index.php ──────────────────────
mkdir -p "$PUBLIC_HTML_DIR/api"
cat > "$PUBLIC_HTML_DIR/api/index.php" <<'PHP'
<?php
declare(strict_types=1);

// Bridge: forward every /api request to the PHP backend that lives ABOVE the web
// root. The backend resolves its own paths and reads ../.env (one level above it).
$backend = dirname(__DIR__, 2) . '/backend/index.php';
if (!is_file($backend)) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'message' => 'Backend front controller not found'], JSON_UNESCAPED_SLASHES);
    exit;
}
require $backend;
PHP

# ── 3. Copy the PHP API into the private backend/ folder ─────────────────────
echo "Copying API into $DEPLOY_DOMAIN/backend ..."
rsync -a --delete \
  --exclude '.env' \
  --exclude 'error_log' \
  --exclude 'tests/' \
  --exclude '*.log' \
  "$ROOT_DIR/api/" "$BACKEND_DIR/"
mkdir -p "$BACKEND_DIR/uploads"
find "$BACKEND_DIR/uploads" -type f ! -name '.htaccess' -delete 2>/dev/null || true

# ── 4. .env at the bundle root (backend reads dirname(__DIR__,2)/.env) ───────
if [ -f "$ENV_FILE" ] && [ "${REGENERATE_ENV:-0}" != "1" ]; then
  echo "Kept existing $DEPLOY_DOMAIN/.env (REGENERATE_ENV=1 to replace)."
else
  JWT_SECRET="${JWT_SECRET:-$(random_hex 32)}"
  cat > "$ENV_FILE" <<ENV
# ── Database (Hostinger → MySQL) ─────────────────────────────────────────────
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASS=$DB_PASS
DB_CHARSET=utf8mb4

# ── JWT (auto-generated) ─────────────────────────────────────────────────────
JWT_SECRET=$JWT_SECRET

# ── CORS — origins allowed to call the API ───────────────────────────────────
CORS_ORIGIN=$CORS_ORIGIN

# ── AI keys (optional) ───────────────────────────────────────────────────────
groq_api_key=$GROQ_API_KEY
groq_api_key_new=$GROQ_API_KEY_NEW
gemini_api_key=$GEMINI_API_KEY
ENV
fi
chmod 600 "$ENV_FILE"

# ── 5. public_html/.htaccess — SPA + /api passthrough + denies ───────────────
cat > "$PUBLIC_HTML_DIR/.htaccess" <<'HTACCESS'
Options -Indexes
LimitRequestBody 26214400

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule (^|/)\. - [F,L]
  RewriteRule (^|/)(\.env|.*\.env|.*\.log|.*\.sql|.*\.sqlite|.*\.db|.*\.md)$ - [F,L]

  # Send every /api request to the bridge (the backend strips the /api prefix).
  RewriteRule ^api(?:/(.*))?$ api/index.php [QSA,L]

  # Serve real files/dirs; everything else falls back to the SPA shell.
  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^ - [L]
  RewriteRule ^.*$ index.html [L]
</IfModule>

<FilesMatch "(^\.|\.env|\.log|\.sql|\.sqlite|\.db|\.md)$">
  Require all denied
</FilesMatch>

<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "DENY"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>
HTACCESS

# ── 6. Root safety .htaccess (protects backend/.env if the domain points high) ─
cat > "$SERVER_DIR/.htaccess" <<'HTACCESS'
Options -Indexes
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule (^|/)\. - [F,L]
  RewriteRule ^(backend|database)(/|$) - [F,L]
  RewriteRule (^|/)(\.env|.*\.env|.*\.log|.*\.sql|.*\.sqlite|.*\.db|.*\.md)$ - [F,L]
</IfModule>
<FilesMatch "(^\.|\.env|\.log|\.sql|\.sqlite|\.db|\.md)$">
  Require all denied
</FilesMatch>
HTACCESS

# ── 7. Database: ONE consolidated schema.sql (structure only, no data) ───────
echo "Building consolidated schema (structure only, no mock data) ..."
rm -f "$DATABASE_DIR"/*.sql 2>/dev/null || true
bash "$ROOT_DIR/database/build-schema.sh" >/dev/null
cp "$ROOT_DIR/database/schema.sql" "$DATABASE_DIR/schema.sql"
echo "  -> $DEPLOY_DOMAIN/database/schema.sql ($(grep -c '^CREATE TABLE' "$DATABASE_DIR/schema.sql") tables, 0 rows)"

# ── 8. UPLOAD_MAP.txt + README.md ────────────────────────────────────────────
cat > "$SERVER_DIR/UPLOAD_MAP.txt" <<MAP
Upload map for Hostinger — domain: $DEPLOY_DOMAIN

1. Upload $DEPLOY_DOMAIN/public_html/* -> domains/$DEPLOY_DOMAIN/public_html/
2. Upload $DEPLOY_DOMAIN/backend/*     -> domains/$DEPLOY_DOMAIN/backend/   (ABOVE public_html)
3. Upload $DEPLOY_DOMAIN/.env          -> domains/$DEPLOY_DOMAIN/.env       (ABOVE public_html)
4. Upload $DEPLOY_DOMAIN/.htaccess     -> domains/$DEPLOY_DOMAIN/.htaccess
5. Import $DEPLOY_DOMAIN/database/schema.sql via hPanel -> phpMyAdmin (one file, all tables, no data).
6. Edit domains/$DEPLOY_DOMAIN/.env and set the real DB_* values + AI keys.

Sanity checks:
- https://$DEPLOY_DOMAIN/                 -> admin login
- https://$DEPLOY_DOMAIN/api/...          -> JSON
- https://$DEPLOY_DOMAIN/.env             -> 403/404 (never 200)
- https://$DEPLOY_DOMAIN/backend/.env     -> 403/404 (never 200)

Do NOT upload backend/ inside public_html/. The SPA was built with VITE_API_BASE_URL=$API_BASE_URL.
MAP

cat > "$SERVER_DIR/README.md" <<MD
# $DEPLOY_DOMAIN — Hostinger deploy bundle

Generated by \`./deploy.sh\`. The PHP backend lives ABOVE the web root; a small
bridge in \`public_html/api/index.php\` forwards \`/api\` to it. Secrets in \`.env\`
sit above the web root too.

- Re-running \`./deploy.sh\` keeps the existing \`.env\`; use \`REGENERATE_ENV=1 ./deploy.sh\` to rotate.
- This script only BUILDS the bundle. Upload it yourself via the SFTP extension / hPanel / FTP client.
- Dealer portal is a separate subdomain build: \`WITH_DEALER=1 ./deploy.sh\`.
MD

# ── 8b. Optional dealer-portal bundle (WITH_DEALER=1) ────────────────────────
# A separate subdomain SPA. It calls the MAIN domain's API cross-origin, so it
# needs NO /api bridge and NO backend/.env of its own — just static files + an
# .htaccess for SPA fallback and dotfile denies.
if [ "$WITH_DEALER" = "1" ]; then
  echo
  echo "Building dealer portal into $DEALER_DOMAIN/public_html ..."
  mkdir -p "$DEALER_PUBLIC_HTML_DIR"

  if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
    (cd "$ROOT_DIR/frontend" && npm ci)
  fi
  # build:dealer outputs frontend/dist-dealer/ and renames dealer.html -> index.html.
  (cd "$ROOT_DIR/frontend" && VITE_API_BASE_URL="$DEALER_API_BASE_URL" npm run build:dealer)

  # Copy the built dealer SPA into the bundle's public_html.
  rsync -a --delete \
    --exclude '.htaccess' \
    "$ROOT_DIR/frontend/dist-dealer/" "$DEALER_PUBLIC_HTML_DIR/"

  # public_html/.htaccess — SPA fallback + dotfile denies (no /api bridge here;
  # the dealer hits the main domain's API cross-origin).
  cat > "$DEALER_PUBLIC_HTML_DIR/.htaccess" <<'HTACCESS'
Options -Indexes

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule (^|/)\. - [F,L]
  RewriteRule (^|/)(\.env|.*\.env|.*\.log|.*\.sql|.*\.sqlite|.*\.db|.*\.md)$ - [F,L]

  # Serve real files/dirs; everything else falls back to the SPA shell.
  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^ - [L]
  RewriteRule ^.*$ index.html [L]
</IfModule>

<FilesMatch "(^\.|\.env|\.log|\.sql|\.sqlite|\.db|\.md)$">
  Require all denied
</FilesMatch>

<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>
HTACCESS

  cat > "$DEALER_SERVER_DIR/UPLOAD_MAP.txt" <<MAP
Upload map for Hostinger — dealer portal: $DEALER_DOMAIN

1. Upload $DEALER_DOMAIN/public_html/* -> domains/$DEALER_DOMAIN/public_html/
2. In hPanel, point the $DEALER_DOMAIN document root at domains/$DEALER_DOMAIN/public_html.

This is a STATIC SPA only — no backend/, no .env. It calls the main API at
$DEALER_API_BASE_URL cross-origin.

REQUIRED: the MAIN domain's .env (domains/$DEPLOY_DOMAIN/.env) must allow this
origin in CORS_ORIGIN, e.g.:
  CORS_ORIGIN=https://$DEPLOY_DOMAIN,https://$DEALER_DOMAIN

Sanity checks:
- https://$DEALER_DOMAIN/        -> dealer portal loads
- https://$DEALER_DOMAIN/.env    -> 403/404 (never 200)
MAP

  echo "Dealer bundle ready: $DEALER_PUBLIC_HTML_DIR"
  echo "  Reminder: add https://$DEALER_DOMAIN to CORS_ORIGIN in $ENV_FILE"
fi

echo
echo "Bundle ready:"
echo "  Domain:       $DEPLOY_DOMAIN"
echo "  Web root:     $PUBLIC_HTML_DIR"
echo "  Backend:      $BACKEND_DIR  (served at $API_BASE_URL via bridge)"
echo "  Env secrets:  $ENV_FILE"
echo "  Database SQL: $DATABASE_DIR/"
if [ "$WITH_DEALER" = "1" ]; then
  echo "  Dealer site:  $DEALER_PUBLIC_HTML_DIR  (subdomain $DEALER_DOMAIN -> API $DEALER_API_BASE_URL)"
fi
echo
echo "Next: read $SERVER_DIR/UPLOAD_MAP.txt   (upload the bundle yourself via the SFTP extension / hPanel)"
