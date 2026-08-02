import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/power-turn-on.json";
import { emptyValues, setRowValue } from "../lib/values";
import { PrintView } from "./print-view";

const template = parseTemplate(rawTemplate);

function filled() {
  let v = emptyValues(template);
  v = setRowValue(v, "re_el1", "150"); // an insulation reading
  v = setRowValue(v, "p2_pre_1", "yes"); // a status row selection
  return v;
}

describe("PrintView — Power Turn-on multi-page pagination", () => {
  it("paginates on page_break_before into three pages (no footer)", () => {
    render(
      <PrintView
        template={template}
        values={filled()}
        status="draft"
        serialNo="AMK3-PTO-0003"
      />,
    );
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(screen.queryByText("Page 4 of 3")).toBeNull();
  });

  it("keeps a page-1 section on page 1 and a page-3 section on page 3", () => {
    const { container } = render(
      <PrintView template={template} values={filled()} status="draft" serialNo={null} />,
    );
    const pages = container.querySelectorAll(".print-page");
    expect(pages).toHaveLength(3);
    expect(pages[0]!.textContent).toContain("Insulation Test");
    expect(pages[0]!.textContent).toContain("Sign-off — Test Sheet");
    expect(pages[2]!.textContent).toContain("Cable Termination Checklist");
  });

  it("prints matrix point labels and the entered reading", () => {
    render(
      <PrintView template={template} values={filled()} status="draft" serialNo={null} />,
    );
    expect(screen.getByText("Resistance to Earth (MΩ)")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
  });

  it("prints group heading rows and the status label (not the stored value)", () => {
    render(
      <PrintView template={template} values={filled()} status="draft" serialNo={null} />,
    );
    expect(screen.getByText("Pre Test")).toBeInTheDocument();
    expect(screen.getByText("Post Test")).toBeInTheDocument();
    // p2_pre_1 stored "yes" → prints the label "YES"
    expect(screen.getAllByText("YES").length).toBeGreaterThan(0);
  });

  it("prints the three sign-off blocks with their distinct roles", () => {
    render(
      <PrintView template={template} values={filled()} status="draft" serialNo={null} />,
    );
    expect(screen.getByText("Tested By")).toBeInTheDocument();
    expect(screen.getByText("Witnessed by LEW")).toBeInTheDocument();
    expect(screen.getByText("Witness by RE / RTO")).toBeInTheDocument();
  });

  it("prints portrait pages with the DRAFT watermark on each", () => {
    const { container } = render(
      <PrintView template={template} values={filled()} status="draft" serialNo={null} />,
    );
    expect(
      container.querySelectorAll('[data-orientation="portrait"]'),
    ).toHaveLength(3);
    expect(container.querySelectorAll(".print-watermark")).toHaveLength(3);
  });
});
