import { describe, it, expect } from "vitest";
import type { Emphasis } from "@schema";
import { parseDescription } from "./description";

const vars = { fcu_chw: "CHW-FCU-A-NR-401", load_kw: "6", disable_temp: "30" };

describe("parseDescription", () => {
  it("interpolates plain text into a single token", () => {
    expect(parseDescription("Record the temperature.", vars)).toEqual([
      { text: "Record the temperature.", bold: false },
    ]);
  });

  it("marks a **bold** span and interpolates inside it", () => {
    const tokens = parseDescription("Put **{{fcu_chw}}** keypad", vars);
    expect(tokens).toEqual([
      { text: "Put ", bold: false },
      { text: "CHW-FCU-A-NR-401", bold: true },
      { text: " keypad", bold: false },
    ]);
  });

  it("colours an emphasis run matching its interpolated text", () => {
    const emphasis: Emphasis[] = [{ text: "{{load_kw}} kW", colour: "red" }];
    const tokens = parseDescription(
      "Check {{load_kw}} kW load banks.",
      vars,
      emphasis,
    );
    expect(tokens).toEqual([
      { text: "Check ", bold: false },
      { text: "6 kW", bold: false, colour: "red" },
      { text: " load banks.", bold: false },
    ]);
  });

  it("applies both bold and colour when they overlap", () => {
    const emphasis: Emphasis[] = [{ text: "{{disable_temp}}°C", colour: "red" }];
    const tokens = parseDescription("**{{disable_temp}}°C**", vars, emphasis);
    expect(tokens).toEqual([{ text: "30°C", bold: true, colour: "red" }]);
  });
});
