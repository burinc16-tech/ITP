import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/vav-air-balancing.json";
import { emptyValues, setGroupCell, setGroupField, type RecordValues } from "../lib/values";
import { PrintView } from "./print-view";

const template = parseTemplate(rawTemplate);

/** Two VAV units, the first with three diffusers — the source form's shape. */
function filled(): RecordValues {
  let v = emptyValues(template);
  v = {
    ...v,
    groups: {
      balancing: [
        { fields: {}, rows: [{}, {}, {}] },
        { fields: {}, rows: [{}] },
      ],
    },
  };
  v = setGroupField(v, "balancing", 0, "tag", "VAV A-602-02");
  v = setGroupField(v, "balancing", 0, "velocity", "4.7");
  v = setGroupField(v, "balancing", 1, "tag", "VAV A-602-03");
  const readings: Array<[string, string]> = [
    ["140", "123"],
    ["140", "133"],
    ["250", "234"],
  ];
  readings.forEach(([design, balanced], i) => {
    v = setGroupCell(v, "balancing", 0, i, "design", design);
    v = setGroupCell(v, "balancing", 0, i, "balanced", balanced);
  });
  // The second unit is designed but not yet balanced (a Phase 2 area).
  v = setGroupCell(v, "balancing", 1, 0, "design", "500");
  return v;
}

describe("PrintView — VAV Air Balancing grouped table", () => {
  it("prints group cells spanning their diffuser rows", () => {
    const { container } = render(
      <PrintView
        template={template}
        values={filled()}
        status="draft"
        serialNo="AMK3-VAB-0001"
      />,
    );
    const groups = container.querySelectorAll(".print-group");
    expect(groups).toHaveLength(2);
    const firstTag = groups[0]!.querySelector(".print-group-cell[rowspan]")!;
    expect(firstTag.getAttribute("rowspan")).toBe("3");
  });

  it("prints a TOTAL line per unit with the summed flows and percentage", () => {
    const { container } = render(
      <PrintView template={template} values={filled()} status="draft" serialNo={null} />,
    );
    const totals = container.querySelectorAll(".print-totals-row");
    expect(totals).toHaveLength(2);
    const first = totals[0]!.textContent ?? "";
    expect(first).toContain("530"); // 140 + 140 + 250
    expect(first).toContain("490"); // 123 + 133 + 234
    expect(first).toContain("92%"); // 490 / 530
  });

  it("leaves an unbalanced unit's total and percentage blank, not 0%", () => {
    const { container } = render(
      <PrintView template={template} values={filled()} status="draft" serialNo={null} />,
    );
    const second = container.querySelectorAll(".print-totals-row")[1]!.textContent ?? "";
    expect(second).toContain("500"); // design still totals
    expect(second).not.toContain("0%");
  });

  it("prints landscape on a single page with the sign-off block", () => {
    const { container } = render(
      <PrintView template={template} values={filled()} status="draft" serialNo={null} />,
    );
    const pages = container.querySelectorAll(".print-page");
    expect(pages).toHaveLength(1);
    expect(pages[0]!.getAttribute("data-orientation")).toBe("landscape");
    expect(pages[0]!.textContent).toContain("Page 1 of 1");
    expect(screen.getByText("Tested by")).toBeInTheDocument();
  });

  it("prints a record saved before grouped tables existed without throwing", () => {
    const legacy = emptyValues(template);
    delete legacy.groups;
    const { container } = render(
      <PrintView template={template} values={legacy} status="draft" serialNo={null} />,
    );
    expect(container.querySelectorAll(".print-group")).toHaveLength(0);
    expect(container.querySelector(".print-grouped")).not.toBeNull();
  });
});
