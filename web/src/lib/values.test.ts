import { describe, it, expect } from "vitest";
import {
  isDynamicTableSection,
  parseTemplate,
  type DynamicTableSection,
} from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import {
  addChecklistRow,
  addTableRow,
  emptyValues,
  removeChecklistRow,
  setAddedRowField,
  setTableCell,
  removeTableRow,
  setRowValue,
} from "./values";

const template = parseTemplate(rawTemplate);

function table(id: string): DynamicTableSection {
  const section = template.sections.find((s) => s.id === id);
  if (!section || !isDynamicTableSection(section)) {
    throw new Error(`no dynamic table ${id}`);
  }
  return section;
}

describe("emptyValues", () => {
  const values = emptyValues(template);

  it("seeds variables from their defaults, as strings", () => {
    expect(values.variables.load_kw).toBe("6");
    expect(values.variables.fcu_chw).toBe("CHW-FCU-A-NR-401");
  });

  it("seeds header fields from default_from, interpolated", () => {
    expect(values.header.equipment).toBe(
      "CHW-FCU-A-NR-401 & DXFCU-A-NR-401",
    );
  });

  it("leaves header fields with no default empty", () => {
    expect(values.header.doc_no).toBe("");
  });

  it("initialises every standard row blank", () => {
    expect(values.rows.s2_01).toEqual({ value: "", remarks: "" });
  });

  it("keeps prefilled table rows and pads up to min_rows", () => {
    const sec1 = values.tables.sec_1!;
    expect(sec1).toHaveLength(4); // 2 prefilled + padded to min_rows: 4
    expect(sec1[0]!.make_model).toBe("EH-ND11-A");
    expect(sec1[2]!.make_model).toBe(""); // padded row is blank
  });
});

describe("table mutations", () => {
  // sec_1 (TESTING EQUIPMENT) is the template's only dynamic table: min_rows 4,
  // seeded with 2 prefilled rows padded to 4.
  it("adds a blank row", () => {
    const values = emptyValues(template);
    const next = addTableRow(values, table("sec_1"));
    expect(next.tables.sec_1).toHaveLength(5);
    expect(values.tables.sec_1).toHaveLength(4); // original untouched
  });

  it("removes a row but never below min_rows", () => {
    const values = emptyValues(template);
    const atMin = removeTableRow(values, table("sec_1"), 0);
    expect(atMin.tables.sec_1).toHaveLength(4); // refused

    const grown = addTableRow(values, table("sec_1"));
    const shrunk = removeTableRow(grown, table("sec_1"), 0);
    expect(shrunk.tables.sec_1).toHaveLength(4); // allowed back down to min
  });

  it("sets a cell immutably", () => {
    const values = emptyValues(template);
    const next = setTableCell(values, "sec_1", 3, "remarks", "27");
    expect(next.tables.sec_1![3]!.remarks).toBe("27");
    expect(values.tables.sec_1![3]!.remarks).toBe("");
  });
});

describe("row mutations", () => {
  it("sets a row value without dropping remarks", () => {
    const values = emptyValues(template);
    const next = setRowValue(values, "s2_01", "na");
    expect(next.rows.s2_01).toEqual({ value: "na", remarks: "" });
  });
});

describe("ad-hoc appended rows", () => {
  it("appends a blank row carrying the caller-supplied id", () => {
    const values = emptyValues(template);
    const next = addChecklistRow(values, "pre_test", "row-a");
    expect(next.added.pre_test).toEqual([
      { id: "row-a", no: "", group: "", description: "", value: "", remarks: "" },
    ]);
    expect(values.added.pre_test).toBeUndefined(); // original untouched
  });

  it("uses the id verbatim, so distinct ids stay distinct", () => {
    const one = addChecklistRow(emptyValues(template), "pre_test", "id-1");
    const two = addChecklistRow(one, "pre_test", "id-2");
    expect(two.added.pre_test!.map((r) => r.id)).toEqual(["id-1", "id-2"]);
  });

  it("edits a field of the addressed row only", () => {
    const values = addChecklistRow(emptyValues(template), "pre_test", "row-a");
    const next = setAddedRowField(values, "pre_test", "row-a", "description", "Extra check");
    expect(next.added.pre_test![0]!.description).toBe("Extra check");
  });

  it("removes a row by id", () => {
    const a = addChecklistRow(emptyValues(template), "pre_test", "row-a");
    const b = addChecklistRow(a, "pre_test", "row-b");
    const next = removeChecklistRow(b, "pre_test", "row-a");
    expect(next.added.pre_test!.map((r) => r.id)).toEqual(["row-b"]);
  });
});
