import { z } from "zod";

/**
 * Zod schema for the ITP/ITR template definition format.
 *
 * A template is data, not code (SPEC.md §2). This schema is the single source of
 * truth for the shape of a template and, via `z.infer`, for its TypeScript types.
 * The renderer, the API, and the tests all derive from here — add a new field
 * type or property in ONE place: this file.
 *
 * It is validated at load time (CLAUDE.md conventions). Objects are `.strict()`
 * so a typo in a template file is a validation error, not a silently ignored key.
 * The two documented annotation keys that survive into the JSON — `_note` and
 * `_status`, used to flag blocks that must be confirmed before Rev A is issued
 * (SPEC.md §5) — are modelled explicitly wherever they legitimately appear.
 */

/** Cell / field level input types (SPEC.md §5 "Supported field types"). */
export const FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "tel",
  "number",
  "pass_fail_na",
  "status",
  "checkbox",
  "dropdown",
  "date",
  "time",
  "photo",
  "duration",
  "calculated",
  "signature",
] as const;

export const fieldTypeSchema = z.enum(FIELD_TYPES);

/** Numeric pass/fail bounds. At least one of min/max must be present. */
export const limitSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict()
  .refine((l) => l.min !== undefined || l.max !== undefined, {
    message: "limit must define at least one of `min` or `max`",
  });

/** Inline emphasis run within a step description (e.g. a red "6 kW"). */
export const emphasisSchema = z
  .object({
    text: z.string(),
    colour: z.string(),
  })
  .strict();

export const alignSchema = z.enum(["left", "center", "right"]);

/**
 * One selectable state of a `status` field (SPEC §5 "Supported field types",
 * §12 decisions). `outcome` maps the chosen state onto pass/fail evaluation so
 * the outstanding-items list (§6) is derivable: `fail` counts as outstanding —
 * the IDF Handover "In Progress" state maps here — while `na`/`neutral` do not.
 * Generalises `pass_fail_na` to any number of states without replacing it.
 */
export const statusStateSchema = z
  .object({
    value: z.string(),
    label: z.string(),
    outcome: z.enum(["pass", "fail", "na", "neutral"]),
  })
  .strict();

/**
 * A project-specific value set once per record and interpolated into step text
 * with `{{id}}` (SPEC.md §5.1). Only text and number vary in practice.
 */
export const variableSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    type: z.enum(["text", "number"]),
    unit: z.string().optional(),
    default: z.union([z.string(), z.number()]).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.default === undefined ||
      (v.type === "number"
        ? typeof v.default === "number"
        : typeof v.default === "string"),
    { message: "variable `default` must match its declared `type`" },
  );

/** A field in the record header (project, date, equipment tag, …). */
export const headerFieldSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    type: fieldTypeSchema,
    /** Context path this field is populated from, e.g. "project.name". */
    source: z.string().optional(),
    readonly: z.boolean().optional(),
    required: z.boolean().optional(),
    bold: z.boolean().optional(),
    /** Seed value, may contain `{{variable}}` interpolations. */
    default_from: z.string().optional(),
    default: z.union([z.string(), z.number()]).optional(),
    unit: z.string().optional(),
    options: z.array(z.string()).optional(),
  })
  .strict();

export const headerSchema = z
  .object({
    title: z.string().optional(),
    fields: z.array(headerFieldSchema).min(1),
  })
  .strict();

export const pageSchema = z
  .object({
    size: z.enum(["A4", "A3", "Letter"]),
    orientation: z.enum(["portrait", "landscape"]),
  })
  .strict();

/** A column in a `dynamic_table` section. */
export const columnDefSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    type: fieldTypeSchema,
    unit: z.string().optional(),
    width: z.string().optional(),
    align: alignSchema.optional(),
    limit: limitSchema.optional(),
    /** Selectable states when `type` is `status` (SPEC §12). */
    states: z.array(statusStateSchema).min(2).optional(),
    /**
     * Arithmetic over other column ids in the same row, for `type: "calculated"`
     * — e.g. `"balanced / design * 100"`. Read-only; see `lib/formula.ts`.
     */
    formula: z.string().optional(),
    /** Decimal places a computed value is rounded to for display (default 0). */
    decimals: z.number().int().nonnegative().optional(),
    /** Copy this cell down from the row above when a row is appended. */
    carry_down: z.boolean().optional(),
    _note: z.string().optional(),
  })
  .strict()
  .refine((c) => c.type !== "status" || (c.states?.length ?? 0) >= 2, {
    message: "a `status` column must define at least two `states`",
  })
  .refine((c) => c.type !== "calculated" || c.formula !== undefined, {
    message: "a `calculated` column must define a `formula`",
  });

/** Aggregate functions a totals cell may apply down a column. */
export const aggregateSchema = z.enum(["sum", "mean", "min", "max", "count"]);

/**
 * One cell of a group's totals row. Either an `aggregate` down a body column, or
 * a `formula` whose identifiers resolve to the *aggregated* value of each column
 * — so the same expression works per-row and on the total (the VAV percentage is
 * `balanced / design * 100` in both places).
 */
export const totalCellSchema = z
  .object({
    column: z.string(),
    aggregate: aggregateSchema.optional(),
    formula: z.string().optional(),
    unit: z.string().optional(),
    decimals: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((c) => (c.aggregate === undefined) !== (c.formula === undefined), {
    message: "a totals cell must define exactly one of `aggregate` or `formula`",
  });

/** The per-group totals row (e.g. the VAV form's `TOTAL` line). */
export const totalsSchema = z
  .object({
    label: z.string(),
    /** Aggregate applied to any column a cell does not name explicitly. */
    default_aggregate: aggregateSchema.optional(),
    cells: z.array(totalCellSchema).min(1),
  })
  .strict();

/**
 * Groups the rows of a `dynamic_table` under shared, row-spanning cells (SPEC
 * §12) — e.g. a VAV unit spanning its diffuser rows, then a totals line.
 *
 * Generic on purpose: the group carries its own typed `columns` and an optional
 * `totals` row, and nothing here names a specific form (Hard Rule #4). A section
 * without `row_group` renders exactly as before.
 */
export const rowGroupSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    /** Group-level fields, rendered once in cells spanning the group's rows. */
    columns: z.array(columnDefSchema).min(1),
    totals: totalsSchema.optional(),
    /** Number the groups 1..n in their own column (the VAV form's S/N). */
    auto_number: z.boolean().optional(),
    /** Groups present on a blank record. */
    min_groups: z.number().int().nonnegative().optional(),
    /** Body rows each new group starts with. */
    rows_per_new_group: z.number().int().positive().optional(),
    _note: z.string().optional(),
  })
  .strict();

/**
 * Metadata for a result/remarks column on a standard (row-based) section,
 * keyed by column name (e.g. `result`, `remarks`).
 */
export const columnMetaSchema = z
  .object({
    label: z.string(),
    width: z.string().optional(),
    type: fieldTypeSchema.optional(),
  })
  .strict();

/**
 * A single checklist step in a standard section.
 *
 * `remarks` is either a boolean (whether a remarks cell exists) or a field type
 * naming the input to render for it (the heat load test uses `"textarea"`).
 */
export const rowSchema = z
  .object({
    id: z.string(),
    no: z.string().optional(),
    type: fieldTypeSchema,
    description: z.string(),
    remarks: z.union([z.boolean(), fieldTypeSchema]).optional(),
    /** Displayed words for a three-state `pass_fail_na` control, e.g. ["Yes", "No", "N.A."]. */
    labels: z.array(z.string()).length(3).optional(),
    /** Selectable states when `type` is `status` (four-state, or a two-option Yes/No). */
    states: z.array(statusStateSchema).min(2).optional(),
    /** Category label; consecutive rows sharing a value render under one group heading. */
    group: z.string().optional(),
    /** Whether the row also carries photo attachments alongside its control (SPEC §12). */
    photo: z.boolean().optional(),
    emphasis: z.array(emphasisSchema).optional(),
    /** Id of another section this step's readings are recorded in. */
    cross_ref: z.string().optional(),
    unit: z.string().optional(),
    limit: limitSchema.optional(),
    options: z.array(z.string()).optional(),
    formula: z.string().optional(),
    _note: z.string().optional(),
  })
  .strict()
  .refine((r) => r.type !== "status" || (r.states?.length ?? 0) >= 2, {
    message: "a `status` row must define at least two `states`",
  });

/** A pre-populated row in a `dynamic_table`, keyed by column id. */
export const prefilledRowSchema = z.record(
  z.string(),
  z.union([z.string(), z.number()]),
);

/**
 * How a flat dynamic table mints and labels engineer-added columns. Every
 * repeating column shares one spec, because the columns it repeats are the same
 * measurement taken at another point.
 */
export const addColumnsSchema = z
  .object({
    /** Id stem for a new column; the ordinal is appended (`tp` → `tp8`). */
    id_prefix: z.string(),
    /** Printed heading stem; the column's POSITION is appended, not its id. */
    label_prefix: z.string(),
    type: fieldTypeSchema,
    unit: z.string().optional(),
    width: z.string().optional(),
    align: alignSchema.optional(),
    /** Floor for deletion — a table cannot be emptied of columns entirely. */
    min_count: z.number().int().positive().optional(),
    _note: z.string().optional(),
  })
  .strict();

/** A section whose body is an add/delete table of typed columns. */
export const dynamicTableSectionSchema = z
  .object({
    id: z.string(),
    no: z.string().optional(),
    title: z.string(),
    type: z.literal("dynamic_table"),
    page_break_before: z.boolean().optional(),
    min_rows: z.number().int().nonnegative().optional(),
    auto_number: z.boolean().optional(),
    /** Printed header of the auto-number column (defaults to "S / No"), e.g. the CHW FCU form's "Item No.". */
    number_label: z.string().optional(),
    link_to_instrument_register: z.boolean().optional(),
    font_size: z.string().optional(),
    columns: z.array(columnDefSchema).min(1),
    /**
     * Lets the engineer add and delete COLUMNS on a flat table, not just rows
     * (SPEC §12) — the air-measurement sheets, where the number of test points
     * across a duct is decided at the duct, not by the template.
     *
     * `columns` still seeds the initial set; this describes how a further one is
     * minted and how they are all labelled. Labels are positional
     * (`"${label_prefix} ${n}"`), so deleting the third of seven renumbers the
     * rest exactly as the source HTML does. Column ids stay stable, so a cell's
     * value never migrates to a different column when the labels shift.
     *
     * Wording is never typed by the engineer — the label is generated — so an
     * added column carries no record-authored template text (Hard Rule #5).
     */
    add_columns: addColumnsSchema.optional(),
    prefilled_rows: z.array(prefilledRowSchema).optional(),
    /**
     * Totals line closing a FLAT table, aggregated over all its rows (SPEC §12)
     * — the CHW FCU air balancing "Total Air Flow" row. A grouped table totals
     * per group instead: put `totals` inside `row_group`, not here.
     */
    totals: totalsSchema.optional(),
    /** Groups the body rows under shared spanning cells; flat table when absent. */
    row_group: rowGroupSchema.optional(),
    _status: z.string().optional(),
    _note: z.string().optional(),
  })
  .strict()
  .refine((s) => s.row_group === undefined || s.prefilled_rows === undefined, {
    message: "`prefilled_rows` is a flat-table seed; a grouped table seeds from `row_group`",
  })
  .refine((s) => s.row_group === undefined || s.totals === undefined, {
    message: "a grouped table totals per group — put `totals` inside `row_group`",
  })
  .refine(
    (s) =>
      s.row_group?.totals === undefined ||
      s.row_group.totals.cells.every((c) =>
        s.columns.some((col) => col.id === c.column),
      ),
    { message: "every totals cell must name a column of this section" },
  )
  .refine(
    (s) =>
      s.totals === undefined ||
      s.totals.cells.every((c) => s.columns.some((col) => col.id === c.column)),
    { message: "every totals cell must name a column of this section" },
  );

/**
 * Shape of a blank row an engineer may append to a section flagged
 * `allow_add_rows` (SPEC §12). The added row's text is stored as record data,
 * never template wording, so Hard Rule #5 / §5.1 still holds.
 */
export const addRowTemplateSchema = z
  .object({
    type: fieldTypeSchema,
    states: z.array(statusStateSchema).min(2).optional(),
    remarks: z.union([z.boolean(), fieldTypeSchema]).optional(),
    photo: z.boolean().optional(),
    /** Whether the engineer can set the row's serial/number cell (Wall Closure). */
    editable_no: z.boolean().optional(),
    /** Whether the engineer can set the row's group label (Wall Closure extra rows). */
    editable_group: z.boolean().optional(),
  })
  .strict()
  .refine((t) => t.type !== "status" || (t.states?.length ?? 0) >= 2, {
    message: "a `status` add-row template must define at least two `states`",
  });

/** A section whose body is a fixed list of checklist steps. */
export const standardSectionSchema = z
  .object({
    id: z.string(),
    no: z.string().optional(),
    title: z.string(),
    type: z.literal("standard").optional(),
    page_break_before: z.boolean().optional(),
    font_size: z.string().optional(),
    columns: z.record(z.string(), columnMetaSchema).optional(),
    rows: z.array(rowSchema).min(1),
    /** Allow engineers to append ad-hoc rows (SPEC §12); their text is record data. */
    allow_add_rows: z.boolean().optional(),
    add_row_template: addRowTemplateSchema.optional(),
    _status: z.string().optional(),
    _note: z.string().optional(),
  })
  .strict()
  .refine((s) => !s.allow_add_rows || s.add_row_template !== undefined, {
    message: "`allow_add_rows` requires an `add_row_template`",
  });

/** One measurement band in a `matrix` section: a labelled row of numeric points. */
export const matrixBandSchema = z
  .object({
    id: z.string().optional(),
    label: z.string(),
    unit: z.string().optional(),
    /** Overrides the section-level limit for this band's points. */
    limit: limitSchema.optional(),
    points: z
      .array(z.object({ id: z.string(), label: z.string() }).strict())
      .min(1),
  })
  .strict();

/**
 * A fixed numeric grid (SPEC §12) — e.g. the Power Turn-on insulation and
 * voltage tables. Each band declares its own points, so bands may relabel their
 * columns (E–L1… vs N–L1… vs L1–L2…). Each point auto-evaluates against its
 * band `limit`, or the section `limit` when the band sets none.
 */
export const matrixSectionSchema = z
  .object({
    id: z.string(),
    no: z.string().optional(),
    title: z.string(),
    type: z.literal("matrix"),
    page_break_before: z.boolean().optional(),
    font_size: z.string().optional(),
    row_bands: z.array(matrixBandSchema).min(1),
    /** Default pass/fail bound applied to every point unless a band overrides. */
    limit: limitSchema.optional(),
    _status: z.string().optional(),
    _note: z.string().optional(),
  })
  .strict();

/**
 * A group of header-style fields rendered in the section flow (SPEC §12) — e.g.
 * the IDF general-information and preparer blocks, or a per-page transmittal
 * header on the Power Turn-on form. Reuses `headerFieldSchema`.
 */
export const fieldGroupSectionSchema = z
  .object({
    id: z.string(),
    no: z.string().optional(),
    title: z.string(),
    type: z.literal("field_group"),
    page_break_before: z.boolean().optional(),
    fields: z.array(headerFieldSchema).min(1),
    _status: z.string().optional(),
    _note: z.string().optional(),
  })
  .strict();

/** Calibrated instruments the record must reference (SPEC.md §5). */
export const instrumentsSchema = z
  .object({
    required: z.boolean(),
    min: z.number().int().nonnegative().optional(),
    source_section: z.string().optional(),
  })
  .strict();

/**
 * Which workflow step a signature slot gates (SPEC §6). Optional — a slot with
 * no stage is captured like any other but does not gate a status transition.
 */
export const signatureStageSchema = z.enum([
  "contractor",
  "check",
  "witness",
  "client",
]);

/** One signature slot in the footer sign-off block. */
export const signatureSchema = z
  .object({
    id: z.string(),
    role: z.string(),
    company_default: z.string().optional(),
    company_locked: z.boolean().optional(),
    required: z.boolean().optional(),
    stage: signatureStageSchema.optional(),
    _note: z.string().optional(),
  })
  .strict();

export const footerSchema = z
  .object({
    no: z.string().optional(),
    title: z.string().optional(),
    layout: z.enum(["two_column", "stacked"]).optional(),
    signatures: z.array(signatureSchema).min(1),
  })
  .strict();

/**
 * A sign-off block placed in the section flow, for templates with more than one
 * signature group or per-page roles (SPEC §12) — e.g. the three Power Turn-on
 * pages. The single-block common case still uses the top-level `footer`.
 * Reuses `signatureSchema`.
 */
export const signOffSectionSchema = z
  .object({
    id: z.string(),
    no: z.string().optional(),
    title: z.string().optional(),
    type: z.literal("sign_off"),
    page_break_before: z.boolean().optional(),
    layout: z.enum(["two_column", "stacked"]).optional(),
    signatures: z.array(signatureSchema).min(1),
    _note: z.string().optional(),
  })
  .strict();

/**
 * Sections are a union of five shapes. Order matters: the explicitly-typed
 * members are tried first, and `standardSectionSchema` — whose `type` is
 * optional and therefore the permissive fallback — is tried last.
 */
export const sectionSchema = z.union([
  dynamicTableSectionSchema,
  matrixSectionSchema,
  fieldGroupSectionSchema,
  signOffSectionSchema,
  standardSectionSchema,
]);

/** The full template definition, as stored in `TemplateVersion.definition`. */
export const templateSchema = z
  .object({
    code: z.string(),
    title: z.string(),
    rev: z.string(),
    discipline: z.string(),
    category: z.enum(["ITP", "ITR"]),
    /** Default scope for records of this template (SPEC §4): tied to an equipment tag or a location. */
    scope: z.enum(["equipment", "location"]).optional(),
    page: pageSchema,
    /** Provenance note, e.g. the source HTML a template was converted from. */
    source: z.string().optional(),
    variables: z.array(variableSchema).optional(),
    header: headerSchema,
    sections: z.array(sectionSchema).min(1),
    instruments: instrumentsSchema.optional(),
    footer: footerSchema.optional(),
  })
  .strict();

// --- Derived types (single source of truth) -------------------------------

export type FieldType = z.infer<typeof fieldTypeSchema>;
export type Limit = z.infer<typeof limitSchema>;
export type Emphasis = z.infer<typeof emphasisSchema>;
export type StatusState = z.infer<typeof statusStateSchema>;
export type Variable = z.infer<typeof variableSchema>;
export type HeaderField = z.infer<typeof headerFieldSchema>;
export type Header = z.infer<typeof headerSchema>;
export type Page = z.infer<typeof pageSchema>;
export type ColumnDef = z.infer<typeof columnDefSchema>;
export type AddColumns = z.infer<typeof addColumnsSchema>;
export type ColumnMeta = z.infer<typeof columnMetaSchema>;
export type Row = z.infer<typeof rowSchema>;
export type PrefilledRow = z.infer<typeof prefilledRowSchema>;
export type Aggregate = z.infer<typeof aggregateSchema>;
export type TotalCell = z.infer<typeof totalCellSchema>;
export type Totals = z.infer<typeof totalsSchema>;
export type RowGroup = z.infer<typeof rowGroupSchema>;
export type AddRowTemplate = z.infer<typeof addRowTemplateSchema>;
export type DynamicTableSection = z.infer<typeof dynamicTableSectionSchema>;
export type StandardSection = z.infer<typeof standardSectionSchema>;
export type MatrixBand = z.infer<typeof matrixBandSchema>;
export type MatrixSection = z.infer<typeof matrixSectionSchema>;
export type FieldGroupSection = z.infer<typeof fieldGroupSectionSchema>;
export type SignOffSection = z.infer<typeof signOffSectionSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Instruments = z.infer<typeof instrumentsSchema>;
export type Signature = z.infer<typeof signatureSchema>;
export type SignatureStage = z.infer<typeof signatureStageSchema>;
export type Footer = z.infer<typeof footerSchema>;
export type Template = z.infer<typeof templateSchema>;

// --- Section discrimination ----------------------------------------------

/** True for `type: "dynamic_table"` sections (typed columns, add/delete rows). */
export function isDynamicTableSection(s: Section): s is DynamicTableSection {
  return (s as { type?: string }).type === "dynamic_table";
}

/** True for `type: "matrix"` sections (a fixed numeric grid of measurement bands). */
export function isMatrixSection(s: Section): s is MatrixSection {
  return (s as { type?: string }).type === "matrix";
}

/** True for `type: "field_group"` sections (header-style fields in the flow). */
export function isFieldGroupSection(s: Section): s is FieldGroupSection {
  return (s as { type?: string }).type === "field_group";
}

/** True for `type: "sign_off"` sections (a signature block in the flow). */
export function isSignOffSection(s: Section): s is SignOffSection {
  return (s as { type?: string }).type === "sign_off";
}

/**
 * True for standard sections (a fixed list of checklist rows). `type` is
 * optional on these, so anything without an explicit section `type` — or the
 * literal `"standard"` — is a standard section.
 */
export function isStandardSection(s: Section): s is StandardSection {
  const t = (s as { type?: string }).type;
  return t === undefined || t === "standard";
}

// --- Parse helpers --------------------------------------------------------

/** Parse and validate, throwing a ZodError on the first invalid template. */
export function parseTemplate(data: unknown): Template {
  return templateSchema.parse(data);
}

/** Non-throwing variant for load paths that report errors to the user. */
export function safeParseTemplate(data: unknown) {
  return templateSchema.safeParse(data);
}
