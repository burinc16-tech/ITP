import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { emptyValues, setHeader, setRowValue } from "../lib/values";
import { PrintView } from "./print-view";

const template = parseTemplate(rawTemplate);

function filledValues() {
  let v = emptyValues(template);
  v = setHeader(v, "doc_no", "ITR-042");
  v = setRowValue(v, "s2_01", "na"); // three-state → prints "N.A."
  return v;
}

describe("PrintView", () => {
  it("paginates one section per page plus a sign-off page, numbered", () => {
    render(
      <PrintView
        template={template}
        values={filledValues()}
        status="draft"
        serialNo={null}
      />,
    );
    // 4 sections + sign-off = 5 pages.
    expect(screen.getByText("Page 1 of 5")).toBeInTheDocument();
    expect(screen.getByText("Page 5 of 5")).toBeInTheDocument();
  });

  it("repeats the Kenyon logo header on every page", () => {
    const { container } = render(
      <PrintView template={template} values={filledValues()} status="draft" serialNo={null} />,
    );
    expect(container.querySelectorAll(".print-logo")).toHaveLength(5);
    expect(screen.getAllByAltText("Kenyon")).toHaveLength(5);
  });

  it("shows the footer serial and status", () => {
    render(
      <PrintView
        template={template}
        values={filledValues()}
        status="draft"
        serialNo="AMK3-HLT-0007"
      />,
    );
    expect(screen.getAllByText("AMK3-HLT-0007").length).toBe(5);
    expect(screen.getAllByText(/HLT · Rev A/).length).toBe(5);
  });

  it("watermarks every page DRAFT unless accepted", () => {
    const draft = render(
      <PrintView template={template} values={filledValues()} status="draft" serialNo={null} />,
    );
    expect(draft.container.querySelectorAll(".print-watermark")).toHaveLength(5);
    draft.unmount();

    const accepted = render(
      <PrintView template={template} values={filledValues()} status="accepted" serialNo="AMK3-HLT-0007" />,
    );
    expect(accepted.container.querySelectorAll(".print-watermark")).toHaveLength(0);
  });

  it("renders values as plain text — interpolated steps and the selected result", () => {
    render(
      <PrintView template={template} values={filledValues()} status="draft" serialNo={null} />,
    );
    expect(screen.getByText("ITR-042")).toBeInTheDocument();
    expect(
      screen.getByText(/keypad set point to 30°C to disable cooling/),
    ).toBeInTheDocument();
    expect(screen.getByText("N.A.")).toBeInTheDocument();
  });

  it("prints the sign-off roles from the template", () => {
    render(
      <PrintView template={template} values={filledValues()} status="draft" serialNo={null} />,
    );
    expect(screen.getByText("Inspection / Tested by")).toBeInTheDocument();
    expect(screen.getByText("Witnessed by")).toBeInTheDocument();
  });
});
