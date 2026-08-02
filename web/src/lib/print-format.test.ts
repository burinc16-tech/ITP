import { describe, it, expect } from "vitest";
import { formatFieldValue } from "./print-format";

describe("formatFieldValue", () => {
  it("prints the template's word for a three-state value", () => {
    const labels = ["Yes", "No", "N.A."];
    expect(formatFieldValue("pass_fail_na", "na", { labels })).toBe("N.A.");
    expect(formatFieldValue("pass_fail_na", "pass", { labels })).toBe("Yes");
  });

  it("falls back to default words when none are given", () => {
    expect(formatFieldValue("pass_fail_na", "fail")).toBe("Fail");
  });

  it("appends a unit to a number when provided", () => {
    expect(formatFieldValue("number", "23", { unit: "°C" })).toBe("23 °C");
    expect(formatFieldValue("number", "23")).toBe("23");
  });

  it("renders a checkbox as a tick or blank", () => {
    expect(formatFieldValue("checkbox", "true")).toBe("✓");
    expect(formatFieldValue("checkbox", "")).toBe("");
  });

  it("passes plain text and duration through unchanged", () => {
    expect(formatFieldValue("text", "abc")).toBe("abc");
    expect(formatFieldValue("duration", "5min 23s")).toBe("5min 23s");
  });

  it("prints an ISO date as dd/mm/yyyy", () => {
    expect(formatFieldValue("date", "2023-04-27")).toBe("27/04/2023");
    expect(formatFieldValue("date", "27/04/2023")).toBe("27/04/2023"); // already formatted
  });

  it("prints blank for an empty value", () => {
    expect(formatFieldValue("pass_fail_na", "")).toBe("");
    expect(formatFieldValue("number", "", { unit: "°C" })).toBe("");
  });
});
