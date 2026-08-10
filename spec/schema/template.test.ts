import { describe, it, expect } from "vitest";
import realTemplate from "../templates/heat-load-test.json";
import {
  templateSchema,
  sectionSchema,
  fieldTypeSchema,
  parseTemplate,
  safeParseTemplate,
  FIELD_TYPES,
  isDynamicTableSection,
  isMatrixSection,
  isFieldGroupSection,
  isSignOffSection,
  isStandardSection,
} from "./template";

/** A fresh, mutable deep copy of the authoritative template for each negative case. */
function clone(): any {
  return structuredClone(realTemplate);
}

describe("heat-load-test.json — the authoritative Phase 1 template", () => {
  it("parses successfully against the schema", () => {
    const result = safeParseTemplate(realTemplate);
    expect(result.success).toBe(true);
  });

  it("preserves the three sections in document order", () => {
    const t = parseTemplate(realTemplate);
    // Matches the source form (1 Testing Equipment, 2 Set-up, 3 Heat Load Test);
    // it has no Section 4 — the numbering skips to 5 Sign-off (Rev A decision).
    expect(t.sections.map((s) => s.id)).toEqual(["sec_1", "sec_2", "sec_3"]);
  });

  it("classifies each section as the right shape", () => {
    const t: any = parseTemplate(realTemplate);
    // sec_1 is a dynamic table (typed columns); sec_2/sec_3 are row lists.
    expect(t.sections[0].type).toBe("dynamic_table");
    expect(Array.isArray(t.sections[0].columns)).toBe(true);
    expect(Array.isArray(t.sections[1].rows)).toBe(true);
    expect(t.sections[1].type).toBeUndefined();
  });

  it("carries no unresolved Rev A markers (all three decisions settled)", () => {
    const t: any = parseTemplate(realTemplate);
    // The ⛔ blockers are resolved: cal_cert keeps its label with no _note, there
    // is no reconstructed section, and the second signer is a plain 'Tested by'.
    const calCert = t.sections[0].columns.find((c: any) => c.id === "cal_cert");
    expect(calCert.label).toBe("Cal. Cert No.");
    expect(calCert._note).toBeUndefined();
    expect(t.sections.every((s: any) => s._status === undefined)).toBe(true);
    expect(t.footer.signatures.every((s: any) => s._note === undefined)).toBe(true);
    expect(t.footer.signatures.map((s: any) => s.id)).toEqual(["sig_tested", "sig_tested_2"]);
  });

  it("carries the header, variables, instruments and footer through", () => {
    const t = parseTemplate(realTemplate);
    expect(t.category).toBe("ITR");
    expect(t.page).toEqual({ size: "A4", orientation: "landscape" });
    expect(t.variables?.map((v) => v.id)).toContain("load_kw");
    expect(t.instruments?.required).toBe(true);
    expect(t.footer?.signatures).toHaveLength(2);
  });
});

describe("section disambiguation", () => {
  it("accepts a minimal standard (row-based) section", () => {
    const parsed = sectionSchema.parse({
      id: "s",
      title: "Standard",
      rows: [{ id: "r1", type: "text", description: "a step" }],
    }) as any;
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.type).toBeUndefined();
  });

  it("accepts a minimal dynamic-table section", () => {
    const parsed = sectionSchema.parse({
      id: "s",
      title: "Table",
      type: "dynamic_table",
      columns: [{ id: "c1", label: "Col", type: "text" }],
    }) as any;
    expect(parsed.type).toBe("dynamic_table");
  });

  it("rejects a section that is neither shape", () => {
    expect(
      sectionSchema.safeParse({ id: "s", title: "Neither" }).success,
    ).toBe(false);
  });
});

describe("field type enum is the single source of truth", () => {
  it("accepts every declared field type", () => {
    for (const t of FIELD_TYPES) {
      expect(fieldTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("rejects an undeclared field type", () => {
    expect(fieldTypeSchema.safeParse("rich_text").success).toBe(false);
  });
});

describe("rejects malformed templates", () => {
  it("rejects an unknown top-level key (strict)", () => {
    const t = clone();
    t.unexpected = true;
    expect(safeParseTemplate(t).success).toBe(false);
  });

  it("rejects an unknown key on a nested object (strict propagates)", () => {
    const t = clone();
    t.header.fields[0].typo = true;
    expect(safeParseTemplate(t).success).toBe(false);
  });

  it("rejects a missing required top-level field", () => {
    const t = clone();
    delete t.code;
    expect(safeParseTemplate(t).success).toBe(false);
  });

  it("rejects an invalid category", () => {
    const t = clone();
    t.category = "CHECKLIST";
    expect(safeParseTemplate(t).success).toBe(false);
  });

  it("rejects an invalid page orientation", () => {
    const t = clone();
    t.page.orientation = "diagonal";
    expect(safeParseTemplate(t).success).toBe(false);
  });

  it("rejects an empty sections array", () => {
    const t = clone();
    t.sections = [];
    expect(safeParseTemplate(t).success).toBe(false);
  });

  it("rejects a limit with neither min nor max", () => {
    const t = clone();
    // Attach an empty limit to a sec_1 table column; the refinement rejects a
    // limit object with neither bound, independent of the column's type.
    t.sections[0].columns[2].limit = {};
    expect(safeParseTemplate(t).success).toBe(false);
  });

  it("rejects a numeric variable whose default is a string", () => {
    const t = clone();
    // variables[2] is load_kw, type number, default 6.
    t.variables[2].default = "six";
    expect(safeParseTemplate(t).success).toBe(false);
  });

  it("rejects a three-state control without exactly three labels", () => {
    const t = clone();
    // sec_2 → first row is a pass_fail_na with ["Yes","No","N.A."].
    t.sections[1].rows[0].labels = ["Yes", "No"];
    expect(safeParseTemplate(t).success).toBe(false);
  });

  it("rejects a remarks value that is neither boolean nor a field type", () => {
    const t = clone();
    t.sections[1].rows[0].remarks = "nope";
    expect(safeParseTemplate(t).success).toBe(false);
  });
});

describe("Phase 2 — generalized status field (SPEC §12)", () => {
  const fourState = [
    { value: "Yes", label: "Yes", outcome: "pass" },
    { value: "No", label: "No", outcome: "fail" },
    { value: "NA", label: "NA", outcome: "na" },
    { value: "In Progress", label: "In Progress", outcome: "fail" },
  ];

  it("accepts a status row with declared states, remarks, group and photo", () => {
    const parsed = sectionSchema.parse({
      id: "idf_3",
      title: "3. Checklist",
      rows: [
        {
          id: "c3-1",
          type: "status",
          description: "Dust free",
          states: fourState,
          remarks: true,
          group: "General",
          photo: true,
        },
      ],
    }) as any;
    expect(parsed.rows[0].states).toHaveLength(4);
    expect(parsed.rows[0].photo).toBe(true);
    expect(parsed.rows[0].group).toBe("General");
  });

  it("maps In Progress to a fail outcome (counts as outstanding, §6)", () => {
    const parsed = sectionSchema.parse({
      id: "idf_3",
      title: "3. Checklist",
      rows: [
        { id: "c3-1", type: "status", description: "x", states: fourState },
      ],
    }) as any;
    const inProgress = parsed.rows[0].states.find(
      (s: any) => s.value === "In Progress",
    );
    expect(inProgress.outcome).toBe("fail");
  });

  it("accepts a two-option Yes/No status (Phase Rotation)", () => {
    expect(
      sectionSchema.safeParse({
        id: "s",
        title: "s",
        rows: [
          {
            id: "pr",
            type: "status",
            description: "Phase Rotation",
            states: [
              { value: "Yes", label: "Yes", outcome: "pass" },
              { value: "No", label: "No", outcome: "fail" },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects a status row with no states", () => {
    expect(
      sectionSchema.safeParse({
        id: "s",
        title: "s",
        rows: [{ id: "r", type: "status", description: "x" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a status row with only one state", () => {
    expect(
      sectionSchema.safeParse({
        id: "s",
        title: "s",
        rows: [
          {
            id: "r",
            type: "status",
            description: "x",
            states: [{ value: "Yes", label: "Yes", outcome: "pass" }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a status state with an unknown outcome", () => {
    expect(
      sectionSchema.safeParse({
        id: "s",
        title: "s",
        rows: [
          {
            id: "r",
            type: "status",
            description: "x",
            states: [
              { value: "Yes", label: "Yes", outcome: "pass" },
              { value: "Maybe", label: "Maybe", outcome: "unsure" },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires states on a status column in a dynamic table too", () => {
    expect(
      sectionSchema.safeParse({
        id: "s",
        title: "t",
        type: "dynamic_table",
        columns: [{ id: "c", label: "Status", type: "status" }],
      }).success,
    ).toBe(false);
  });

  it("adds email and tel to the field-type enum", () => {
    expect(fieldTypeSchema.safeParse("email").success).toBe(true);
    expect(fieldTypeSchema.safeParse("tel").success).toBe(true);
  });
});

describe("Phase 2 — matrix section (Power Turn-on grids)", () => {
  it("accepts a matrix with per-band points and a band limit override", () => {
    const parsed = sectionSchema.parse({
      id: "insulation",
      title: "Insulation Test",
      type: "matrix",
      limit: { min: 1 },
      row_bands: [
        {
          id: "earth",
          label: "Resistance to Earth",
          unit: "MΩ",
          points: [
            { id: "e_l1", label: "E–L1" },
            { id: "e_l2", label: "E–L2" },
            { id: "e_n", label: "E–N" },
          ],
        },
        {
          id: "voltage",
          label: "Incoming Voltage",
          unit: "V",
          limit: { min: 0, max: 415 },
          points: [{ id: "l1n", label: "L1–N" }],
        },
      ],
    }) as any;
    expect(isMatrixSection(parsed)).toBe(true);
    expect(parsed.row_bands[0].points).toHaveLength(3);
    expect(parsed.row_bands[1].limit).toEqual({ min: 0, max: 415 });
  });

  it("rejects a band with no points", () => {
    expect(
      sectionSchema.safeParse({
        id: "m",
        title: "m",
        type: "matrix",
        row_bands: [{ id: "b", label: "Empty", points: [] }],
      }).success,
    ).toBe(false);
  });
});

describe("Phase 2 — field_group and sign_off sections", () => {
  it("accepts a field_group of header-style fields (IDF general info)", () => {
    const parsed = sectionSchema.parse({
      id: "general",
      title: "1. General Project Information",
      type: "field_group",
      fields: [
        { id: "pname", label: "Project Name", type: "text" },
        {
          id: "ptype",
          label: "Project Type",
          type: "dropdown",
          options: ["Expansion", "Relocation"],
        },
        { id: "pmail", label: "Email", type: "email" },
      ],
    }) as any;
    expect(isFieldGroupSection(parsed)).toBe(true);
    expect(parsed.fields).toHaveLength(3);
  });

  it("accepts a sign_off section with its own roles (per-page Power sign-off)", () => {
    const parsed = sectionSchema.parse({
      id: "so_p1",
      title: "Sign-off",
      type: "sign_off",
      signatures: [
        { id: "sg_perf", role: "Performed by NSC / DSC" },
        { id: "sg_lew", role: "Witnessed by LEW" },
        { id: "sg_cxa", role: "Witnessed by CxA" },
      ],
    }) as any;
    expect(isSignOffSection(parsed)).toBe(true);
    expect(parsed.signatures).toHaveLength(3);
  });
});

describe("Phase 2 — ad-hoc rows, page breaks, discriminators", () => {
  const twoState = [
    { value: "Yes", label: "Yes", outcome: "pass" },
    { value: "No", label: "No", outcome: "fail" },
  ];

  it("rejects allow_add_rows without an add_row_template", () => {
    expect(
      sectionSchema.safeParse({
        id: "s",
        title: "Wall Closure",
        allow_add_rows: true,
        rows: [
          { id: "i1", type: "status", description: "x", states: twoState },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts allow_add_rows with an add_row_template", () => {
    const parsed = sectionSchema.parse({
      id: "s",
      title: "Wall Closure",
      allow_add_rows: true,
      add_row_template: {
        type: "status",
        states: twoState,
        remarks: true,
        editable_no: true,
        editable_group: true,
      },
      rows: [{ id: "i1", type: "status", description: "x", states: twoState }],
    }) as any;
    expect(parsed.allow_add_rows).toBe(true);
    expect(parsed.add_row_template.editable_group).toBe(true);
  });

  it("accepts page_break_before on a section", () => {
    expect(
      sectionSchema.safeParse({
        id: "s",
        title: "page 2",
        page_break_before: true,
        type: "field_group",
        fields: [{ id: "f", label: "Ref No.", type: "text" }],
      }).success,
    ).toBe(true);
  });

  it("classifies all five section shapes and never double-counts", () => {
    const standard = sectionSchema.parse({
      id: "s",
      title: "s",
      rows: [{ id: "r", type: "text", description: "x" }],
    });
    const matrix = sectionSchema.parse({
      id: "m",
      title: "m",
      type: "matrix",
      row_bands: [{ label: "b", points: [{ id: "p", label: "P" }] }],
    });
    const fieldGroup = sectionSchema.parse({
      id: "fg",
      title: "fg",
      type: "field_group",
      fields: [{ id: "f", label: "F", type: "text" }],
    });
    const signOff = sectionSchema.parse({
      id: "so",
      title: "so",
      type: "sign_off",
      signatures: [{ id: "sg", role: "Signer" }],
    });

    // The new explicit types must NOT fall through to isStandardSection.
    expect(isStandardSection(standard)).toBe(true);
    expect(isMatrixSection(matrix)).toBe(true);
    expect(isStandardSection(matrix)).toBe(false);
    expect(isFieldGroupSection(fieldGroup)).toBe(true);
    expect(isStandardSection(fieldGroup)).toBe(false);
    expect(isSignOffSection(signOff)).toBe(true);
    expect(isStandardSection(signOff)).toBe(false);
    expect(isDynamicTableSection(standard)).toBe(false);
  });
});

describe("parse helpers", () => {
  it("parseTemplate throws on an invalid template", () => {
    expect(() => parseTemplate({ code: "X" })).toThrow();
  });

  it("safeParseTemplate reports issues without throwing", () => {
    const result = safeParseTemplate({ code: "X" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("templateSchema and the helpers agree", () => {
    expect(templateSchema.safeParse(realTemplate).success).toBe(true);
  });
});

describe("grouped dynamic tables (SPEC §12)", () => {
  /** A minimal grouped section, cloned per case so edits do not leak. */
  function grouped(): any {
    return {
      id: "balancing",
      title: "Air Balancing Results",
      type: "dynamic_table",
      columns: [
        { id: "design", label: "Design", type: "number" },
        { id: "balanced", label: "Balanced", type: "number" },
        {
          id: "pct",
          label: "Percentage",
          type: "calculated",
          formula: "balanced / design * 100",
        },
      ],
      row_group: {
        id: "vav",
        label: "VAV Unit",
        auto_number: true,
        columns: [{ id: "tag", label: "Equipment Tag", type: "text" }],
        totals: {
          label: "TOTAL",
          cells: [
            { column: "design", aggregate: "sum" },
            { column: "pct", formula: "balanced / design * 100", unit: "%" },
          ],
        },
      },
    };
  }

  it("accepts a grouped section and still reports it as a dynamic table", () => {
    const section = sectionSchema.parse(grouped());
    expect(isDynamicTableSection(section)).toBe(true);
    expect(isStandardSection(section)).toBe(false);
  });

  it("leaves an ungrouped dynamic table valid and unchanged", () => {
    const flat = grouped();
    delete flat.row_group;
    const section: any = sectionSchema.parse(flat);
    expect(isDynamicTableSection(section)).toBe(true);
    expect(section.row_group).toBeUndefined();
  });

  it("requires a formula on a calculated column", () => {
    const s = grouped();
    delete s.columns[2].formula;
    expect(sectionSchema.safeParse(s).success).toBe(false);
  });

  it("requires a totals cell to name exactly one of aggregate or formula", () => {
    const neither = grouped();
    neither.row_group.totals.cells[0] = { column: "design" };
    expect(sectionSchema.safeParse(neither).success).toBe(false);

    const both = grouped();
    both.row_group.totals.cells[0] = {
      column: "design",
      aggregate: "sum",
      formula: "design",
    };
    expect(sectionSchema.safeParse(both).success).toBe(false);
  });

  it("rejects a totals cell naming a column the section does not define", () => {
    const s = grouped();
    s.row_group.totals.cells[0].column = "no_such_column";
    expect(sectionSchema.safeParse(s).success).toBe(false);
  });

  it("rejects prefilled_rows on a grouped table, which seeds from row_group", () => {
    const s = grouped();
    s.prefilled_rows = [{ design: "100" }];
    expect(sectionSchema.safeParse(s).success).toBe(false);
  });

  it("rejects an unknown key inside row_group", () => {
    const s = grouped();
    s.row_group.grouping = "vav";
    expect(sectionSchema.safeParse(s).success).toBe(false);
  });
});

describe("flat dynamic-table totals (SPEC §12)", () => {
  /** A minimal flat table with a totals line, cloned per case. */
  function flat(): any {
    return {
      id: "balancing",
      title: "Air Balancing Results",
      type: "dynamic_table",
      auto_number: true,
      number_label: "Item No.",
      columns: [
        { id: "design", label: "Design", type: "number" },
        { id: "final_h", label: "Final H", type: "number" },
        {
          id: "pct_h",
          label: "Percentage H",
          type: "calculated",
          formula: "final_h / design * 100",
        },
      ],
      totals: {
        label: "Total Air Flow",
        cells: [
          { column: "design", aggregate: "sum" },
          { column: "final_h", aggregate: "sum" },
          { column: "pct_h", formula: "final_h / design * 100", unit: "%" },
        ],
      },
    };
  }

  it("accepts a flat table with a totals line and a number label", () => {
    const section: any = sectionSchema.parse(flat());
    expect(isDynamicTableSection(section)).toBe(true);
    expect(section.totals.label).toBe("Total Air Flow");
    expect(section.number_label).toBe("Item No.");
  });

  it("rejects section-level totals combined with a row_group", () => {
    const s = flat();
    s.row_group = {
      id: "g",
      label: "Group",
      columns: [{ id: "tag", label: "Tag", type: "text" }],
    };
    expect(sectionSchema.safeParse(s).success).toBe(false);
  });

  it("rejects a totals cell naming a column the section does not define", () => {
    const s = flat();
    s.totals.cells[0].column = "no_such_column";
    expect(sectionSchema.safeParse(s).success).toBe(false);
  });

  it("still requires exactly one of aggregate or formula per cell", () => {
    const s = flat();
    s.totals.cells[0] = { column: "design" };
    expect(sectionSchema.safeParse(s).success).toBe(false);
  });
});
