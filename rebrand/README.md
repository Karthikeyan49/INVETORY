# Rebranding Tool

This directory contains a reusable, config-driven rebranding tool for turning the EcoSudar template into another company brand.

## Files

- `brand.config.json`: the only file end users edit.
- `rebrand.mjs`: Node ESM script with zero npm dependencies.
- `assets/logo.png`: optional replacement logo, created by you before applying.
- `assets/favicon.ico`: optional replacement favicon, created by you before applying.

## Usage

1. Edit `rebrand/brand.config.json`.
2. Optionally add new brand assets:
   - `rebrand/assets/logo.png`
   - `rebrand/assets/favicon.ico`
3. Preview the plan:

```sh
node rebrand/rebrand.mjs
```

4. Apply the rebrand:

```sh
node rebrand/rebrand.mjs --apply
```

5. Review the result.

The tool is dry-run by default. It writes only when `--apply` is passed.

### Backups / undo

How you undo depends on whether this project folder is tracked by git:

- **If this folder is its own git repo** (run `git rev-parse --show-toplevel` and confirm it points at this folder): review with `git diff` and undo with `git checkout .`.
- **If it is NOT tracked here** (e.g. this is an untracked working copy): git cannot undo it. Make a backup first, for example:

```sh
# from the project root, before running --apply
tar czf ../rebrand-backup.tar.gz api frontend/src frontend/public \
  frontend/index.html frontend/dealer.html \
  frontend/.env frontend/.env.example \
  frontend/*.ts admin/index.html
```

To undo, extract that archive back over the project root and delete the newly
created `<kebab>-logo.png` / `my<stem>.ico` assets.

## Config Keys

- `displayName`: spaced brand name. Replaces `Eco Sudar`.
- `compactName`: no-space brand name. Replaces `EcoSudar`.
- `legalName`: full legal entity name. Replaces `Eco Sudar Bio Energy LLP`.
- `division`: division or entity suffix label. Replaces standalone `Bio Energy LLP`.
- `stem`: lowercase identifier stem for domains, emails, database names, exports, and favicon stems. Replaces `ecosudar`.
- `kebab`: lowercase hyphenated brand. Replaces `eco-sudar`, except it never changes the `frontend` directory name.
- `qrPrefix`: employee QR token prefix. Replaces `ESD`.
- `poPrefix`: purchase order prefix. Replaces `ECO-PO`.
- `business.description`: AI prompt business description.
- `business.productsLine`: AI prompt product line.
- `business.tagline`: sales PDF tagline.
- `contact.address`: sales PDF address line.
- `contact.gstin`: sales PDF GSTIN value.
- `bank.accountName`: sales PDF bank account name.
- `bank.accountNo`: sales PDF account number.
- `bank.ifsc`: sales PDF IFSC.
- `bank.branchLine`: sales PDF bank branch/account line.
- `domains.apiBaseUrl`: exact `VITE_API_BASE_URL` value for the control app env files.
- `database.name`: guarded root `.env` `DB_NAME` value.
- `database.user`: guarded root `.env` `DB_USER` value.
- `database.applyToEnv`: when `true`, the tool updates root `.env` `DB_NAME` and `DB_USER`; when `false`, root `.env` is skipped.
- `deploy.sftpRemotePath`: guarded `.vscode/sftp.json` remote path.
- `deploy.applyToSftp`: when `true`, the tool updates `.vscode/sftp.json`; when `false`, SFTP config is skipped.

Uppercase variants are derived by the script from `displayName` and `legalName`.

## Scope And Guards

The generic token pass is limited to:

- `api/**/*.php`
- `api/**/*.sh`
- `frontend/src/**/*.{ts,tsx,css}`
- `frontend/index.html`
- `frontend/dealer.html`
- `frontend/*.ts`
- `frontend/.env`
- `frontend/.env.example`
- `admin/index.html`

The tool always excludes build output, vendor directories, binaries, self files, `database/*.sql`, and minified admin bundles under `admin/assets/`.

Root `.env` and `.vscode/sftp.json` are never touched by the generic pass. They are updated only when their guarded config flags are set to `true`.

Database dumps such as `database/*.sql` are data snapshots and should be handled separately.

## After Applying

1. Verify the PDF templates still render (invoice + quotation, incl. multi-page):

```sh
cd frontend && npm run verify:templates
```

The invoice/quotation PDFs are **token-driven templates** (`frontend/src/templates/*.template.json`)
that pull the new company's name/GSTIN/bank/logo/color from Settings — the rebrand
does **not** change their layout, so they stay correct across companies. This test
(and the `deploy.sh` gate) confirms they render + paginate cleanly, so you never
hand-test the PDFs per rebrand.

2. Rebuild admin:

```sh
cd frontend && npm run build && bash ../deploy-admin.sh
```

2. Rebuild dealer if used:

```sh
npm run build:dealer
```

3. Update real secrets, database credentials, and SFTP settings manually if you left the guarded flags disabled.
4. Review the changes (via `git diff` if this folder is a git repo, otherwise compare against your backup).
5. To undo, restore from your backup (see "Backups / undo" above).
