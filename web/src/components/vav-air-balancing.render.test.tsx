import { useState, type ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isDynamicTableSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/vav-air-balancing.json";
import { computeTotals } from "../lib/grouped-table";
import { emptyValues, setGroupCell, type RecordValues } from "../lib/values";
import { TemplateForm } from "./template-form";

// Parsing here is the schema validation — an invalid template throws.
const template = parseTemplate(rawTemplate);
const section = template.sections.find((s) => s.id === "balancing")!;

function Harness(props: { initial?: RecordValues }): ReactNode {
  const [values, setValues] = useState(
    () => props.initial ?? emptyValues(template),
  );
  return <TemplateForm template={template} values={values} onChange={setValues} />;
}

/** One VAV unit with three diffusers, matching the source form's first group. */
function filled(): RecordValues {
  let v = emptyValues(template);
  const rows: Array<[string, string]> = [
    ["140", "123"],
    ["140", "133"],
    ["250", "234"],
  ];
  if (!isDynamicTableSection(section)) throw new Error("expected a table section");
  // The blank record starts with one row; add the other two.
  v = { ...v, groups: { balancing: [{ fields: { tag: "VAV A-602-02" }, rows: [{}, {}, {}] }] } };
  rows.forEach(([design, balanced], i) => {
    v = setGroupCell(v, "balancing", 0, i, "design", design);
    v = setGroupCell(v, "balancing", 0, i, "balanced", balanced);
  });
  return v;
}

describe("VAV Air Balancing template", () => {
  it("is a grouped landscape ITR with a computed percentage column", () => {
    expect(template.page.orientation).toBe("landscape");
    expect(template.category).toBe("ITR");
    expect(isDynamicTableSection(section)).toBe(true);
    if (!isDynamicTableSection(section)) return;
    expect(section.row_group?.label).toBe("VAV Unit");
    expect(section.row_group?.totals?.label).toBe("TOTAL");
    const pct = section.columns.find((c) => c.id === "pct")!;
    expect(pct.type).toBe("calculated");
    expect(pct.formula).toBe("balanced / design * 100");
  });

  it("carries no project data — the source form's readings belong to a record", () => {
    const json = JSON.stringify(template);
    expect(json).not.toContain("AHU-A-602");
    expect(json).not.toContain("Apple");
    expect(json).not.toContain("Shared Office");
  });

  it("renders group columns, body columns and the totals label", () => {
    render(<Harness />);
    expect(screen.getByRole("columnheader", { name: /Equipment Tag/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Diffuser Type/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Percentage/ })).toBeInTheDocument();
    expect(screen.getByText("TOTAL")).toBeInTheDocument();
  });

  it("computes each row's percentage and the group total as the engineer types", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Design Air Flow VAV Unit 1 row 1"), "140");
    await user.type(screen.getByLabelText("Balanced Air Flow VAV Unit 1 row 1"), "123");
    // 123 / 140 = 87.9% -> 88%
    expect(screen.getByLabelText("Percentage VAV Unit 1 row 1")).toHaveTextContent("88%");
  });

  it("totals the group from its rows, not from the per-row percentages", () => {
    if (!isDynamicTableSection(section)) return;
    const values = filled();
    const totals = computeTotals(section, values.groups!.balancing![0]!);
    expect(totals.design).toBe("530");
    expect(totals.balanced).toBe("490");
    // 490 / 530 = 92.45% -> 92%. Averaging the row percentages would give 91%.
    expect(totals.pct).toBe("92%");
  });

  it("leaves the percentage blank when a reading is not taken yet", () => {
    if (!isDynamicTableSection(section)) return;
    const totals = computeTotals(section, {
      fields: {},
      rows: [{ design: "500", balanced: "" }],
    });
    expect(totals.balanced).toBe("");
    expect(totals.pct).toBe("");
  });

  it("adds a diffuser row to a unit, carrying the service area down", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Service Area VAV Unit 1 row 1"), "Open Office");
    await user.click(screen.getByRole("button", { name: "+ Add row" }));
    expect(screen.getByLabelText("Service Area VAV Unit 1 row 2")).toHaveValue("Open Office");
  });

  it("adds and removes whole VAV units, keeping at least one", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByLabelText("Equipment Tag VAV Unit 2")).toBeNull();
    await user.click(screen.getByRole("button", { name: "+ Add VAV Unit" }));
    expect(screen.getByLabelText("Equipment Tag VAV Unit 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove VAV Unit 2" }));
    expect(screen.queryByLabelText("Equipment Tag VAV Unit 2")).toBeNull();
    // The last remaining unit cannot be removed.
    expect(screen.getByRole("button", { name: "Remove VAV Unit 1" })).toBeDisabled();
  });

  it("spans the group cells across the unit's diffuser rows", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "+ Add row" }));
    const tagCell = screen.getByLabelText("Equipment Tag VAV Unit 1").closest("td")!;
    expect(tagCell).toHaveAttribute("rowspan", "2");
  });

  it("renders the three sign-off roles from the source form", () => {
    render(<Harness />);
    expect(screen.getByText("Tested by")).toBeInTheDocument();
    expect(screen.getAllByText("Witness by")).toHaveLength(2);
  });

  it("keeps a blank record's group bucket separate from flat tables", () => {
    const values = emptyValues(template);
    expect(values.groups?.balancing).toHaveLength(1);
    expect(values.tables.balancing).toBeUndefined();
  });
});

describe("grouped tables and older records", () => {
  it("renders a record saved before grouped tables existed, without throwing", () => {
    const legacy = emptyValues(template);
    delete legacy.groups;
    render(<Harness initial={legacy} />);
    // No groups to show, but the section and its headers still render.
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: /Equipment Tag/ }))
      .toBeInTheDocument();
  });
});
