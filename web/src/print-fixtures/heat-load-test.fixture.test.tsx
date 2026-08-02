import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { PrintView } from "../components/print-view";
import { heatLoadTestFixture } from "./heat-load-test.fixture";

const template = parseTemplate(rawTemplate);

describe("heatLoadTestFixture", () => {
  const v = heatLoadTestFixture(template);

  it("overlays header values, keeping seeded defaults", () => {
    expect(v.header.project).toBe("L-4, APPLE @ AMK-3");
    expect(v.header.insp_date).toBe("2023-04-27"); // stored ISO
    expect(v.header.equipment).toBe("CHW-FCU-A-NR-401 & DXFCU-A-NR-401"); // seeded
  });

  it("fills the equipment, set-up, timing and log sections", () => {
    expect(v.tables.sec_1![0]!.cal_cert).toBe("KEN-CAL-2301-8842");
    expect(v.rows.s2_01).toEqual({ value: "pass", remarks: "" });
    expect(v.rows.s2_02!.remarks).toMatch(/TAB report/);
    expect(v.rows.s3_16!.value).toBe("20:15");
    expect(v.tables.sec_4![0]!.temp).toBe("23.1");
  });
});

describe("static print output (server-rendered PrintView)", () => {
  const html = renderToStaticMarkup(
    <PrintView
      template={template}
      values={heatLoadTestFixture(template)}
      status="accepted"
      serialNo="AMK3-HLT-0007"
    />,
  );

  it("is fully static — no inputs, no scripts, no interactivity", () => {
    expect(html).not.toMatch(/<input/i);
    expect(html).not.toMatch(/<textarea/i);
    expect(html).not.toMatch(/<select/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/contenteditable/i);
  });

  it("is self-contained and A4 landscape (mm units, embedded logo)", () => {
    expect(html).toContain("@page { size: A4 landscape; margin: 0; }");
    expect(html).toContain('data-orientation="landscape"');
    expect(html).toContain("data:image/jpeg;base64,"); // logo embedded
  });

  it("renders fixture values as plain text, dates as dd/mm/yyyy", () => {
    expect(html).toContain("L-4, APPLE @ AMK-3");
    expect(html).toContain("27/04/2023"); // ISO formatted for display
    expect(html).toContain("KEN-CAL-2301-8842");
    expect(html).toContain("End of test");
  });

  it("omits the DRAFT watermark for an accepted record", () => {
    expect(html).not.toContain("print-watermark");
  });

  it("carries the footer serial and page numbering", () => {
    expect(html).toContain("AMK3-HLT-0007");
    expect(html).toContain("Page 1 of 5");
    expect(html).toContain("Page 5 of 5");
  });
});
