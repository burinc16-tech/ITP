# Deploying the ITP/ITR app to Cloudflare

Live at **https://itp.full-defects.com**. Two separate Workers:

| | Worker | Config | What it is |
|---|---|---|---|
| API | `itp-itr-api` | `api/wrangler.toml` | Hono API on **D1** (SQLite) + **R2** (signature/photo images) |
| Frontend | `itp-itr-web` | `wrangler.web.toml` | assets-only Worker publishing the built `dist/` |

They are deliberately **separate**: merging them would mean every frontend
deploy also ships API code. The frontend calls the API cross-origin at its
`workers.dev` URL, baked in at build time as `VITE_API_URL`.

> **Deploy is an account-owner task.** These commands act on a real Cloudflare account and cost/store real
> data. Run them yourself; `wrangler login` and `wrangler secret put` are interactive.

---

## Routine: shipping a frontend change

This is the common case — everything below it is first-time setup.

```bash
node ./node_modules/vite/bin/vite.js build
node ./node_modules/wrangler/bin/wrangler.js deploy --config wrangler.web.toml
```

⚠️ **Both steps, every time.** Until 4 Sep 2026 the site was served by
`vite preview` reading `dist/` straight off disk, so a build alone was enough.
It is not any more: the Worker holds its own copy of the files. Build without
deploying and the live site simply keeps serving the previous version, with no
error to tell you.

Shipping an API change is the same idea with the other config:

```bash
node ./node_modules/wrangler/bin/wrangler.js deploy --config api/wrangler.toml
```

## Prerequisites

- A Cloudflare account.
- Dependencies installed (`npm install`).
- Optional (for real signing-link emails): a [Resend](https://resend.com) account with a **verified sending
  domain**. Without it, the Worker logs links instead of emailing them.

> **Windows path note.** This working copy lives in a folder whose name contains ` & ` (`ITP & ITR`), which
> breaks npm/npx `.bin` shims on Windows. The commands below invoke the tool's JS entry through `node`
> (`node ./node_modules/<pkg>/bin/...`), which works regardless. On a clone at a path without special
> characters, the equivalent `npx wrangler …` / `npm run …` forms also work.

Run everything from the repo root.

---

## 0. Authenticate (interactive, one-time)

```bash
node ./node_modules/wrangler/bin/wrangler.js login
```

## 1. Provision the resources (one-time)

```bash
node ./node_modules/wrangler/bin/wrangler.js d1 create itp-itr
```

Copy the printed `database_id` into `api/wrangler.toml`, replacing `"local-placeholder"`. (This id is **not
secret** — safe to commit so the config isn't only on one machine.)

```bash
node ./node_modules/wrangler/bin/wrangler.js r2 bucket create itp-itr-signatures
```

## 2. Apply migrations to the remote D1

The `--remote` flag is what targets production (vs. the local miniflare DB).

```bash
node ./node_modules/wrangler/bin/wrangler.js d1 migrations apply itp-itr --remote --config api/wrangler.toml
```

This applies `db/migrations/0001`–`0004` (records, sign-off, auth, **attachments**). Don't skip — 0004 is
easy to forget.

## 3. Deploy the API Worker

```bash
node ./node_modules/wrangler/bin/wrangler.js deploy --config api/wrangler.toml
```

Note the printed URL, e.g. `https://itp-itr-api.<your-subdomain>.workers.dev` — the frontend build bakes this
in as `VITE_API_URL`, so the API has to exist before step 4.

The frontend Worker needs no provisioning of its own: it has no bindings, only static assets.

## 4. Build + deploy the frontend, pointed at the Worker

`vite.config.ts` already defaults `VITE_API_URL` to the deployed Worker, so a plain build is normally right.
Override it only when pointing at a different API:

```bash
node ./node_modules/vite/bin/vite.js build
```

(to override — PowerShell: `$env:VITE_API_URL = "https://…workers.dev"; node ./node_modules/vite/bin/vite.js build`)

`VITE_API_URL` is **baked in at build time**, so any later change to the Worker URL means rebuild + redeploy.

Then publish `dist/` as the `itp-itr-web` Worker:

```bash
node ./node_modules/wrangler/bin/wrangler.js deploy --config wrangler.web.toml
```

`wrangler.web.toml` attaches it to `itp.full-defects.com/*` as a **route**, not a custom domain. That matters:
the DNS record for that hostname still points at the old cloudflared tunnel, and the route intercepts at the
edge before the origin is reached. Nothing about DNS changes, so there is no outage window when deploying —
and the tunnel entry remains as a rollback. To fall back to the tunnel, delete the route line and redeploy.

The Worker also sets `not_found_handling = "single-page-application"`, without which `/sign/<token>` deep
links would 404.

## 5. Check `SIGN_BASE_URL` (usually nothing to do)

The public `/sign/<token>` page is served by the frontend, so remote sign-off links must point there — not at
the API Worker. Without `SIGN_BASE_URL`, links fall back to the Worker origin (wrong host).

`api/wrangler.toml` already has the right value, and it does not change between deploys:

```toml
[vars]
SIGN_BASE_URL = "https://itp.full-defects.com"
EMAIL_FROM = "Kenyon T&C <no-reply@your-verified-domain>"
```

Only redeploy the API Worker if you actually change one of these:

```bash
node ./node_modules/wrangler/bin/wrangler.js deploy --config api/wrangler.toml
```

## 6. Set the email secret (for real signing-link emails)

```bash
node ./node_modules/wrangler/bin/wrangler.js secret put RESEND_API_KEY --config api/wrangler.toml
```

Paste your Resend API key when prompted. Real send needs **both** `RESEND_API_KEY` (this) and `EMAIL_FROM`
(step 5, a verified-domain address). Without both, the Worker logs links instead (see `wrangler tail`).

## 7. Seed a production user

There is no open registration — accounts are seeded out-of-band. `--remote` targets production. Role is
`qa_qc` or `site_engineer`.

PowerShell:

```bash
$sql = node api/scripts/create-user.mjs you@site.co "Your Name" qa_qc "strong-password"; node ./node_modules/wrangler/bin/wrangler.js d1 execute itp-itr --remote --config api/wrangler.toml --command "$sql"
```

## 8. Verify

```bash
node ./node_modules/wrangler/bin/wrangler.js tail --config api/wrangler.toml
```

Open **https://itp.full-defects.com**, log in, complete a record (a serial number gets assigned server-side at
`draft → completed`), issue a sign-off link, and open it.

To confirm a frontend deploy actually landed — the site looks identical either way, so check the served
bundle name against the local build:

```bash
curl -s https://itp.full-defects.com/ | grep assets/index-
```

It should match the `<script src>` in `dist/index.html`. If it does not, the build was not deployed.

---

## Notes

- **Do NOT set an R2 lifecycle auto-expire rule** on `itp-itr-signatures`. SPEC §4 is explicit: photos are the
  bulk of stored volume and the easiest evidence to lose to a default expiry policy. Retention is long by design.
- Secrets (`RESEND_API_KEY`) go through `wrangler secret`, never into `wrangler.toml`. The D1 `database_id` is
  not secret and can be committed.
- CORS is open (Hono `cors()`), so the cross-origin frontend → API calls work. If you later restrict it,
  allow `https://itp.full-defects.com`.
- The frontend is on a custom hostname; the API is still on `workers.dev`. If you ever put the API on a
  custom domain too, set `VITE_API_URL` (build) to it and rebuild + redeploy the frontend.
- **Backups:** `C:\CloudflareBackup\RUN-BACKUP.cmd` exports D1 *and* pulls the R2 objects into OneDrive.
  `wrangler d1 export` alone is only half a backup — R2 has no versioning, so a deleted signature or photo
  is gone, and a database-only restore would leave records pointing at images that no longer exist.
- **Time Travel** gives D1 point-in-time recovery for roughly the last 30 days, automatically. It does not
  cover R2.

## Local development

For running the full stack locally (miniflare emulates D1 + R2, no Cloudflare account needed), see
`api/README.md`. In short: `d1 migrations apply … --local`, seed a user, `wrangler dev --config
api/wrangler.toml` in one terminal, and `VITE_API_URL=http://localhost:8787` + `vite` in another.
