import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { Signature } from "@schema";
import type { SignatureView } from "../data/signature";
import { PrintSignatureGrid } from "./print-sign-off";

function slot(id: string, role: string): Signature {
  return { id, role, required: false } as Signature;
}

function signed(id: string): SignatureView {
  return {
    slot_id: id,
    role: id,
    name: "Burin Chotwatanakul",
    company: "Kenyon Pte Ltd",
    method: "on_device",
    signed_at: "2026-09-06T11:22:00.000Z",
    image_url: "blob:sig",
  };
}

describe("PrintSignatureGrid", () => {
  it("tags the grid with its column count so print.css can size 3+ columns to the sheet", () => {
    // jsdom has no layout, so the width itself is measured in a real browser
    // (memory: itp-print-fit-audit harness, 2026-09-12). This pins the hook
    // that sizing keys off: every 3-column portrait grid ran 61px past the
    // page once a long surname was captured, because the columns could not
    // shrink below the surname's min-content.
    const three = [slot("a", "Tested By"), slot("b", "Witnessed By"), slot("c", "Acknowledged By")];
    const { container } = render(
      <PrintSignatureGrid
        signatures={three}
        captured={new Map(three.map((s) => [s.id, signed(s.id)]))}
      />,
    );
    const grid = container.querySelector(".print-signoff-grid");
    expect(grid?.getAttribute("data-cols")).toBe("3");
    expect(grid?.querySelectorAll(".print-sign-col")).toHaveLength(3);
  });

  it("counts unsigned slots too — the columns print whether or not they are signed", () => {
    const { container } = render(
      <PrintSignatureGrid signatures={[slot("a", "Tested By"), slot("b", "Witnessed By")]} />,
    );
    expect(container.querySelector(".print-signoff-grid")?.getAttribute("data-cols")).toBe("2");
  });
});
