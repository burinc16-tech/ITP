import { useState, type ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { emptyValues } from "../lib/values";
import { TemplateForm } from "./template-form";

const template = parseTemplate(rawTemplate);

/** Stateful harness so interactions round-trip through the controlled form. */
function Harness(): ReactNode {
  const [values, setValues] = useState(() => emptyValues(template));
  return (
    <TemplateForm template={template} values={values} onChange={setValues} />
  );
}

describe("TemplateForm — rendering", () => {
  it("renders every section title from the template", () => {
    render(<Harness />);
    for (const title of [
      "TESTING EQUIPMENT",
      "SET-UP",
      "HEAT LOAD TEST",
      "TEMPERATURE & HUMIDITY RECORD SHEET",
    ]) {
      expect(
        screen.getByRole("heading", { name: new RegExp(title) }),
      ).toBeInTheDocument();
    }
  });

  it("seeds a variable input from its default", () => {
    render(<Harness />);
    expect(screen.getByLabelText("CHW FCU tag")).toHaveValue(
      "CHW-FCU-A-NR-401",
    );
  });

  it("interpolates variables into step descriptions", () => {
    render(<Harness />);
    // s3_01 uses {{disable_temp}} = 30 and {{hi_temp}} = 26.
    expect(
      screen.getByText(/keypad set point to 30°C to disable cooling/),
    ).toBeInTheDocument();
  });

  it("renders the template's pass/fail/na labels, not defaults", () => {
    render(<Harness />);
    expect(screen.getAllByRole("button", { name: "Yes" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "No" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "N.A." }).length).toBeGreaterThan(0);
  });

  it("shows the reconstructed-section status note", () => {
    render(<Harness />);
    expect(screen.getByText(/RECONSTRUCTED/)).toBeInTheDocument();
  });
});

describe("TemplateForm — interaction", () => {
  it("evaluates a numeric reading against its limit", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const tempCells = screen.getAllByLabelText(/^Temperature row/);
    await user.type(tempCells[0]!, "30"); // limit is max 26 → Fail
    expect(screen.getByText("Fail")).toBeInTheDocument();
  });

  it("requires a remark when a step is marked N/A", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // First SET-UP row is a pass_fail_na step.
    const naButtons = screen.getAllByRole("button", { name: "N.A." });
    await user.click(naButtons[0]!);
    expect(
      screen.getByText(/required when this is marked N\/A/),
    ).toBeInTheDocument();
  });

  it("adds a row to a dynamic table", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const before = screen.getAllByLabelText(/^Temperature row/).length;
    expect(before).toBe(12);

    // The temp/humidity sheet is the last section; use its Add row button.
    const addButtons = screen.getAllByRole("button", { name: /Add row/ });
    await user.click(addButtons[addButtons.length - 1]!);

    expect(screen.getAllByLabelText(/^Temperature row/)).toHaveLength(13);
  });
});
