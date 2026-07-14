# Security Rotation & Git-History Purge Checklist

Generated as part of the `fix/security-hardening` remediation. These steps require
**operator action** (access to Hostinger, GitHub, and the API providers) — they
cannot be performed from the codebase alone. Do them **before** merging this branch
to production.

> ⚠️ `main` must stay untouched by tooling. The history-purge steps below are
> destructive to history and require a force-push; run them deliberately, with a
> full backup, when the team is ready.

## 1. Rotate every secret that was ever committed

These were committed to git history at some point (see `.env` comments and the
removed DB dump). Assume they are compromised and rotate all of them:

| Secret | Where | How to rotate |
|--------|-------|---------------|
| `JWT_SECRET` | server `.env` (above web root) | `php -r "echo bin2hex(random_bytes(32));"` → replace in `.env`. **Invalidates all existing tokens** (intended). |
| `DB_PASS` | Hostinger → Databases → MySQL | Set a new password in hPanel, update `.env`. |
| FTP / SFTP password | Hostinger → Files → FTP Accounts | Reset the account password (the old one was in `.vscode/sftp.json`, which is in history). |
| `groq_api_key`, `groq_api_key_new` | https://console.groq.com | Revoke old keys, issue new, update `.env`. |
| `gemini_api_key` | https://aistudio.google.com | Revoke old key, issue new, update `.env`. |
| Fast2SMS key (`fast25sms.txt`) | https://www.fast2sms.com | Regenerate if it was ever committed; keep the file out of git (now gitignored). |

After rotating, confirm the app still boots (DB connects, login issues a token).

## 2. Purge sensitive blobs from git history

Removing a file in a new commit does **not** remove it from history. Two files must
be scrubbed from the full history of every branch (including `main`):

- `database/u952547820_ecosudar (13).sql` — production DB dump (PII + password hashes)
- `.vscode/sftp.json` — leaked FTP credentials

Using [`git filter-repo`](https://github.com/newren/git-filter-repo) (recommended):

```bash
# Back up first
git clone --mirror <repo-url> repo-backup.git

# In a fresh clone:
git filter-repo \
  --path "database/u952547820_ecosudar (13).sql" \
  --path ".vscode/sftp.json" \
  --invert-paths

# Re-add the remote and force-push all refs (coordinate with the team first)
git remote add origin <repo-url>
git push --force --all
git push --force --tags
```

Every collaborator must then re-clone (old clones still contain the secrets).

## 3. If the GitHub repo is or was public

Treat all of the above secrets as fully compromised (they may be cached/indexed).
Rotation in step 1 is mandatory, not optional. Confirm the repo is **private**.

## 4. Going forward

- DB dumps and `fast25sms.txt` are now gitignored (see `.gitignore`).
- Keep real `.env` only on the server, above the web root (already the case).
- Consider enabling GitHub secret scanning / push protection.
