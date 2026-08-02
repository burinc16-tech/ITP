# Heat Load Test template — confirm before Rev A

Open questions on `heat-load-test.json` that must be settled before the template is
issued as **Rev A**. Each traces to a `_status` / `_note` marker in the JSON or to a
place where the conversion departs from the source paper form.

- **Template:** `spec/templates/heat-load-test.json` (code `HLT`, currently Rev `A` draft)
- **Source of truth:** `…\AMK 2 and 3 - Intranet\reference\Heat_Load_Test_Report.html`
  (the accepted paper form; "matching the original wins")

The three ⛔ items carry explicit markers in the JSON and block issuance. The ⚠️ items
are lower-priority confirmations. The ✅ items were decided this build and are recorded
here for the trail.

---

## ⛔ 1. Section 4 — Temperature & Humidity Record Sheet is reconstructed

`sec_4` was **invented during conversion** — it does not exist in the source HTML.

- **Source:** no Section 4. The source's own numbering skips it — sections run
  1, 2, 3, then **5 SIGN-OFF** — and Heat-Load-Test steps **3.4** and **3.9** both say
  "record the temperature", implying a sheet to record it in (`cross_ref: "sec_4"`).
- **Template now:** a `dynamic_table` with columns **Time / Recorder ID / Temperature
  (≤ 26 °C) / Relative Humidity (%) / Remarks**, `min_rows: 12`. All guessed.
- **JSON marker:** `sec_4._status` — *"RECONSTRUCTED … Confirm the real layout before
  issuing Rev A."*

**Decide:**
- [ ] Does a Section 4 recording sheet exist on the real/paper form?
- [ ] If yes: its actual columns, row count, and any limits (is 26 °C the temperature
      pass limit?).
- [ ] If no: remove `sec_4` and repoint the `cross_ref` in steps 3.4 / 3.9.

---

## ⛔ 2. Right-hand signature role

- **Source:** the sign-off has two columns, **both titled "Inspection / Tested by"**
  (left company locked to *Kenyon Pte Ltd*; right company is a free input).
- **Template now:** left = *Inspection / Tested by* (Kenyon, locked); right =
  **"Witnessed by"** (company unlocked).
- **JSON marker:** `footer.signatures[1]._note` — *"source form titled both columns
  'Inspection / Tested by' — confirm the right-hand signer's role"*.

**Decide:**
- [ ] Is the second signer **Witnessed by** (consultant), a second **Tested by**, or
      something else (e.g. *Checked by* / *Accepted by*)?
- [ ] Confirm the right-hand **company** stays free-text (not locked to Kenyon).

---

## ⛔ 3. "Cal. Cert No." column in Testing Equipment

- **Source:** Section 1 has an **unlabelled 30 mm column** between *QTY* and *Remarks*.
- **Template now:** labelled **"Cal. Cert No."**, 30 mm (`sec_1` → `cal_cert`).
- **JSON marker:** `sec_1.columns.cal_cert._note` — *"column was unlabelled in the
  source form — confirm intent"*.

**Decide:**
- [ ] Is this column for calibration certificate numbers?
- [ ] Keep the label "Cal. Cert No.", use a different label, or leave it blank to match
      the source exactly?

---

## ⚠️ 4. Instrument-register link (design intent, not layout)

- `sec_1` carries `link_to_instrument_register: true`, and the template `instruments`
  block is `{ required: true, min: 1, source_section: "sec_1" }`.
- The instrument / calibration register itself is **Phase 5** (SPEC §4, §10).

**Decide:**
- [ ] Confirm the Testing Equipment table is intended to feed the calibration register
      later. If so this is fine as-is (no Rev A blocker); if not, drop the flag.

## ⚠️ 5. Step wording fidelity

The conversion **tidied grammar/typos** from the source (e.g. source "loads banks",
"Switch-off", "cut off" → cleaner wording; consistent °C). Project-specific values are
now `{{variables}}` rather than hardcoded.

**Decide:**
- [ ] For evidence fidelity, is tidied wording acceptable, or must step text read
      **verbatim** to the accepted paper form? (Descriptions are not editable per record,
      so this locks in at Rev A — §5.1.)

---

## ✅ Decided during this build (recorded for the trail)

- **Orientation:** template originally said `portrait`; **corrected to `landscape`** to
  match the source form + SPEC §7 (you confirmed landscape). CLAUDE.md's print note was
  updated to match.
- **Column widths:** reconciled to the source's exact mm — standard sections
  `result 26 mm / remarks 55 mm`; `sec_1` remarks `55 mm`. (`num` col 10 mm, `Make/Model`
  38 mm, `QTY` 26 mm, `Cal. Cert` 30 mm already matched.)

---

### Note on the current app output

The renderer, save path, and print view are **data-driven from this JSON**, so they
already reflect items 1–3 as the template currently stands (Section 4 renders; the right
signer prints "Witnessed by"; the column prints "Cal. Cert No."). Settling the items
above is a **JSON edit only** — no code change — and the output updates automatically.
