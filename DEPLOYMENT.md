# Deployment Guide

End-to-end guide for rebranding, building, and deploying this app to Hostinger.
Everything here is driven by `./deploy.sh` (build/push) and the Hostinger hPanel
(domain + database + SQL import). Read this once before your first deploy.

## 1. Architecture

The build produces a self-contained bundle under `<DEPLOY_DOMAIN>/` (default
`vbsolar.kynetropo.com/`) that mirrors Hostinger's layout, keeping the PHP API and
secrets ABOVE the public web root:

```
<DEPLOY_DOMAIN>/
├── .htaccess          root safety deny (sits ABOVE public_html on Hostinger)
├── .env               API secrets — ABOVE the web root (read by the backend)
├── UPLOAD_MAP.txt     where each folder goes on Hostinger
├── README.md
├── database/schema.sql  ONE structure-only file to import via phpMyAdmin (NOT web-served)
├── backend/           the PHP API (private, above the web root) — copied from api/
└── public_html/       ← the web root (upload to domains/<DEPLOY_DOMAIN>/public_html/)
    ├── index.html, assets/, …   the built admin SPA (VITE_API_BASE_URL=/api)
    ├── .htaccess                SPA routing + /api passthrough + secret denies
    └── api/index.php            bridge → ../../backend/index.php
```

- **Admin SPA** (`frontend/`) is built with `VITE_API_BASE_URL=/api` and served from
  `public_html/`. Requests to `/api/*` are rewritten by `public_html/.htaccess` to
  `public_html/api/index.php`, a thin bridge that `require`s the real front controller
  at `../../backend/index.php`.
- **PHP API** is copied from the repo's `api/` directory into `<DEPLOY_DOMAIN>/backend/`,
  which lives ABOVE the web root so its source is never directly served. It reads
  `../.env` (i.e. `<DEPLOY_DOMAIN>/.env`).
- **Dealer portal** (optional, `WITH_DEALER=1`) is a SEPARATE standalone SPA built from
  the same `frontend/` codebase via `npm run build:dealer` (output `frontend/dist-dealer/`).
  It deploys to its own subdomain bundle `<DEALER_DOMAIN>/public_html/` (default
  `dealer.<DEPLOY_DOMAIN>/`) and calls the MAIN domain's API cross-origin — so it has
  NO `/api` bridge and NO backend of its own.

## 2. Rebrand for a new company

Use the rebrand CLI to retarget the app to a new brand (names, colors, assets):

```bash
node rebrand/rebrand.mjs init       # guided prompts → writes rebrand/brand.config.json
# drop the new logo / favicon / images into rebrand/assets/
node rebrand/rebrand.mjs --apply    # apply text replacements + asset renames/copies
```

`init` writes `rebrand/brand.config.json`; running `--apply` without it does a dry run.
Review the diff after `--apply`, then rebuild the deploy bundle (section 3).

## 3. Build the deploy bundle

From the repo root, supply the domain and DB values and run `deploy.sh`:

```bash
DEPLOY_DOMAIN=vbsolar.kynetropo.com \
DB_NAME=u952547820_xxx DB_USER=u952547820_xxx DB_PASS='...' \
./deploy.sh
```

Add the dealer portal in the same run with `WITH_DEALER=1`:

```bash
WITH_DEALER=1 DEPLOY_DOMAIN=vbsolar.kynetropo.com \
DB_NAME=... DB_USER=... DB_PASS='...' \
./deploy.sh
```

`deploy.sh` requires `npm`, `rsync`, and `php` on your PATH (`php` is used to generate
the JWT secret). Re-running keeps the existing `.env`; pass `REGENERATE_ENV=1` to rotate it.

**PDF template gate:** before building, `deploy.sh` runs `npm run verify:templates`,
which renders the invoice + quotation templates (small **and** multi-page datasets)
and **fails the deploy if a template/engine change broke rendering or pagination**.
The templates are token-driven (company name/GSTIN/bank/logo/color come from Settings),
so a rebrand never alters their layout — this gate means you don't hand-test the PDFs
each time. Run it standalone anytime with `cd frontend && npm run verify:templates`.
Bypass in a pinch with `SKIP_TEMPLATE_VERIFY=1 ./deploy.sh`.

### Environment variables `deploy.sh` reads

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEPLOY_DOMAIN` | `vbsolar.kynetropo.com` | Main domain; names the output bundle dir `<DEPLOY_DOMAIN>/`. |
| `VITE_API_BASE_URL` | `/api` | API base baked into the admin SPA build (keep `/api` for the bridge). |
| `APP_URL` | `https://<DEPLOY_DOMAIN>` | App URL recorded for the deploy. |
| `CORS_ORIGIN` | `https://<DEPLOY_DOMAIN>` | Origins allowed to call the API (written into `.env`). **Add the dealer origin here if using the dealer portal** — see section 5. |
| `DB_HOST` | `localhost` | MySQL host (Hostinger MySQL is `localhost`). |
| `DB_PORT` | `3306` | MySQL port. |
| `DB_NAME` | placeholder | MySQL database name. |
| `DB_USER` | placeholder | MySQL user. |
| `DB_PASS` | placeholder | MySQL password. |
| `GROQ_API_KEY` | placeholder | Optional AI key (written to `.env` as `groq_api_key`). |
| `GROQ_API_KEY_NEW` | empty | Optional secondary Groq key (`groq_api_key_new`). |
| `GEMINI_API_KEY` | placeholder | Optional AI key (`gemini_api_key`). |
| `JWT_SECRET` | random | JWT signing secret; auto-generated if unset. |
| `REGENERATE_ENV` | `0` | `1` overwrites an existing `.env` (rotates JWT + re-applies values). |
| `WITH_DEALER` | `0` | `1` also builds the dealer-portal subdomain bundle. |
| `DEALER_DOMAIN` | `dealer.<DEPLOY_DOMAIN>` | Subdomain for the dealer portal bundle. |
| `DEALER_API_BASE_URL` | `https://<DEPLOY_DOMAIN>/api` | API base baked into the dealer SPA (points at the MAIN domain, cross-origin). |

If you leave `DB_NAME` / `DB_USER` / `DB_PASS` as defaults, the generated `.env` holds
placeholders you must replace in hPanel after upload (section 5).

## 4. Upload the bundle (you do this — `deploy.sh` never uploads)

`deploy.sh` only builds the local `<DEPLOY_DOMAIN>/` folder. Upload it yourself:

- **VSCode SFTP extension** — right-click the `<DEPLOY_DOMAIN>/` folder → **Upload Folder**
  (its `remotePath`/target decides where it lands; confirm that matches the domain's
  document root from section 5). Repeat for `<DEALER_DOMAIN>/` if using the dealer portal.
- **hPanel File Manager** — drag the bundle into the domain's folder.
- **Any FTP client** (FileZilla, etc.) using your Hostinger FTP credentials.

Do **not** upload `database/` into the web root — import `database/schema.sql` via
phpMyAdmin instead (section 5).

## 5. Hostinger hPanel steps (REQUIRED to go live)

**Uploading files is not enough — you must do these in hPanel or the site will not work.**

1. **Point the domain at `public_html`.** In hPanel add the domain (and the dealer
   subdomain if used), and set each one's document root to
   `domains/<DEPLOY_DOMAIN>/public_html` (and `domains/<DEALER_DOMAIN>/public_html`).
   The `backend/` and `.env` must remain ABOVE the web root.
2. **Create the MySQL database + user** in hPanel (MySQL Databases). Then edit
   `domains/<DEPLOY_DOMAIN>/.env` and set the real `DB_NAME`, `DB_USER`, `DB_PASS`,
   and `DB_HOST` (`localhost` on Hostinger).
3. **Import `database/schema.sql`** via hPanel → phpMyAdmin into that database — a single
   structure-only file (all 83 tables, no data), generated by `bash database/build-schema.sh`.
   It already includes every module (Quotation Builder, inventory, HR, finance, etc.) — no
   other SQL files need importing.
4. **Dealer portal CORS (if `WITH_DEALER=1`):** the dealer SPA calls the main API
   cross-origin, so `CORS_ORIGIN` in the MAIN `.env` (`domains/<DEPLOY_DOMAIN>/.env`)
   must include the dealer origin, e.g.:

   ```
   CORS_ORIGIN=https://<DEPLOY_DOMAIN>,https://<DEALER_DOMAIN>
   ```

## 6. Post-deploy verification checklist

- `https://<DEPLOY_DOMAIN>/` loads the admin login screen.
- `https://<DEPLOY_DOMAIN>/api/...` returns JSON (not an HTML page).
- `https://<DEPLOY_DOMAIN>/.env` returns 403/404 (never 200).
- `https://<DEPLOY_DOMAIN>/backend/.env` returns 403/404 (never 200).
- If using the dealer portal: `https://<DEALER_DOMAIN>/` loads the dealer portal, and
  `https://<DEALER_DOMAIN>/.env` returns 403/404.

## 7. Troubleshooting

- **`/` shows a Hostinger "Default page".** The domain's document root is not pointed at
  `public_html` yet. Fix the document root in hPanel (section 5, step 1).
- **`/api/*` returns a static 404 HTML page** (instead of JSON). The domain/document root
  isn't active or `.htaccess` rewrites aren't being applied — confirm the docroot is
  `…/public_html` and that `public_html/.htaccess` uploaded and `mod_rewrite` is enabled.
- **Dealer portal gets CORS errors in the browser.** Add `https://<DEALER_DOMAIN>` to
  `CORS_ORIGIN` in the MAIN domain's `.env` (section 5, step 4).
