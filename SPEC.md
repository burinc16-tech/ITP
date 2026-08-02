# ITP / ITR Digital Checklist System — Specification

**Owner:** Burin, Kenyon Pte Ltd
**Status:** Draft v0.1
**Last updated:** 2026-07-30

---

## 1. Purpose

Replace paper and one-off HTML checklists used in Testing & Commissioning with a
single web application that:

- Stores each Inspection & Test Plan (ITP) and Inspection & Test Record (ITR) as a
  reusable **template definition**, not as hardcoded HTML.
- Lets site engineers fill records on a phone or tablet, including photos and
  handwritten signatures.
- Produces PDF output that is visually identical to the paper form the consultant
  and client already accept.
- Tracks completion status per project, system, and equipment tag.

### Non-goals (v1)

- Not a full QA/QC management suite.
- No integration with, or dependency on, any other application. This app stands alone.
- No client-facing external portal in v1. Consultants sign on site, on the
  engineer's device.

---

## 2. Core design principle

> **A checklist is data, not code.**

One generic renderer turns any template JSON into a fillable form. Adding a new ITP
means adding a JSON definition, never writing a new page.

Two rules that must not be broken:

1. **Templates are versioned and immutable once used.** Every record stores
   `template_version_id`. Editing a template creates a new version; existing records
   continue to render against the version they were signed under.
2. **Records snapshot their context.** Project name, equipment tag, drawing
   reference, and personnel names are copied into the record at time of signing.
   A later rename must never alter a signed document.

---

## 3. Technical stack

> **This is a standalone application.** Its own repository, own database, own
> deployment, no shared code or shared data with any other tool. Nothing in this
> spec may depend on another application being available.

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + TypeScript, built with Vite | Component reuse matters here — one renderer, many field types |
| PWA / offline | Vite PWA plugin, IndexedDB via Dexie | Site work without signal |
| Backend / API | Hono on Cloudflare Workers | Small REST API, no server to maintain |
| Database | Cloudflare D1 (SQLite) | Relational, fits the model in §4, no ops overhead |
| File / photo storage | Cloudflare R2 | Photos and signature PNGs; signed URLs for access |
| Auth | Email + password, server-side sessions | Named users are required for signature attribution |
| Transactional email | Any Workers-compatible provider (Phase 4) | Sends remote sign-off links (§6); no marketing use |
| PDF | Browser print with a dedicated A4 landscape stylesheet | Matches the paper form exactly (§7) |
| Hosting | Cloudflare Pages + Workers, dedicated domain | Reachable from site on mobile data |

**Hosting decided: cloud-hosted.** Records are reachable from site over mobile data,
which is what makes the offline sync in §8 worth building. An intranet-only variant
was considered and rejected.

Because records now leave the office network, three things are mandatory rather than
optional: TLS everywhere, photos and signature images served only through short-lived
signed URLs, and access scoped per project so a user sees only projects they are
assigned to (§9).

Repository layout:

```
/spec        SPEC.md, template JSON schema, sample templates
/web         React frontend
/api         Worker API
/db          Migrations and seed data
CLAUDE.md    Stack, conventions, and rules for Claude Code
```

---

## 4. Data model

```
Project
  id, code, name, client, status, created_at, closed_at (nullable)

System
  id, project_id, name, code, parent_system_id (nullable, for subsystems)

Equipment
  id, project_id, system_id, tag, description, location, drawing_ref

Location                    -- for records not tied to an equipment tag
  id, project_id, name, level, room_ref, drawing_ref

Template
  id, code, title, discipline, category (ITP | ITR), active

TemplateVersion
  id, template_id, rev, definition (JSON), status (draft|issued|superseded),
  issued_at, issued_by

Record                      -- one filled ITR
  id, project_id, system_id,
  scope_type (equipment | location), equipment_id, location_id,
  template_version_id, serial_no, status,
  values (JSON), context_snapshot (JSON),
  created_by, created_at, updated_at, completed_at

Attachment
  id, record_id, field_id, kind (photo|file), url, caption, uploaded_at

Signature
  id, record_id, role, name, company, signed_at, image_url,
  method (on_device | remote_link), signature_request_id (nullable),
  ip_or_device

SignatureRequest            -- remote sign-off, Phase 4
  id, record_id, role, recipient_name, recipient_email,
  token_hash, status (sent|opened|signed|rejected|expired|revoked),
  sent_at, opened_at, closed_at, expires_at, reject_reason,
  record_version_at_send

Instrument                  -- calibration register, Phase 5
  id, serial_no, description, cal_cert_url, cal_date, cal_due_date

RecordInstrument
  record_id, instrument_id

User
  id, name, email, company, role

AuditLog
  id, record_id, user_id, action, before, after, at
```

### Identifiers and numbering

All `id` fields are UUIDv7 generated on the client (§8), never database sequences.

`serial_no` is a display value, not a key. Format:
`{PROJECT_CODE}-{TEMPLATE_CODE}-{SEQ:04d}` — example `AMK3-HLT-0007`. Allocated by
the server per project + template at the `draft → completed` transition, never
reused. A draft with a null `serial_no` is valid.

### Retention

Signed records are the evidence that settles disputes years after handover, and §13
rules out exporting them anywhere else. Retention is therefore long by default and
deletion is never automatic for signed material.

| Data | Retention |
|---|---|
| `accepted` records, their attachments, signatures, and audit log | **5 years from `Project.closed_at`**, as a default. Configurable per project to match that contract's defects liability period. |
| `rejected` and superseded revisions | Same as accepted — they are part of the evidence chain and must not be pruned |
| Drafts never completed | Flagged for review after 12 months without activity; deleted only by explicit Project Admin action, logged |
| Sign-off request tokens (§6 path B) | Token expires in 7 days; the `SignatureRequest` row itself is retained with the record |

Rules:

- Nothing signed is ever deleted by a scheduled job. Past the retention date,
  records are listed for review and removed only by an explicit, logged admin action.
- **R2 lifecycle rules must not be set to auto-expire objects.** Photos are the bulk
  of stored volume and the easiest thing to lose to a default storage policy.
- Project close sets `closed_at` and starts the clock; reopening clears it.

---

## 5. Template definition schema

Stored in `TemplateVersion.definition`.

```jsonc
{
  "code": "HLT",
  "title": "Network Room Heat Load Test Acceptance Checklist",
  "rev": "A",
  "discipline": "Electrical",
  "page": { "size": "A4", "orientation": "landscape" },

  "header": {
    "fields": [
      { "id": "project",     "label": "Project",        "type": "text",  "source": "project.name", "readonly": true },
      { "id": "location",    "label": "Location / Room","type": "text",  "required": true },
      { "id": "equip_tag",   "label": "Equipment Tag",  "type": "text",  "source": "equipment.tag" },
      { "id": "drawing_ref", "label": "Drawing Ref",    "type": "text" },
      { "id": "test_date",   "label": "Date of Test",   "type": "date",  "required": true }
    ]
  },

  "sections": [
    {
      "id": "pre_test",
      "title": "1. Pre-Test Verification",
      "rows": [
        {
          "id": "pre_01",
          "no": "1.1",
          "description": "All equipment installed as per approved shop drawing",
          "type": "pass_fail_na",
          "remarks": true
        },
        {
          "id": "pre_02",
          "no": "1.2",
          "description": "Ambient temperature before test",
          "type": "number",
          "unit": "°C",
          "limit": { "min": 18, "max": 27 },
          "remarks": true
        }
      ]
    },
    {
      "id": "load_readings",
      "title": "2. Load Bank Readings",
      "type": "dynamic_table",
      "min_rows": 1,
      "auto_number": true,
      "columns": [
        { "id": "time",     "label": "Time",            "type": "time" },
        { "id": "kw",       "label": "Load Applied",    "type": "number", "unit": "kW" },
        { "id": "supply_t", "label": "Supply Air Temp", "type": "number", "unit": "°C",
          "limit": { "max": 24 } },
        { "id": "return_t", "label": "Return Air Temp", "type": "number", "unit": "°C" },
        { "id": "rh",       "label": "Relative Humidity","type": "number","unit": "%",
          "limit": { "min": 40, "max": 60 } },
        { "id": "remark",   "label": "Remarks",         "type": "text" }
      ]
    },
    {
      "id": "photos",
      "title": "3. Photographic Record",
      "rows": [
        { "id": "ph_01", "description": "Load bank setup",       "type": "photo" },
        { "id": "ph_02", "description": "Instrument display",    "type": "photo" },
        { "id": "ph_03", "description": "Panel / meter reading", "type": "photo" }
      ]
    }
  ],

  "instruments": { "required": true, "min": 1 },

  "footer": {
    "signatures": [
      { "id": "sig_contractor", "role": "Tested By",   "company_default": "Kenyon Pte Ltd", "required": true },
      { "id": "sig_qaqc",       "role": "Checked By",  "company_default": "Kenyon Pte Ltd", "required": true },
      { "id": "sig_consultant", "role": "Witnessed By","required": false },
      { "id": "sig_client",     "role": "Accepted By", "required": false }
    ]
  }
}
```

### 5.1 Template variables

The source form hardcodes project-specific values into step text — equipment tags
like `CHW-FCU-A-NR-401`, the 6 kW load, the 23°C set point. A template that hardcodes
these is single-use. So a template declares `variables`, set once per record in the
header, and step text interpolates them with `{{var}}`:

```jsonc
"variables": [
  { "id": "fcu_chw",  "label": "CHW FCU tag",   "type": "text",   "default": "CHW-FCU-A-NR-401" },
  { "id": "setpoint", "label": "Room set point","type": "number", "unit": "°C", "default": 23 }
]
```

Interpolation happens at render time and the resolved text is written into
`context_snapshot` when the record reaches `completed`, so the signed PDF shows
literal values and does not depend on the template being re-read later.

**Descriptions are not editable per record.** The source HTML makes every step
`contenteditable`, which is convenient on paper and fatal for evidence: two records
of the same test could carry different wording with nothing recording the change.
Wording changes go through a new template version (§2). Variables cover the cases
that actually vary.

### Supported field types

| Type | Behaviour |
|---|---|
| `text` | Free text, single line |
| `textarea` | Multi-line |
| `number` | Numeric; if `limit` present, auto-evaluates Pass / Fail |
| `pass_fail_na` | Three-state control; N/A requires a remark. Optional `labels` overrides the displayed words (the heat load test form uses Yes / No / N.A.) |
| `checkbox` | Boolean |
| `dropdown` | `options[]` |
| `date`, `time` | Native pickers |
| `photo` | Camera capture or gallery; multiple per field |
| `duration` | Elapsed time entered as free text (`5min 23s`) or structured mm:ss; used where a step measures how long something took, not a measured quantity |
| `calculated` | `formula` referencing other field ids, read-only |
| `dynamic_table` | Add/delete rows, auto-renumber, per-column types as above |
| `signature` | Canvas pad, stored as PNG |

> **The real Phase 1 template is `heat-load-test.json`**, converted from the existing
> `Heat_Load_Test_Report.html`. The JSON above is an abbreviated illustration of the
> schema; the converted file is the authoritative one and lives in `/spec/templates/`.
> Two blocks in it are marked `_status` / `_note` and must be confirmed before Rev A
> is issued (§5.1).

---

## 6. Record status workflow

```
draft ──► completed ──► submitted_for_witness ──► witnessed ──► accepted
  ▲                              │                    │
  └──────────── rejected ◄───────┴────────────────────┘
```

| Status | Meaning | Who can set |
|---|---|---|
| `draft` | Being filled, editable | Site engineer |
| `completed` | All required fields filled, contractor signed | Site engineer |
| `submitted_for_witness` | Notice issued, awaiting witness | QA/QC |
| `witnessed` | Consultant signed on device | QA/QC (with consultant present) |
| `accepted` | Client signed, record locked | QA/QC |
| `rejected` | Returned with reason; reopens as editable copy at next rev | Consultant / QA/QC |

**Locking:** once `accepted`, the record is read-only forever. Corrections create a
new record at the next revision, cross-referenced to the superseded one.

### Two signing paths — both supported

A witness or client signature can be captured either way, on the same record. The
choice is made per signature request, not configured globally, because site
conditions vary: a consultant standing next to you signs on the spot, a consultant
in the office signs from their desk.

**A — On device (Phase 3).** The signer takes the engineer's tablet, selects their
role, types name and company, draws on the canvas, confirms. No account, no email,
no connectivity required. Evidence recorded: name, company, timestamp, device id,
and the user account that handed over the device.

**B — Remote link (Phase 4).** QA/QC issues a sign-off request to the signer's email
address. They receive a single-use link, open a read-only rendering of the exact
record, and either sign on their own device or reject with a reason. No account
needed. Evidence recorded: email address, timestamp, IP, plus the request trail.

Rules that apply to path B:

- Token is opaque and random, stored only as a hash, scoped to one record and one
  signature slot, single-use, expiring after 7 days by default. Revocable at any
  time by QA/QC.
- **The record is frozen while a request is outstanding.** `record_version_at_send`
  is captured on issue; if the record is edited, outstanding requests are voided
  and must be reissued. A signer must never sign a version that later changed.
- The link page is read-only. It exposes one record — never a project, a register,
  or any navigation.
- Every transition (issued, opened, signed, rejected, expired, revoked) is written
  to `AuditLog`.
- Rejection carries a reason and returns the record to `rejected` (§6 table).

Both paths write to the same `Signature` row shape and render identically in the
PDF, distinguished only by a small method annotation beneath the signature block.

**Outstanding items:** any row evaluating to Fail is derived — not stored separately —
into an outstanding-items list per project, carrying the row description, photos,
equipment tag, and ITR serial number. An item clears when a later revision of the
same ITR records that row as Pass. This list is internal to this app; there is no
export to any other system.

---

## 7. PDF output

Non-negotiable requirement: **output must be visually indistinguishable from the
existing paper form.** Consultants reject unfamiliar layouts.

- Rendered as HTML with a dedicated print stylesheet, A4 landscape, then printed to
  PDF. No PDF drawing library.
- All interactive controls hidden in print; values render as plain text.
- Kenyon logo embedded base64 in the header.
- Footer on every page: serial number, template code + rev, page X of Y, status.
- Watermark `DRAFT` diagonally across any record not yet `accepted`.
- Signatures render as the captured image plus printed name, company, and timestamp.
- Batch export: select many records by filter, produce one merged PDF for a
  turnover package.

---

## 8. Offline behaviour

Plant rooms and network rooms frequently have no signal.

**Decision: build the offline-capable *architecture* in Phase 1; build the offline
*machinery* in Phase 5.**

The expensive thing to retrofit is not the service worker — it is the shape of the
data flow. If Phase 1 writes straight to the API on every keystroke and lets the
server assign identifiers, then adding offline later means rewriting every save
path, every ID, and every conflict case. So Phase 1 adopts these constraints even
though it will always be online:

- **Client-generated identifiers.** Records, attachments, and signatures get a
  UUIDv7 created on the device, not a server sequence. Serial numbers (§4) are
  display values assigned by the server at the `completed` transition, not primary
  keys — a draft with no serial is valid.
- **Local-first writes.** The form writes to IndexedDB (Dexie), and a thin sync
  layer pushes to the API. In Phase 1 that layer is a pass-through with no queue.
  The form never calls the API directly.
- **Idempotent upserts.** Every mutation is an upsert keyed by client id and
  carrying `updated_at`, so replaying it later is safe.
- **Photos as local blobs first.** Captured to IndexedDB, then uploaded, with the
  record referencing the attachment id rather than a URL.

Phase 5 then adds only the machinery, with no rework of the form layer:

- Service worker precaching the app shell; templates and the active project's
  equipment list cached locally.
- Sync queue with retry and backoff, oldest first.
- Conflict rule: last-write-wins on `draft`; a record already `accepted` on the
  server rejects any offline change and surfaces a warning.
- Clear on-screen indicator of pending unsynced records, with a count.

Rationale: full offline in Phase 1 would delay proving the core loop — render, save,
print — behind a large amount of sync surface. Ignoring it entirely would mean
rebuilding that loop later. This splits the cost so the irreversible decisions are
made early and the elaborate work is deferred.

---

## 9. Roles and permissions

| Role | Can do |
|---|---|
| Site Engineer | Create and fill records on assigned projects; sign as Tested By |
| QA/QC | All of the above, plus submit for witness, accept, reject, manage equipment |
| Project Admin | Manage projects, systems, equipment, template assignment, users |
| Template Admin | Create and issue template versions |
| Viewer | Read and export PDFs only |

Every status change and every field edit after `completed` is written to `AuditLog`.

---

## 10. Screens

1. **Project list** → project dashboard
2. **Project dashboard** — % ITRs complete by system, outstanding list, recent activity
3. **ITR register** — filterable table (system, equipment, template, status, date,
   engineer), bulk PDF export
4. **Record form** — the generic renderer; sticky section nav, autosave, offline badge
5. **Signature capture** — full-screen canvas, role selector, name and company
6. **Remote sign-off page** (Phase 4) — tokenised, no login, read-only record plus
   sign or reject; the only screen reachable without an account
7. **Template library** — list, versions, JSON editor with schema validation, preview
8. **Equipment register** — tags per system, with per-tag ITR completion state
9. **Calibration register** (Phase 5) — instruments, cert expiry, expired-use warnings

---

## 11. Delivery phases

| Phase | Scope | Done when |
|---|---|---|
| **1** | One template (heat load test) as JSON, generic renderer, local-first save via IndexedDB, PDF print | A completed heat load test record prints identically to the existing accepted form, and all writes go through the sync layer (§8) |
| **2** | Template library, JSON editor, versioning, serial numbering, the three templates in §12 | All three templates filled on a live project by engineers other than the author |
| **3** | On-device signatures (§6 path A), roles, status workflow, audit log, record locking | A record can be signed by contractor, QA/QC, and consultant on one device and locked |
| **4** | Register, dashboards, filters, batch PDF export, equipment and system tree, remote sign-off links (§6 path B) | A turnover package exports as a single PDF, and a consultant signs from their own device without an account |
| **5** | Offline PWA sync, calibration register, outstanding-items list | Records fill offline in a network room and sync afterwards |

Each phase ends with real use on a live project before the next begins.

---

## 12. Decisions

No open decisions remain. Each entry below is settled; reopen one only with a note
explaining what changed.

| Decision | Outcome |
|---|---|
| Relationship to other in-house tools | Standalone. Own repo, own database, own deployment (§3) |
| Hosting | Cloud-hosted, reachable from site over mobile data (§3) |
| Offline | Offline-capable architecture in Phase 1, offline machinery in Phase 5 (§8) |
| Consultant sign-off | Both paths supported — on device and remote link (§6) |
| Retention | 5 years from project close by default, per-project configurable (§4) |
| First three templates | DB Power Turn-on; Network Room / IT Room Handover; Wall, Floor and Ceiling Closure Inspection |
| Ad-hoc checklist rows | Allowed as a scoped exception to Hard Rule #5, on sections flagged `allow_add_rows`. The engineer's added text is stored as record data in `Record.values`/`context_snapshot`, never written into `TemplateVersion.definition` — so template wording stays immutable and versioned (§2, §5.1). Added rows are subject to the same audit log as any post-`completed` edit (§9) |
| "In Progress" status | A status row set to In Progress counts as outstanding — it maps to Fail for outstanding-items derivation (§6). The item clears only when a later revision records that row as Pass/Yes. Required because the IDF Handover template uses a four-state control (Yes / No / N/A / In Progress) |

### Why these three templates

| Template | What it proves |
|---|---|
| **DB Power Turn-on** | Highest volume form on the project, and almost entirely numeric with limits — proves auto pass/fail evaluation and the everyday filling workflow |
| **Network Room / IT Room Handover** | Broad multi-discipline checklist with heavy photo evidence and four signature roles — proves multi-section rendering and both signing paths (§6) |
| **Wall, Floor and Ceiling Closure Inspection** | Location-based rather than equipment-based, with per-row before/after photos — proves dynamic tables, photo-per-row, and `scope_type = location` (§4) |

Between them these cover numeric limits, multi-section forms, multi-party signing,
dynamic tables, and photo handling. **Known gap:** none has a very large row count,
so renderer and print performance at several hundred rows stays unproven. Test that
with a synthetic template before committing to a point-to-point style ITR later.

### Why ad-hoc rows do not break template immutability

Rule #5 (§5.1) forbids per-record wording changes because two records of the same
test carrying different *step text*, with nothing recording the change, is fatal for
evidence. An engineer-added row is different in kind: it is not an edit to a defined
step, it is a filled-in value — the same category as a number or a remark. It lives in
`Record.values`, is snapshotted into `context_snapshot` at `completed`, and is logged
like any other entry. The template's own steps remain fixed and versioned. The Wall,
Floor and Ceiling Closure form (added rows + a free-text defects list) is what forces
this; the exception is deliberately narrow — only sections that opt in with
`allow_add_rows`, and only for appended rows, never for editing a template-defined step.

---

## 13. Out of scope for v1

- Integration with any external or in-house system, including shared login,
  shared database, or pushing records to another tool
- Persistent client portal with accounts (single-use sign-off links in §6 are in scope)
- Automated instrument data import (data logger CSV ingestion)
- Multi-language forms
- Digital certificate / PKI signing (canvas signature plus audit log only)
- Native mobile apps
