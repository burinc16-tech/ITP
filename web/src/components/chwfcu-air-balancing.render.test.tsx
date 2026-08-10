import { useState, type ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isDynamicTableSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/chwfcu-air-balancing.json";
import { computeFlatTotals } from "../lib/grouped-table";
import { emptyValues, setTableCell, type RecordValues } from "../lib/values";
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

/** Four diffusers, matching the source form's CHWFCU-A-NR-601 readings. */
function filled(): RecordValues {
  let v = emptyValues(template);
  const rows: Array<[string, string]> = [
    ["1120", "1154"],
    ["1120", "1169"],
    ["500", "757"],
    ["200", "224"],
  ];
  rows.forEach(([design, finalH], i) => {
    v = setTableCell(v, "balancing", i, "design", design);
    v = setTableCell(v, "balancing", i, "final_h", finalH);
  });
  return v;
}

describe("CHW FCU Air Balancing template", () => {
  it("is a flat portrait ITR with computed L/M/H percentage columns", () => {
    expect(template.page.orientation).toBe("portrait");
    expect(template.category).toBe("ITR");
    expect(template.code).toBe("FAB");
    expect(isDynamicTableSection(section)).toBe(true);
    if (!isDynamicTableSection(section)) return;
    expect(section.row_group).toBeUndefined();
    expect(section.totals?.label).toBe("Total Air Flow");
    for (const speed of ["l", "m", "h"]) {
      const pct = section.columns.find((c) => c.id === `pct_${speed}`)!;
      expect(pct.type).toBe("calculated");
      expect(pct.formula).toBe(`final_${speed} / design * 100`);
    }
  });

  it("carries no project data — the source form's readings belong to a record", () => {
    const json = JSON.stringify(template);
    expect(json).not.toContain("CHWFCU-A-NR-601");
    expect(json).not.toContain("Apple");
    expect(json).not.toContain("Temperzone");
    expect(json).not.toContain("Network Room");
  });

  it("renders the columns and the Total Air Flow label", () => {
    render(<Harness />);
    expect(screen.getByRole("columnheader", { name: /Diffuser No\./ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Design Airflow/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Percentage H/ })).toBeInTheDocument();
    expect(screen.getByText("Total Air Flow")).toBeInTheDocument();
  });

  it("starts a blank record with the source form's four rows", () => {
    const values = emptyValues(template);
    expect(values.tables.balancing).toHaveLength(4);
    expect(values.groups?.balancing).toBeUndefined();
  });

  it("computes a row's percentage as the engineer types", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Design Airflow row 1"), "1120");
    await user.type(screen.getByLabelText("Final Airflow H row 1"), "1154");
    // 1154 / 1120 = 103.04% -> 103%
    expect(screen.getByLabelText("Percentage H row 1")).toHaveTextContent("103%");
    // Speeds not measured yet stay blank placeholders, never 0%.
    expect(screen.getByLabelText("Percentage L row 1")).toHaveTextContent("—");
  });

  it("totals the table from its rows, not from the per-row percentages", () => {
    if (!isDynamicTableSection(section)) return;
    const totals = computeFlatTotals(section, filled().tables.balancing!);
    expect(totals.design).toBe("2940");
    expect(totals.final_h).toBe("3304");
    // 3304 / 2940 = 112.4% -> 112%. Averaging row percentages would differ.
    expect(totals.pct_h).toBe("112%");
  });

  it("leaves the totals blank when nothing is filled in yet", () => {
    if (!isDynamicTableSection(section)) return;
    const totals = computeFlatTotals(section, emptyValues(template).tables.balancing!);
    expect(totals.design).toBe("");
    expect(totals.final_h).toBe("");
    expect(totals.pct_h).toBe("");
  });

  it("renders one Tested-by and three Witnessed-by roles from the source form", () => {
    render(<Harness />);
    expect(screen.getByText("Tested by")).toBeInTheDocument();
    expect(screen.getAllByText("Witnessed by")).toHaveLength(3);
  });
});
