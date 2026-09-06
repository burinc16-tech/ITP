import { describe, it, expect } from "vitest";
import type { SignatureView } from "../data/signature";
import { showsDraftWatermark } from "./watermark";

const signed = (slotId: string): Map<string, SignatureView> =>
  new Map([
    [
      slotId,
      {
        slot_id: slotId,
        role: "Contractor",
        name: "B. Chotwatanakul",
        company: "Kenyon Pte Ltd",
        method: "on_device",
        signed_at: "2026-08-05T02:00:00.000Z",
        image_url: "blob:sig",
      },
    ],
  ]);

describe("showsDraftWatermark", () => {
  it("watermarks an unsigned record that is not accepted", () => {
    expect(showsDraftWatermark("draft")).toBe(true);
    expect(showsDraftWatermark("completed", new Map())).toBe(true);
    expect(showsDraftWatermark("rejected", new Map())).toBe(true);
  });

  it("drops the watermark as soon as any slot is signed", () => {
    expect(showsDraftWatermark("draft", signed("sig_contractor"))).toBe(false);
    expect(showsDraftWatermark("completed", signed("sig_engineer"))).toBe(false);
  });

  it("never watermarks an accepted record", () => {
    expect(showsDraftWatermark("accepted", new Map())).toBe(false);
    expect(showsDraftWatermark("accepted", signed("sig_contractor"))).toBe(false);
  });
});
