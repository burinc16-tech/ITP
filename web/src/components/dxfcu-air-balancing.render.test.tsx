import { useState, type ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isDynamicTableSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/dxfcu-air-balancing.json";
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

/** Four diffusers, matching the source form's DXFCU-A-NR-601 readings. */
function filled(): RecordValues {
  let v = emptyValues(template);
  const rows: Array<[string, string]> = [
    ["1120", "956"],
    ["1120", "1001"],
    ["500", "630"],
    ["200", "171"],
  ];
  rows.forEach(([design, finalH], i) => {
    v = setTableCell(v, "balancing", i, "design", design);
    v = setTableCell(v, "balancing", i, "final_h", finalH);
  });
  return v;
}

describe("DX FCU Air Balancing template", () => {
  it("is a flat portrait ITR shaped like the CHW FCU form", () => {
    expect(template.page.orientation).toBe("portrait");
    expect(template.category).toBe("ITR");
    expect(template.code).toBe("DAB");
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

  it("pairs the indoor unit with its condensing unit in the header", () => {
    const field = template.header.fields.find((f) => f.id === "fcu_cu_tag")!;
    expect(field.label).toBe("FCU / CU No.");
    expect(field.required).toBe(true);
  });

  it("carries no project data — the source form's readings belong to a record", () => {
    const json = JSON.stringify(template);
    expect(json).not.toContain("DXFCU-A-NR-601");
    expect(json).not.toContain("Apple");
    expect(json).not.toContain("FXMQ140PAVE");
    expect(json).not.toContain("Network Room");
  });

  it("computes a row's percentage and totals the table from its rows", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Design Airflow row 1"), "1120");
    await user.type(screen.getByLabelText("Final Airflow H row 1"), "956");
    // 956 / 1120 = 85.4% -> 85%
    expect(screen.getByLabelText("Percentage H row 1")).toHaveTextContent("85%");

    if (!isDynamicTableSection(section)) return;
    const totals = computeFlatTotals(section, filled().tables.balancing!);
    expect(totals.design).toBe("2940");
    expect(totals.final_h).toBe("2758");
    // 2758 / 2940 = 93.8% -> 94%
    expect(totals.pct_h).toBe("94%");
  });

  it("renders one Tested-by and two Witnessed-by roles from the source form", () => {
    render(<Harness />);
    expect(screen.getByText("Tested by")).toBeInTheDocument();
    expect(screen.getAllByText("Witnessed by")).toHaveLength(2);
  });
});
