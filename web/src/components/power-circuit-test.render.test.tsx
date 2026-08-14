import { useState, type ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isDynamicTableSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/power-circuit-test.json";
import { emptyValues, type RecordValues } from "../lib/values";
import { TemplateForm } from "./template-form";

// Parsing here is the schema validation — an invalid template throws.
const template = parseTemplate(rawTemplate);
const circuits = template.sections.find((s) => s.id === "circuits")!;

function Harness(props: { initial?: RecordValues }): ReactNode {
  const [values, setValues] = useState(
    () => props.initial ?? emptyValues(template),
  );
  return <TemplateForm template={template} values={values} onChange={setValues} />;
}

describe("Power Circuit Test template", () => {
  it("is a flat portrait ITR whose circuit table carries the paper's measurements", () => {
    expect(template.code).toBe("PCT");
    expect(template.category).toBe("ITR");
    expect(template.page.orientation).toBe("portrait");
    expect(isDynamicTableSection(circuits)).toBe(true);
    if (!isDynamicTableSection(circuits)) return;
    expect(circuits.row_group).toBeUndefined();
    expect(circuits.columns.map((c) => c.id)).toEqual([
      "circuit_ref",
      "ir_ln",
      "ir_le",
      "volts",
      "polarity",
      "earth_loop",
      "rcd_0",
      "rcd_180",
    ]);
  });

  it("keeps the insulation columns text so an over-range \">999\" reading is accepted", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const ln = screen.getByLabelText("Insulation L-N row 1");
    await user.type(ln, ">999");
    expect(ln).toHaveValue(">999");
  });

  /**
   * Regression: `dynamic-table-section` rendered a `status` cell without passing
   * the column's declared `states`, so `FieldControl` mapped over an empty array
   * and the Polarity column came out as a dead, unfillable cell in the editable
   * form — while printing correctly, which is what hid it. Found on this
   * template; `lighting-circuit-test` had the same silent hole.
   */
  it("renders the Polarity status column as pressable Pass / Fail options", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const cell = screen.getByRole("group", { name: "Polarity row 1" });
    const pass = within(cell).getByRole("button", { name: "Pass" });
    within(cell).getByRole("button", { name: "Fail" });

    expect(pass).toHaveAttribute("aria-pressed", "false");
    await user.click(pass);
    expect(pass).toHaveAttribute("aria-pressed", "true");
  });
});
