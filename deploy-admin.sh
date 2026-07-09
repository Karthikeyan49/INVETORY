#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${FRONTEND_DIR:-$ROOT_DIR/frontend}"
DIST_DIR="${DIST_DIR:-$FRONTEND_DIR/dist}"
ADMIN_DIR="${ADMIN_DIR:-$ROOT_DIR/admin}"
RUN_BUILD=1

case "${1:-}" in
  --skip-build|--no-build)
    RUN_BUILD=0
    ;;
  "")
    ;;
  *)
    echo "Usage: bash deploy-admin.sh [--skip-build]" >&2
    exit 2
    ;;
esac

if [[ -L "$ADMIN_DIR" ]]; then
  echo "Refusing to deploy: $ADMIN_DIR is a symbolic link. Replace it with a real folder first." >&2
  exit 1
fi

mkdir -p "$ADMIN_DIR"

if [[ "$RUN_BUILD" -eq 1 ]]; then
  if [[ ! -f "$FRONTEND_DIR/package.json" ]]; then
    echo "Frontend package not found: $FRONTEND_DIR/package.json" >&2
    exit 1
  fi

  echo "Building admin frontend..."
  (cd "$FRONTEND_DIR" && npm run build)
fi

if [[ ! -d "$DIST_DIR" || ! -f "$DIST_DIR/index.html" ]]; then
  echo "Build output not found: $DIST_DIR/index.html" >&2
  echo "Run npm run build inside frontend first, or run this script without --skip-build." >&2
  exit 1
fi

DIST_REAL="$(readlink -f "$DIST_DIR")"
ADMIN_REAL="$(readlink -f "$ADMIN_DIR")"

if [[ "$DIST_REAL" == "$ADMIN_REAL" ]]; then
  echo "Refusing to deploy: dist and admin resolve to the same folder." >&2
  exit 1
fi

HTACCESS_BACKUP=""
if [[ -f "$ADMIN_DIR/.htaccess" ]]; then
  HTACCESS_BACKUP="$ADMIN_DIR/.htaccess.deploy-admin.tmp"
  cp "$ADMIN_DIR/.htaccess" "$HTACCESS_BACKUP"
fi

echo "Clearing old admin build..."
find "$ADMIN_DIR" -mindepth 1 -maxdepth 1 ! -name ".htaccess.deploy-admin.tmp" -exec rm -rf -- {} +

echo "Copying dist to admin..."
cp -a "$DIST_DIR"/. "$ADMIN_DIR"/

if [[ -n "$HTACCESS_BACKUP" ]]; then
  mv "$HTACCESS_BACKUP" "$ADMIN_DIR/.htaccess"
elif [[ ! -f "$ADMIN_DIR/.htaccess" ]]; then
  printf 'Options -Indexes\n' > "$ADMIN_DIR/.htaccess"
fi

echo "Admin deploy folder updated: $ADMIN_DIR"
