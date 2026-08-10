import { describe, expect, it } from "vitest";
import {
  aggregateColumn,
  evaluateFormula,
  formatComputed,
  toNumber,
} from "./formula";

describe("toNumber", () => {
  it("reads numeric strings and numbers", () => {
    expect(toNumber("123")).toBe(123);
    expect(toNumber(" 4.5 ")).toBe(4.5);
    expect(toNumber(250)).toBe(250);
  });

  it("treats blank and non-numeric as not filled in", () => {
    expect(toNumber("")).toBeNull();
    expect(toNumber("   ")).toBeNull();
    expect(toNumber("n/a")).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
  });
});

describe("evaluateFormula", () => {
  it("evaluates the balanced/design percentage the VAV form computes", () => {
    expect(
      evaluateFormula("balanced / design * 100", { balanced: "123", design: "140" }),
    ).toBeCloseTo(87.857, 3);
  });

  it("honours operator precedence and parentheses", () => {
    expect(evaluateFormula("2 + 3 * 4", {})).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4", {})).toBe(20);
    expect(evaluateFormula("-(3 - 5)", {})).toBe(2);
  });

  it("propagates blank rather than defaulting a missing reading to zero", () => {
    // A Phase 2 diffuser with a design flow but no balanced reading yet.
    expect(evaluateFormula("balanced / design * 100", { balanced: "", design: "500" }))
      .toBeNull();
    expect(evaluateFormula("balanced / design * 100", { design: "500" })).toBeNull();
  });

  it("returns null on division by zero instead of Infinity", () => {
    expect(evaluateFormula("balanced / design", { balanced: "10", design: "0" }))
      .toBeNull();
  });

  it("returns null for a malformed formula rather than throwing", () => {
    expect(evaluateFormula("1 +", {})).toBeNull();
    expect(evaluateFormula("(1 + 2", {})).toBeNull();
    expect(evaluateFormula("1 2", {})).toBeNull();
    expect(evaluateFormula("", {})).toBeNull();
    expect(evaluateFormula("design $ 2", { design: "1" })).toBeNull();
  });

  it("does not reach anything outside the scope it is given", () => {
    // Identifiers resolve only through the scope object, so inherited Object
    // properties and globals are not addressable from a template formula.
    expect(evaluateFormula("constructor", {})).toBeNull();
    expect(evaluateFormula("toString", {})).toBeNull();
    expect(evaluateFormula("globalThis", {})).toBeNull();
  });
});

describe("aggregateColumn", () => {
  const column = ["140", "140", "250"];

  it("sums a column, skipping blanks", () => {
    expect(aggregateColumn("sum", column)).toBe(530);
    expect(aggregateColumn("sum", ["140", "", "250"])).toBe(390);
  });

  it("returns null for an all-blank column so the total prints empty", () => {
    expect(aggregateColumn("sum", ["", "", ""])).toBeNull();
    expect(aggregateColumn("mean", [])).toBeNull();
  });

  it("supports mean, min and max", () => {
    expect(aggregateColumn("mean", ["2", "4"])).toBe(3);
    expect(aggregateColumn("min", column)).toBe(140);
    expect(aggregateColumn("max", column)).toBe(250);
  });

  it("counts filled cells, and counts zero as filled", () => {
    expect(aggregateColumn("count", ["1", "", "3"])).toBe(2);
    expect(aggregateColumn("count", ["0"])).toBe(1);
    expect(aggregateColumn("count", ["", ""])).toBe(0);
  });
});

describe("formatComputed", () => {
  it("rounds to whole numbers and appends the unit, like the source form", () => {
    expect(formatComputed(87.857, { unit: "%" })).toBe("88%");
    expect(formatComputed(530)).toBe("530");
    expect(formatComputed(87.857, { decimals: 1, unit: "%" })).toBe("87.9%");
  });

  it("renders an unresolved value as an empty cell", () => {
    expect(formatComputed(null, { unit: "%" })).toBe("");
  });
});
