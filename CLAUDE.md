# CLAUDE.md

Working instructions for Claude Code on this repository.

## What this is

A standalone web app for Testing & Commissioning ITP/ITR checklists at Kenyon Pte Ltd.
Site engineers fill inspection and test records on phones and tablets; the app prints
PDFs that must look identical to the paper forms consultants already accept.

**`SPEC.md` is authoritative.** Read it before starting any task. The decisions in §12
are settled — do not relitigate them, propose alternatives to them, or quietly work
around them. If a decision genuinely blocks the work, stop and say so rather than
choosing differently.

## Stack

- React 18 + TypeScript, built with Vite
- Dexie (IndexedDB) for local-first storage
- Hono on Cloudflare Workers for the API
- Cloudflare D1 (SQLite) for the database
- Cloudflare R2 for photos and signature images (not used until Phase 2)
- Print output via browser print CSS — **no PDF library**

## Layout

```
/spec        SPEC.md, template JSON schema, converted templates
/web         React frontend
/api         Worker API
/db          Migrations and seed data
```

## Current phase

**Phase 5 — in progress.** Phases 1–4 are complete: the generic JSON renderer,
local-first save and print; template library, versioning, serial numbers;
on-device signatures, roles, status workflow, audit log, record locking; register,
dashboards, batch export, equipment tree, and remote sign-off links.

The offline-capable **foundation** is done and hardened (SPEC §8, §12): all ids are
UUIDv7; signatures and audit entries sync and are insert-once with an
evidence-conflict tripwire; `accepted`/`rejected` records can't be clobbered by
client last-write-wins, and the client warns and reconciles on a refused push;
remote sign-off writes are idempotent under a concurrent double-submit.

The offline **machinery** is now built and under test: the durable sync queue
(`data/outbox.ts`, `data/sync-queue.ts` — retry/backoff, oldest-first, coalescing)
with an app-level heartbeat that retries entries whose backoff has elapsed
(`app.tsx`) and a pending-unsynced indicator (`components/sync-status.tsx`);
service-worker/PWA precaching (`pwa.test.ts`, `sw.behavior.test.ts`); the
calibration register (`components/calibration-register.tsx`); and the
outstanding-items list (`components/outstanding-list.tsx`, `lib/outstanding.ts`).
All three §12 templates plus the heat load test are converted (`/spec/templates`).

What remains before Phase 5 closes (§11 — each phase ends with real use on a live
project): (1) settle the three ⛔ Rev A decisions for `heat-load-test.json` against
the paper form (see `spec/templates/heat-load-test.rev-a-checklist.md` — JSON edits
only, no code); (2) validate offline fill → sync on a live job.

## Hard rules

These are invariants. Breaking one is a defect even if tests pass.

1. **The form never calls the API directly.** All writes go to Dexie, and a sync
   layer pushes to the API. In Phase 1 that layer is a pass-through with no queue,
   but the boundary must exist (SPEC.md §8).
2. **Identifiers are UUIDv7 generated on the client.** Never database sequences.
   `serial_no` is a display value assigned server-side at `draft → completed`; a
   draft with a null serial is valid (§4).
3. **Every mutation is an idempotent upsert** keyed by client id and carrying
   `updated_at`.
4. **Template definitions are data.** Never write a component that hardcodes a
   specific form's rows, sections, or labels. One renderer, driven by JSON.
5. **Step descriptions are not editable per record.** Wording changes go through a
   new template version. Project-specific values use `{{variables}}` (§5.1).
6. **Nothing signed is ever mutated or deleted.** Not applicable until Phase 3, but
   do not design anything that would make it hard.

## Conventions

- TypeScript strict mode. No `any` outside third-party shims.
- Template JSON is validated with Zod at load time; the parsed type is the single
  source of truth for field types. Add new field types in one place.
- Store all timestamps as UTC ISO strings. Display in `Asia/Singapore`.
- Display dates as `dd/mm/yyyy` — this matches the existing forms.
- Units are part of the field definition, never hardcoded in a component.
- File names kebab-case. React components PascalCase. One component per file.
- Keep functions small enough to read without scrolling.

## Print output

- A4, landscape for the heat load test template (matches the source form and
  SPEC §7); orientation comes from the template `page` block, never hardcoded.
- Use millimetres for print dimensions, matching the source HTML.
- All interactive controls hidden in print; values render as plain text.
- Kenyon logo embedded base64 in the page header, repeated on every page.
- Page footer on every page: serial number, template code and rev, page X of Y, status.
- `DRAFT` watermark on any record not yet `accepted`.
- **Verification method:** print the original `Heat_Load_Test_Report.html` to PDF and
  the app's output to PDF, and compare page by page. Matching the original wins over
  any improvement you might prefer.

## Screen UI

The print layout replicates paper. The on-screen UI does not — it is a working tool
for someone standing in a plant room.

- Large touch targets; assume gloved hands and a tablet held one-handed.
- High contrast; readable in a bright room and a dark one.
- Buttons say what happens: "Save record", not "Submit". Keep the same verb through
  the whole flow.
- Errors state what went wrong and what to do about it.
- Keyboard focus visible; respect reduced-motion. No decorative animation.

## Testing

- Unit tests for the template validator, field-type evaluation (including
  pass/fail against limits), and `{{variable}}` interpolation.
- One end-to-end test covering fill → save → reload → print view.
- Test the interpolation and snapshot logic hardest. Those are where a bug produces
  a wrong signed document rather than a visible error.

## How to work

- One task at a time. Say what you are about to do, do it, then stop.
- Prefer changing existing files over adding new ones.
- When a decision comes up that SPEC.md does not cover, ask rather than assume, and
  add the answer to SPEC.md §12.
- Do not add dependencies without saying why a standard library approach will not do.
