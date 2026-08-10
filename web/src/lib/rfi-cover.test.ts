import { describe, it, expect } from "vitest";
import { parseTemplate } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import wallClosureRaw from "../../../spec/templates/wall-closure.json";
import powerTurnOnRaw from "../../../spec/templates/power-turn-on.json";
import { createDraft, type ChecklistRecord } from "../data/record";
import type { SignatureView } from "../data/signature";
import { emptyValues, setHeader } from "./values";
import {
  buildRfiCoverData,
  defaultCoverOptions,
  defaultDiscipline,
  formatCoverDate,
  RFI_CONTRACTOR_DEFAULT,
  RFI_DECLARATION,
  RFI_DRAWING_NO_DEFAULT,
} from "./rfi-cover";

const heatLoad = parseTemplate(heatLoadRaw);
const wallClosure = parseTemplate(wallClosureRaw);
const powerTurnOn = parseTemplate(powerTurnOnRaw);

function draftOf(template: typeof heatLoad): ChecklistRecord {
  return createDraft(template, {
    id: "rec-1",
    now: "2026-08-05T02:00:00.000Z",
    createdBy: null,
  });
}

describe("defaultDiscipline", () => {
  it("maps the template discipline onto a radio choice", () => {
    expect(defaultDiscipline(heatLoad)).toBe("acmv"); // "Mechanical"
    expect(defaultDiscipline(powerTurnOn)).toBe("electrical"); // "Electrical"
    expect(defaultDiscipline(wallClosure)).toBe("other"); // "Architectural / M&E"
  });
});

describe("formatCoverDate", () => {
  it("renders an ISO date as dd/mm/yyyy", () => {
    expect(formatCoverDate("2026-06-11")).toBe("11/06/2026");
  });

  it("renders an ISO datetime as a Singapore date only", () => {
    // 2026-08-05T02:00Z is 10:00 on 5 Aug in Asia/Singapore.
    expect(formatCoverDate("2026-08-05T02:00:00.000Z")).toBe("05/08/2026");
  });

  it("leaves an unparseable value untouched", () => {
    expect(formatCoverDate("n/a")).toBe("n/a");
  });
});

describe("defaultCoverOptions", () => {
  it("seeds project/floor/area best-effort from header fields", () => {
    let v = emptyValues(wallClosure);
    v = setHeader(v, "project", "Apple AMK2&3 BOH & Infra Structure");
    v = setHeader(v, "level_area", "Level 6&7");
    const opts = defaultCoverOptions(wallClosure, v, draftOf(wallClosure));
    expect(opts.project).toBe("Apple AMK2&3 BOH & Infra Structure");
    // "level_area" matches both the floor ("level") and area keyword.
    expect(opts.floor).toBe("Level 6&7");
    expect(opts.area).toBe("Level 6&7");
  });

  it("applies the constant contractor and drawing-no defaults", () => {
    const v = emptyValues(heatLoad);
    const opts = defaultCoverOptions(heatLoad, v, draftOf(heatLoad));
    expect(opts.contractor).toBe(RFI_CONTRACTOR_DEFAULT);
    expect(opts.drawingNo).toBe(RFI_DRAWING_NO_DEFAULT);
  });

  it("uses a filled date header field for the date, else created_at", () => {
    let v = emptyValues(heatLoad);
    v = setHeader(v, "insp_date", "2026-06-11");
    expect(defaultCoverOptions(heatLoad, v, draftOf(heatLoad)).date).toBe(
      "11/06/2026",
    );

    const blank = emptyValues(heatLoad);
    expect(defaultCoverOptions(heatLoad, blank, draftOf(heatLoad)).date).toBe(
      "05/08/2026", // falls back to created_at
    );
  });

  it("composes activity from the template title and equipment context", () => {
    const v = emptyValues(heatLoad); // 'equipment' header defaults from variables
    const opts = defaultCoverOptions(heatLoad, v, draftOf(heatLoad));
    expect(opts.activity).toContain(heatLoad.title);
    expect(opts.activity).toContain("CHW-FCU-A-NR-401");
  });

  it("takes ref from the record serial no", () => {
    const rec = { ...draftOf(heatLoad), serial_no: "ACMV-01" };
    const opts = defaultCoverOptions(heatLoad, emptyValues(heatLoad), rec);
    expect(opts.ref).toBe("ACMV-01");
  });
});

describe("buildRfiCoverData", () => {
  const options = defaultCoverOptions(
    heatLoad,
    emptyValues(heatLoad),
    draftOf(heatLoad),
  );

  it("includes the declaration verbatim", () => {
    const data = buildRfiCoverData(heatLoad, new Map(), options);
    expect(data.declaration).toBe(RFI_DECLARATION);
  });

  it("has no contractor sign-off when no signature is captured", () => {
    const data = buildRfiCoverData(heatLoad, new Map(), options);
    expect(data.contractorSignOff).toBeNull();
  });

  it("derives the contractor sign-off from the contractor-stage signature", () => {
    // heat-load's contractor-stage slot is "sig_tested".
    const captured: SignatureView = {
      slot_id: "sig_tested",
      role: "Inspection / Tested by",
      name: "Burin",
      company: "Kenyon Pte Ltd",
      method: "on_device",
      signed_at: "2026-07-03T02:00:00.000Z",
      image_url: "blob:sig",
    };
    const map = new Map([["sig_tested", captured]]);
    const data = buildRfiCoverData(heatLoad, map, options);
    expect(data.contractorSignOff).toEqual({
      name: "Burin",
      date: "03/07/2026",
      imageUrl: "blob:sig",
    });
  });
});
