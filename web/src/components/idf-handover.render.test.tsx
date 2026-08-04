import { useState, type ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isStandardSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/idf-handover.json";
import { emptyValues } from "../lib/values";
import { TemplateForm } from "./template-form";

// Parsing here is the schema validation — an invalid IDF template throws.
const template = parseTemplate(rawTemplate);

function Harness(): ReactNode {
  const [values, setValues] = useState(() => emptyValues(template));
  return <TemplateForm template={template} values={values} onChange={setValues} />;
}

describe("IDF Handover template", () => {
  it("has the expected checklist and photo-confirming rows", () => {
    const rowsOf = (id: string) => {
      const s = template.sections.find((sec) => sec.id === id);
      return s && isStandardSection(s) ? s.rows : [];
    };
    expect(rowsOf("checklist")).toHaveLength(25);
    expect(rowsOf("photos_confirming")).toHaveLength(16);
    // Every checklist row is a four-state status with a photo box (§12).
    for (const row of rowsOf("checklist")) {
      expect(row.type).toBe("status");
      expect(row.states).toHaveLength(4);
      expect(row.photo).toBe(true);
    }
  });

  it("maps In Progress and No to a fail outcome, Yes to pass, NA to na (§6/§12)", () => {
    const s = template.sections.find((sec) => sec.id === "checklist");
    const states = s && isStandardSection(s) ? s.rows[0]!.states! : [];
    const outcome = (v: string) => states.find((st) => st.value === v)?.outcome;
    expect(outcome("yes")).toBe("pass");
    expect(outcome("no")).toBe("fail");
    expect(outcome("na")).toBe("na");
    expect(outcome("in_progress")).toBe("fail");
  });

  it("renders the four-state control and a photo capture per row", () => {
    render(<Harness />);
    expect(screen.getByText("3-1")).toBeInTheDocument();
    expect(screen.getByText("Dust free")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "In Progress" }).length).toBeGreaterThan(0);
    // One photo "Add photo" control per checklist + photo row (25 + 16).
    expect(screen.getAllByText("Add photo")).toHaveLength(41);
  });

  it("renders the preparer field group with email and tel inputs", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Contact No.")).toHaveAttribute("type", "tel");
  });

  it("renders the four sign-off roles", () => {
    render(<Harness />);
    expect(screen.getByText("Vendor")).toBeInTheDocument();
    expect(screen.getByText("General Contractor")).toBeInTheDocument();
    expect(screen.getByText("Project Manager")).toBeInTheDocument();
    expect(screen.getByText("RSE Approver")).toBeInTheDocument();
  });

  it("records a status selection without error", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const yes = screen.getAllByRole("button", { name: "Yes" });
    await user.click(yes[0]!);
    expect(yes[0]!).toHaveAttribute("aria-pressed", "true");
  });
});
