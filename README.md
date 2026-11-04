# WMS - Warehouse Management System

React 18 + TypeScript + Vite frontend, Node (Express + TypeScript) API, SQLite storage with **every business record encrypted at rest**.

## Features
Products (auto-SKU with colour/weight variations, case packs) · Locations · **Inbound** (packing list → verify → second-person approval → email) · **Transfers** (draft → in transit → received, receiver logged) · **Reserved** orders (hold stock; convert to outbound with the actual-vs-reserved difference recorded) · **Outbound** (save → review/edit → confirm) · Adjustments · Inventory audits (differences in red, summary email) · Product pages with movement history · Inventory & order reports (CSV) · KPI dashboard · Activity log · Backups.

**Owner approval:** the team can *submit* new products, new locations, inventory adjustments and completed audits, but nothing goes live (no product in the list, no published location, no stock change) until the owner (anyone holding `approvals.manage`) reviews and approves it on the **Approvals** page. Owners' own submissions are approved immediately. Audits show the owner counted vs system differences before inventory is updated.

**Dashboard:** order data (Inbound, Outbound, Reserved, Pending, Transfers, Completed) with weekly / monthly / yearly filters, top products *by orders*, and a "no sales in 30 days" insight.

**Products:** no field is mandatory; one weight field; case pack optional; measured by units, kg, metres or bundles. Staff search products by name + variation (colour/size), never by SKU.

**Access control:** a super admin grants each user an exact set of permissions (30 fine-grained rights plus presets). A user can have only `dashboard.view` and see nothing else. Changes apply immediately (the user's sessions are revoked).

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

## Error handling
Every API error has one shape: `{ error: "<plain sentence>", code: "<stable id>", fields?: [{field, message}], requestId? }`.
* **Validation** lists every problem in plain language ("Reason must be at least 3 characters.", "Products, line 2, Product must be a number") and tags the field.
* **Business rules** name the product, place and numbers ("Not enough available stock: Cotton T-Shirt - Black · L at Karachi Main has 6 available right now (4 of 10 is already reserved)").
* **Auth**: wrong password (mentions the 5-attempt lockout without revealing if the account exists), expired session (the user is told why they were signed out), permission denied (says who to ask), rate limits (with `Retry-After`).
* **Unexpected faults** show a generic message plus a **reference id** (also in the `X-Request-Id` header). Details stay in the server log under that id; stack traces, SQL and file paths never reach the browser.
* **UI** (`src/lib/errors.ts`): one function maps any failure to a title + advice. Offline/timeouts ("Can't reach the server... Nothing was saved."), "Try again" buttons on pages that fail to load, a crash screen instead of a blank page, a "couldn't load this page" screen when a page's code can't download, an offline banner, a friendly "page not found", and no-access pages that say what to do.

## Tests
* `server/tests/review.test.ts`: regression tests, one block per review comment (approvals, dashboard, product form/list/detail, movement history).
* `server/tests/pentest.test.ts`: automated penetration tests. It auto-discovers every route and proves each is unauthenticated=401 / no-permission=403 / CSRF-protected, then attacks with SQL injection, XSS, CSV injection, mass assignment, privilege escalation, prototype pollution, oversized/malformed bodies, session fixation/replay/timeouts, brute force, race conditions (double-ship, double-approve) and checks hardening headers and encryption at rest.
* `server/tests/errors.test.ts` + `src/**/*.test.*`: every error path returns a plain-language message with a stable code, never leaks internals, and renders correctly (inline box, toast, crash screen, offline banner, session-ended notice).
* `npm audit`: production dependencies report 0 known vulnerabilities (one moderate, dev-only ESLint/minimatch advisory remains; it does not ship).

`npm test` (frontend) · `npm --prefix server test` (API: auth, CSRF, permissions, encryption, stock flows, masking, backups) · `npm run lint` · `npm run typecheck`
