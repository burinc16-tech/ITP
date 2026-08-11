import { describe, it, expect } from "vitest";
import {
  isDynamicTableSection,
  parseTemplate,
  type DynamicTableSection,
} from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import fcuRaw from "../../../spec/templates/fcu-supply-fresh-air-measurement.json";
import {
  addChecklistRow,
  addTableColumn,
  addTableRow,
  columnsFor,
  emptyValues,
  removeTableColumn,
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

/**
 * Engineer-added columns (SPEC §12) — the air-measurement sheets, where the
 * number of test points across a duct is decided at the duct. Exercised against
 * the FCU template, whose supply table starts at seven and allows more.
 */
describe("column mutations", () => {
  const fcu = parseTemplate(fcuRaw);
  const supply = (): DynamicTableSection => {
    const s = fcu.sections.find((x) => x.id === "supply_readings");
    if (!s || !isDynamicTableSection(s)) throw new Error("no supply_readings");
    return s;
  };

  it("falls back to the template's columns before anything is changed", () => {
    const values = emptyValues(fcu);
    const cols = columnsFor(values, supply());
    expect(cols).toHaveLength(7);
    expect(cols[0]!.label).toBe("Test Point 1");
    expect(cols[6]!.label).toBe("Test Point 7");
  });

  it("adds a column with a fresh id and the next heading", () => {
    const values = emptyValues(fcu);
    const next = addTableColumn(values, supply());
    const cols = columnsFor(next, supply());
    expect(cols).toHaveLength(8);
    expect(cols[7]!.label).toBe("Test Point 8");
    expect(cols[7]!.unit).toBe("m/s");
    expect(columnsFor(values, supply())).toHaveLength(7); // original untouched
  });

  it("renumbers the headings when a middle column goes, keeping ids stable", () => {
    let values = emptyValues(fcu);
    values = setTableCell(values, "supply_readings", 0, "tp4", "7.21");

    const next = removeTableColumn(values, supply(), "tp3");
    const cols = columnsFor(next, supply());

    expect(cols).toHaveLength(6);
    // What was tp4 is now headed "Test Point 3"...
    expect(cols[2]!.id).toBe("tp4");
    expect(cols[2]!.label).toBe("Test Point 3");
    // ...and its reading travelled with the id, not the heading.
    expect(next.tables.supply_readings![0]!.tp4).toBe("7.21");
  });

  it("drops the deleted column's readings", () => {
    let values = emptyValues(fcu);
    values = setTableCell(values, "supply_readings", 0, "tp3", "6.52");

    const next = removeTableColumn(values, supply(), "tp3");

    expect(next.tables.supply_readings![0]!.tp3).toBeUndefined();
  });

  it("never deletes below min_count", () => {
    let values = emptyValues(fcu);
    for (const id of ["tp1", "tp2", "tp3", "tp4", "tp5", "tp6"]) {
      values = removeTableColumn(values, supply(), id);
    }
    expect(columnsFor(values, supply())).toHaveLength(1);

    const refused = removeTableColumn(values, supply(), "tp7");
    expect(columnsFor(refused, supply())).toHaveLength(1);
  });

  it("does not reuse the id of a deleted column", () => {
    // Delete two, add one: the new id must not collide with a surviving column.
    let values = removeTableColumn(emptyValues(fcu), supply(), "tp7");
    values = removeTableColumn(values, supply(), "tp6");
    const next = addTableColumn(values, supply());
    const ids = columnsFor(next, supply()).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves a table without add_columns on its template columns", () => {
    const values = emptyValues(template);
    const before = columnsFor(values, table("sec_1"));
    const after = addTableColumn(values, table("sec_1"));
    expect(columnsFor(after, table("sec_1"))).toEqual(before);
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
