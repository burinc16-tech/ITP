import { describe, it, expect } from "vitest";
import { parseTemplate, type Template } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import powerTurnOnRaw from "../../../spec/templates/power-turn-on.json";
import { createDraft, type ChecklistRecord } from "../data/record";
import { uuidv7 } from "../data/uuidv7";
import { emptyValues } from "./values";
import { outstandingItems, outstandingRows } from "./outstanding";

const heatLoad = parseTemplate(heatLoadRaw);
const powerTurnOn = parseTemplate(powerTurnOnRaw);
const templates = [heatLoad, powerTurnOn];

describe("outstandingRows", () => {
  it("flags a three-state row set to Fail, and ignores Pass/NA", () => {
    const values = emptyValues(heatLoad);
    values.rows.s2_01 = { value: "fail", remarks: "load bank short" };
    values.rows.s2_02 = { value: "pass", remarks: "" };
    values.rows.s2_03 = { value: "na", remarks: "" };

    const rows = outstandingRows(heatLoad, values);
    const ids = rows.map((r) => r.row_id);
    expect(ids).toContain("s2_01");
    expect(ids).not.toContain("s2_02");
    expect(ids).not.toContain("s2_03");
    // Display uses the template's own word for the fail state ("No").
    expect(rows.find((r) => r.row_id === "s2_01")?.display).toBe("No");
    expect(rows.find((r) => r.row_id === "s2_01")?.remarks).toBe("load bank short");
  });

  it("flags a matrix point outside its limit and a status row with a fail outcome", () => {
    const values = emptyValues(powerTurnOn);
    values.rows.re_el1 = { value: "0.5", remarks: "" }; // section limit min 1 MΩ
    values.rows.phase_rot = { value: "no", remarks: "" }; // outcome fail

    const rows = outstandingRows(powerTurnOn, values);
    const ids = rows.map((r) => r.row_id);
    expect(ids).toContain("re_el1");
    expect(ids).toContain("phase_rot");
    expect(rows.find((r) => r.row_id === "re_el1")?.display).toBe("0.5 MΩ");
  });

  it("does not flag a matrix point within its limit", () => {
    const values = emptyValues(powerTurnOn);
    values.rows.re_el1 = { value: "5", remarks: "" };
    expect(outstandingRows(powerTurnOn, values).map((r) => r.row_id)).not.toContain("re_el1");
  });
});

function record(over: Partial<ChecklistRecord>, fail = false): ChecklistRecord {
  const base = createDraft(heatLoad, { id: uuidv7(), now: "2026-08-02T00:00:00.000Z", createdBy: "u" });
  if (fail) base.values.rows.s2_01 = { value: "fail", remarks: "" };
  return { ...base, ...over };
}

describe("outstandingItems", () => {
  it("collects fails from non-draft head records and skips drafts", () => {
    const draftWithFail = record({ status: "draft" }, true);
    const completedWithFail = record({ status: "completed" }, true);
    const items = outstandingItems([draftWithFail, completedWithFail], templates);
    const recordIds = new Set(items.map((i) => i.record_id));
    expect(recordIds.has(completedWithFail.id)).toBe(true);
    expect(recordIds.has(draftWithFail.id)).toBe(false);
  });

  it("clears an item once a later revision records the row as not-failing", () => {
    const rev1 = record({ status: "rejected", rev: 1 }, true);
    const rev2 = record({ status: "completed", rev: 2, supersedes: rev1.id }, false);
    // rev2 (the head) has s2_01 unset, so the fail from rev1 no longer stands.
    const items = outstandingItems([rev1, rev2], templates);
    expect(items).toHaveLength(0);
  });
});
