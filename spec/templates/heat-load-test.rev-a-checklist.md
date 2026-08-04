# Heat Load Test template — Rev A decisions (SETTLED)

The three ⛔ blockers on `heat-load-test.json` have been resolved against the source
paper form (`…\AMK 2 and 3 - Intranet\reference\Heat_Load_Test_Report.html`), applying
the governing rule *"matching the original wins over any improvement you might prefer"*
(CLAUDE.md). The template is now clear of `_status` / `_note` markers and ready to issue
as **Rev A**.

- **Template:** `spec/templates/heat-load-test.json` (code `HLT`, Rev `A`)
- **Source of truth:** the accepted paper form above

---

## ✅ 1. Section 4 removed — it does not exist in the source

**Decision: removed.** The source form has no Section 4 — its numbering runs 1, 2, 3,
then **5 SIGN-OFF**. The invented `sec_4` (Temperature & Humidity Record Sheet) is
deleted, and the `cross_ref: "sec_4"` on steps 3.4 / 3.9 is removed. Temperature is
logged on the six **Humidity / Temp Data Recorders (HOBO MX)** listed in Section 1 and
noted in each step's own remarks; there is no separate record sheet on the paper form.

*Code impact (not "JSON-only"):* the removal cascaded to the print fixture and to tests
in `template.test.ts`, `values.test.ts`, `template-form.test.tsx`, `print-view.test.tsx`,
and `workflow.test.ts` (section counts, page counts, the reconstructed-status note, and
the numeric-limit demo — the last now covered by the numeric Power Turn-On template).

## ✅ 2. Right-hand signer — a second "Inspection / Tested by"

**Decision: match the source.** Both sign-off columns are titled **"Inspection /
Tested by"** on the paper form (left company locked to *Kenyon Pte Ltd*; right company
free-text). The right slot is now `sig_tested_2`, role "Inspection / Tested by",
`company_locked: false`, `required: false`, and **unstaged** — so it prints as a second
tester column without gating the §6 workflow (an unstaged slot is not counted by
`satisfiedStages`, and the witness/client stages go vacuous). The heat load test is not
a consultant-witnessed form; the §6 witness / remote sign-off feature serves templates
that do carry consultant sign-off (e.g. IDF Handover).

## ✅ 3. "Cal. Cert No." column — kept

**Decision: keep the label.** The 30 mm column between QTY and Remarks has an empty
header on the paper form. Labelling it **"Cal. Cert No."** only fills in a blank header
on an already-present column (not a layout change a consultant would reject), and
Section 1 (`link_to_instrument_register: true`) feeds the now-built calibration register,
so cert numbers are meaningful.

---

## ⚠️ Lower-priority confirmations (not Rev A blockers)

These were noted alongside the ⛔ items and remain optional confirmations:

- **Instrument-register link:** `sec_1` feeds the calibration register — confirmed fine
  as-is now that the register exists (Phase 5).
- **Step wording fidelity:** the conversion tidied source grammar/typos and moved
  project-specific values to `{{variables}}`. If step text must read *verbatim* to the
  accepted paper form, that is a further edit — descriptions lock at Rev A (§5.1).

## ✅ Decided during the original conversion (recorded for the trail)

- **Orientation:** corrected `portrait` → `landscape` to match the source + SPEC §7.
- **Column widths:** reconciled to the source mm — standard sections `result 26 mm /
  remarks 55 mm`; `sec_1` `num 10 mm / Make-Model 38 mm / QTY 26 mm / Cal. Cert 30 mm /
  remarks 55 mm`.
