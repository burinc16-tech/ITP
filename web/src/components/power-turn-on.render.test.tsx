import { useState, type ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/power-turn-on.json";
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

describe("Power Turn-on renders through the generic renderer", () => {
  it("renders the matrix band labels and measurement points", () => {
    render(<Harness />);
    expect(
      screen.getByText(/Resistance to Earth/),
    ).toBeInTheDocument();
    // point inputs are labelled "<band> <point>"
    expect(
      screen.getByLabelText(/Resistance to Earth E . L1/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Resistance between Phase L1 . L2/),
    ).toBeInTheDocument();
  });

  it("evaluates a matrix cell against the section limit (≥ 1 MΩ)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const cell = screen.getByLabelText(/Resistance to Earth E . L1/);
    await user.type(cell, "0.5"); // below min 1 → Fail
    expect(screen.getByText("Fail")).toBeInTheDocument();
  });

  it("renders the N-state status control with template labels", () => {
    render(<Harness />);
    expect(screen.getAllByRole("button", { name: "YES" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "N/A" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "NO" }).length).toBeGreaterThan(0);
  });

  it("renders contiguous row-group headings (Pre Test / Post Test)", () => {
    render(<Harness />);
    expect(
      screen.getByRole("heading", { name: "Pre Test" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Post Test" }),
    ).toBeInTheDocument();
  });

  it("renders field_group transmittal headers", () => {
    render(<Harness />);
    // Ref. No. appears on both page-2 and page-3 headers.
    expect(screen.getAllByLabelText("Ref. No.").length).toBe(2);
  });

  it("renders three sign-off blocks with their own roles", () => {
    render(<Harness />);
    expect(screen.getByText("Tested By")).toBeInTheDocument();
    expect(screen.getByText("Witnessed by LEW")).toBeInTheDocument();
    expect(screen.getByText("Witness by RE / RTO")).toBeInTheDocument();
  });

  it("marks the two page breaks between the three pages", () => {
    render(<Harness />);
    expect(screen.getAllByRole("separator", { name: "Page break" })).toHaveLength(2);
  });

  it("lets an engineer append an ad-hoc row to the cable-termination list", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByLabelText("Added item description")).toBeNull();
    await user.click(screen.getByRole("button", { name: "+ Add item" }));
    expect(screen.getByLabelText("Added item description")).toBeInTheDocument();
    // the appended row carries the template's status control (a group of buttons)
    expect(
      screen.getByRole("group", { name: "Result — added item" }),
    ).toBeInTheDocument();
  });

  it("records a status selection without error", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const yesButtons = screen.getAllByRole("button", { name: "YES" });
    await user.click(yesButtons[0]!);
    expect(yesButtons[0]!).toHaveAttribute("aria-pressed", "true");
  });
});
