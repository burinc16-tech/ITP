import { describe, it, expect } from "vitest";
import { evaluateLimit, toNumber } from "./evaluate";

describe("evaluateLimit", () => {
  it("passes a value inside a min/max band", () => {
    expect(evaluateLimit(22, { min: 18, max: 27 })).toBe("pass");
  });

  it("fails below min and above max", () => {
    expect(evaluateLimit(17, { min: 18, max: 27 })).toBe("fail");
    expect(evaluateLimit(28, { min: 18, max: 27 })).toBe("fail");
  });

  it("treats bounds as inclusive", () => {
    expect(evaluateLimit(18, { min: 18, max: 27 })).toBe("pass");
    expect(evaluateLimit(27, { min: 18, max: 27 })).toBe("pass");
  });

  it("honours a max-only limit (e.g. supply air temp ≤ 24)", () => {
    expect(evaluateLimit(24, { max: 24 })).toBe("pass");
    expect(evaluateLimit(24.1, { max: 24 })).toBe("fail");
  });

  it("honours a min-only limit", () => {
    expect(evaluateLimit(40, { min: 40 })).toBe("pass");
    expect(evaluateLimit(39, { min: 40 })).toBe("fail");
  });

  it("returns null when there is nothing to judge", () => {
    expect(evaluateLimit(null, { max: 24 })).toBeNull();
    expect(evaluateLimit(Number.NaN, { max: 24 })).toBeNull();
  });
});

describe("toNumber", () => {
  it("parses a numeric string", () => {
    expect(toNumber("23")).toBe(23);
    expect(toNumber(" 23.5 ")).toBe(23.5);
    expect(toNumber("-2")).toBe(-2);
  });

  it("returns null for empty or non-numeric input", () => {
    expect(toNumber("")).toBeNull();
    expect(toNumber("   ")).toBeNull();
    expect(toNumber("abc")).toBeNull();
  });
});
