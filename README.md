# WMS - Warehouse Management System

React 18 + TypeScript + Vite frontend, Node (Express + TypeScript) API, SQLite storage with **every business record encrypted at rest**.

## Features
Products (auto-SKU with colour/weight variations, case packs) · Locations · **Inbound** (packing list → verify → second-person approval → email) · **Transfers** (draft → in transit → received, receiver logged) · **Reserved** orders (hold stock; convert to outbound with the actual-vs-reserved difference recorded) · **Outbound** (save → review/edit → confirm) · Adjustments · Inventory audits (differences in red, summary email) · Product pages with movement history · Inventory & order reports (CSV) · KPI dashboard · Activity log · Backups.

**Access control:** a super admin grants each user an exact set of permissions (29 fine-grained rights plus presets). A user can have only `dashboard.view` and see nothing else. Changes apply immediately (the user's sessions are revoked).

**Client privacy:** clients appear as *Client A, Client B…*. Real name/contact/address are only returned by the API to users holding `clients.reveal` (also applied to reports and CSV exports). Reveals are logged.

## Run (development)
```bash
npm install && npm --prefix server install
npm --prefix server run create-admin -- you@example.com "Your Name"   # prints a one-time password
npm --prefix server run dev        # API on :4000 (a dev master key is auto-created in server/data)
npm run dev                        # UI on :5173 (proxies /api)
# optional demo data:  npm --prefix server run seed-demo
```
Requires Node ≥ 22.13 (uses the built-in `node:sqlite`).

## Try it online (GitHub Pages demo)
`.github/workflows/pages.yml` publishes a **demo build** to `https://<owner>.github.io/<repo>/`. GitHub Pages is static hosting, so the demo uses an in-browser fake backend (`src/lib/demo.ts`) with sample data kept in your browser's localStorage. It is for testing the UI and flows only: no real security, no encryption, no backups. Demo logins are shown on the sign-in page. Real use needs the Node server below. Build locally with `npm run build:demo`.

## Run (production)
```bash
npm run build                      # builds ./dist, served by the API on the same origin
cp .env.example .env               # set WMS_MASTER_KEY, WMS_ORIGIN, ... and export them / use your secret manager
NODE_ENV=production npm start      # put it behind HTTPS (nginx/Caddy); cookies are Secure + __Host- in production
```

## Security model (OWASP Top 10 mapping)
| Risk | Control |
|---|---|
| A01 Broken access control | Server-side permission check on **every** route (`requirePerm`); hiding things in the UI is cosmetic only. User admin is super-admin only (no privilege escalation). Unknown permission keys rejected. Real client data is stripped server-side unless `clients.reveal`. |
| A02 Cryptographic failures | AES-256-GCM per row (random IV, AAD = table:id so rows can't be swapped), HKDF-separated keys for data / lookups / backups / log chain. Lookups (email, SKU, session) use HMAC blind indexes, so no plaintext identifiers sit in the DB file. Passwords: scrypt (N=2¹⁷). Master key only from env / secret manager. |
| A03 Injection | Parameterised SQL only; zod `.strict()` validation on every body/query; React escapes output; CSV exports neutralise formula injection; plain-text emails. |
| A04 Insecure design | Segregation of duties (you can't approve your own inbound), immutable stock-movement ledger, atomic transactions, no negative or over-reserved stock, comments required on discrepancies. |
| A05 Misconfiguration | Helmet: strict CSP (no inline scripts), HSTS, frame-ancestors none, no-store, no `X-Powered-By`; 200 KB JSON limit; no stack traces to clients. |
| A07 Auth failures | Generic login errors with timing equalisation, lockout after 5 failures, rate limits, TOTP 2FA (replay-protected; optional or enforced with `WMS_REQUIRE_MFA`), forced change of issued passwords, password policy, idle (30 min) and absolute (8 h) session timeouts, sessions revoked on password/permission change or disable. |
| A08 Integrity | Hash-chained (HMAC) activity log with a verify endpoint; backups are authenticated-encrypted and verified after creation. |
| A09 Logging | Logins, failures, lockouts, user/permission changes, client reveals, every stock operation, backups. |
| CSRF | httpOnly + `SameSite=Strict` cookie, per-session CSRF token header, and an Origin check. |

**Also do (outside the app):** serve over HTTPS only; run on an encrypted volume (LUKS / BitLocker / cloud disk encryption) so the whole disk, including WAL and temp files, is covered; restrict the firewall to 443; run as a non-root user; keep Node and npm dependencies patched (`npm audit` in CI); store `WMS_MASTER_KEY` in a secret manager and keep a sealed offline copy.

## Backups
* Created with SQLite `VACUUM INTO` (consistent snapshot), encrypted with AES-256-GCM under a dedicated backup key, then **decrypted and integrity-checked**. Only after that are old copies pruned. The newest **3** are kept (`WMS_BACKUP_KEEP`).
* Schedule: `WMS_BACKUP_CRON` (default weekly). Super admins can also use **Back up now** in *Backups & settings*, or `npm --prefix server run backup`.
* Restore: stop the server, run `npm --prefix server run restore -- <backup.db.enc> /path/new.db`, then point `WMS_DB_PATH` at it. The same `WMS_MASTER_KEY` is required.
* **Which schedule is best?** With 3 copies kept, *daily* gives 3 days of history, *weekly* 3 weeks, *monthly* 3 months. For an operational WMS we recommend **daily** (loss ≤ 24 h) plus copying the files off-site; raise `WMS_BACKUP_KEEP` for longer history. Test a restore regularly.

## Tests
`npm test` (frontend) · `npm --prefix server test` (API: auth, CSRF, permissions, encryption, stock flows, masking, backups) · `npm run lint` · `npm run typecheck`
