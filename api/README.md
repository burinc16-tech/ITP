# API (Cloudflare Worker + D1 + R2)

Hono Worker for the ITP/ITR app (SPEC §3). Handles the record **sync push** /
read-back and the **server side of remote sign-off** (§6 path B). The public
React link page, transactional email, and real auth are later tasks (2b+).

## Layout

- `api/src/app.ts` — the Hono app (factory, testable against in-memory stores).
- `api/src/store.ts` — store interfaces + D1/R2 and in-memory implementations
  (records, signature requests, signatures, audit, signature images).
- `api/src/token.ts` — link-token generation, sha-256 hashing, image decode.
- `api/src/index.ts` — Worker entry (`fetch`), wires D1 + R2 + secret.
- `api/wrangler.toml` — bindings (D1 `DB`, R2 `SIGNATURES`, `API_SECRET`).
- `db/migrations/0001_init.sql` — base schema.
- `db/migrations/0002_signoff.sql` — sign-off columns (`slot_id`, signer evidence).
- `db/migrations/0003_auth.sql` — users + sessions.
- `db/migrations/0004_attachments.sql` — photo attachments (bytes in R2, metadata in D1).

## Endpoints

Privileged endpoints require a bearer **session** from `POST /api/auth/login`
(task 4 — no more shared secret); issuing/revoking sign-off links additionally
require the **QA/QC** role. The public `/api/sign/*` endpoints stay open, guarded
by the single-use link token instead.

- `POST /api/auth/login` `{email, password}` — returns `{ token, expires_at, user }`.
  Send `Authorization: Bearer <token>` on privileged calls.
- `POST /api/auth/logout` *(auth)* · `GET /api/auth/me` *(auth)*.
- `POST /api/records` · `GET /api/records/:id` *(auth)* — record sync (LWW on `updated_at`).
- `POST /api/records/:id/attachments` *(auth)* — photo sync (§8). Upsert by client id
  (`{ id, field_id, caption, device_id, created_at, image }`); the image rides as a
  `data:` URL, is stored in R2 under `attachments/<record>/<id>`, and is only
  rewritten when the bytes change (a caption edit re-pushes the row, not the blob).
- `POST /api/records/:id/sign-requests` *(auth, QA/QC)* — issue a link + email it.
  Returns `{ id, token, url, expires_at, emailed }`; only the token **hash** is stored.
- `GET /api/sign/:token` *(public)* — open the link: returns the read-only record,
  the slot/role, and the recipient. Marks the request `opened`.
- `POST /api/sign/:token` *(public)* — submit a drawn PNG (`{ image, name?, company? }`).
  Stores the image in R2, writes a `remote_link` signature row, closes the request.
- `POST /api/sign/:token/reject` *(public)* — `{ reason }`; closes the request and
  flips the server record to `rejected` (§6).
- `POST /api/sign-requests/:id/revoke` *(auth, QA/QC)* — revoke an outstanding link.

Freeze is lazy: the record's `updated_at` is captured at issue and re-checked at
open/sign; any edit since issue voids the link with `409 version_mismatch`
(reissue needed). Links are single-use and expire after 7 days (lazy, at access).

## Local development

```bash
# 1. Apply the schema to a local (miniflare) D1
npm run db:migrate:local
#    or, directly:
node ./node_modules/wrangler/bin/wrangler.js d1 execute itp-itr --local \
  --file db/migrations/0001_init.sql --config api/wrangler.toml

# 2. Run the Worker locally on :8787
npm run api:dev
#    or: node ./node_modules/wrangler/bin/wrangler.js dev --config api/wrangler.toml

# 3. Seed a user (no open registration), then point the web app at the API.
node api/scripts/create-user.mjs jo@site.co "Jo Lee" qa_qc 's3cret' > /tmp/u.sql
node ./node_modules/wrangler/bin/wrangler.js d1 execute itp-itr --local \
  --config api/wrangler.toml --command "$(cat /tmp/u.sql)"
#    VITE_API_URL=http://127.0.0.1:8787 npm run dev   # then sign in as jo@site.co
```

Roles are `site_engineer` and `qa_qc` (§9). Passwords are PBKDF2-hashed; sessions
are bearer tokens (sha-256 hash stored, 30-day expiry).

For the remote sign-off link page, also set `SIGN_BASE_URL` on the Worker to the
**web** origin so issued links point at the page, not the API:

```bash
wrangler dev --config api/wrangler.toml --var SIGN_BASE_URL:http://127.0.0.1:5173
```

The account-less page lives at `<web-origin>/sign/:token`. It fetches the API at
`VITE_API_URL` (same-origin by default), shows the record read-only, and lets the
signer draw a signature or reject with a reason.

Health check: `GET /api/health` (public). Record upsert is idempotent and
last-write-wins on `updated_at`.

## Deploying to Cloudflare (yours to run)

Requires a Cloudflare account and `wrangler login`.

```bash
# Create the D1 database and copy its id into wrangler.toml (database_id)
wrangler d1 create itp-itr

# Create the R2 bucket for signature images
wrangler r2 bucket create itp-itr-signatures

# Apply migrations to the remote D1
wrangler d1 migrations apply itp-itr --config api/wrangler.toml

# Email delivery (task 3): set a Resend API key + a verified From address so the
# signing link is emailed to the recipient. Without these the Worker logs the
# link to the console instead of sending.
wrangler secret put RESEND_API_KEY --config api/wrangler.toml
#   then set EMAIL_FROM in wrangler.toml [vars] to a From on a verified domain

# Deploy
wrangler deploy --config api/wrangler.toml

# Seed the first user (no open registration), against the REMOTE D1
node api/scripts/create-user.mjs you@co "Your Name" qa_qc 'a-strong-password' > /tmp/u.sql
wrangler d1 execute itp-itr --remote --config api/wrangler.toml --command "$(cat /tmp/u.sql)"
```

Then set the web app's `VITE_API_URL` to the deployed Worker URL and sign in with
the seeded account. Auth is by email/password session — there is no shared secret.
Secrets are yours to manage — none are committed here.

> Note: `wrangler dev` needs the `workerd` binary from wrangler's postinstall. If
> your environment blocked install scripts, run `npm rebuild workerd` (or reinstall
> with scripts allowed) before `api:dev`.
