import { useState, type ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isDynamicTableSection, isStandardSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/wall-closure.json";
import { emptyValues } from "../lib/values";
import { TemplateForm } from "./template-form";

// Parsing here is the schema validation — an invalid template throws.
const template = parseTemplate(rawTemplate);

function Harness(): ReactNode {
  const [values, setValues] = useState(() => emptyValues(template));
  return <TemplateForm template={template} values={values} onChange={setValues} />;
}

describe("Wall Closure template", () => {
  it("has grouped Yes/NA/No checklist rows and a seeded defects table", () => {
    const checklist = template.sections.find((s) => s.id === "checklist");
    expect(checklist && isStandardSection(checklist)).toBe(true);
    if (checklist && isStandardSection(checklist)) {
      expect(checklist.rows).toHaveLength(8);
      expect(checklist.rows[0]!.group).toBe("Architectural");
      expect(checklist.rows.find((r) => r.id === "chk_me_1")!.group).toBe("M&E");
      expect(checklist.allow_add_rows).toBe(true);
      // No maps to a fail outcome so it flows into outstanding items (§6).
      const states = checklist.rows[0]!.states!;
      expect(states.find((s) => s.value === "no")!.outcome).toBe("fail");
    }
    const defects = template.sections.find((s) => s.id === "defects");
    expect(defects && isDynamicTableSection(defects) && defects.min_rows).toBe(9);
  });

  it("renders the Architectural and M&E group headings and the defects list", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "Architectural" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "M&E" })).toBeInTheDocument();
    expect(screen.getByText("Rockwool installation acceptable")).toBeInTheDocument();
    expect(screen.getByText(/Defects List/)).toBeInTheDocument();
  });

  it("lets an engineer append an ad-hoc checklist item", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByLabelText("Added item description")).toBeNull();
    await user.click(screen.getByRole("button", { name: "+ Add item" }));
    expect(screen.getByLabelText("Added item description")).toBeInTheDocument();
  });

  it("renders the three sign-off roles", () => {
    render(<Harness />);
    expect(screen.getByText("Checked by")).toBeInTheDocument();
    expect(screen.getAllByText("Witnessed by")).toHaveLength(2);
  });
});
