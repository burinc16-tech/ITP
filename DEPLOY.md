# Deploying the ITP/ITR app to Cloudflare

This deploys two things:

- the **Worker API** (`/api`) → Cloudflare Workers, backed by **D1** (SQLite) and **R2** (signature/photo images);
- the **React frontend** (`/web`) → Cloudflare **Pages**.

It is a **two-pass** deploy: the Worker and Pages each need the other's URL, so the order is
Worker → Pages → reconfigure and redeploy the Worker.

> **Deploy is an account-owner task.** These commands act on a real Cloudflare account and cost/store real
> data. Run them yourself; `wrangler login` and `wrangler secret put` are interactive.

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

## 3. Deploy the Worker (first pass)

```bash
node ./node_modules/wrangler/bin/wrangler.js deploy --config api/wrangler.toml
```

Note the printed URL, e.g. `https://itp-itr-api.<your-subdomain>.workers.dev`.

## 4. Build + deploy the frontend to Pages, pointed at the Worker

`VITE_API_URL` is **baked in at build time** — any later change to the Worker URL means rebuild + redeploy
Pages.

PowerShell:

```bash
$env:VITE_API_URL = "https://itp-itr-api.<your-subdomain>.workers.dev"; node ./node_modules/vite/bin/vite.js build
```

(bash equivalent: `VITE_API_URL="https://…workers.dev" node ./node_modules/vite/bin/vite.js build`)

```bash
node ./node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name itp-itr
```

First run creates the Pages project. Note the Pages URL, e.g. `https://itp-itr.pages.dev`.

## 5. Reconfigure the Worker for the web app, then redeploy (second pass)

The public `/sign/<token>` page is served by **Pages**, so remote sign-off links must point there — not at the
Worker. Without `SIGN_BASE_URL`, links fall back to the Worker origin (wrong host).

In `api/wrangler.toml`, under `[vars]`, add the Pages URL and your From address:

```toml
[vars]
SIGN_BASE_URL = "https://itp-itr.pages.dev"
EMAIL_FROM = "Kenyon T&C <no-reply@your-verified-domain>"
```

Then redeploy the Worker:

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

Open the Pages URL, log in, complete a record (a serial number gets assigned server-side at
`draft → completed`), issue a sign-off link, and open it.

---

## Notes

- **Do NOT set an R2 lifecycle auto-expire rule** on `itp-itr-signatures`. SPEC §4 is explicit: photos are the
  bulk of stored volume and the easiest evidence to lose to a default expiry policy. Retention is long by design.
- Secrets (`RESEND_API_KEY`) go through `wrangler secret`, never into `wrangler.toml`. The D1 `database_id` is
  not secret and can be committed.
- CORS is open (Hono `cors()`), so the cross-origin Pages → Worker calls work. If you later restrict it, allow
  the Pages origin.
- Custom domains: you can attach one to both Pages and the Worker. If you do, set `VITE_API_URL` (build) and
  `SIGN_BASE_URL` (Worker var) to the custom domains and redeploy both.

## Local development

For running the full stack locally (miniflare emulates D1 + R2, no Cloudflare account needed), see
`api/README.md`. In short: `d1 migrations apply … --local`, seed a user, `wrangler dev --config
api/wrangler.toml` in one terminal, and `VITE_API_URL=http://localhost:8787` + `vite` in another.
