import { describe, it, expect } from "vitest";
import { createSignature, formatSignedAt } from "./signature";

describe("createSignature", () => {
  it("builds an on-device signature carrying the passed-in evidence", () => {
    const image = new Blob([new Uint8Array([1])], { type: "image/png" });
    const sig = createSignature({
      id: "sig-id",
      recordId: "rec-1",
      slotId: "sig_tested",
      role: "Tested by",
      name: "A. Engineer",
      company: "Kenyon Pte Ltd",
      image,
      signedByUser: "stub-user",
      deviceId: "device-1",
      now: "2026-08-02T02:00:00.000Z",
    });
    expect(sig).toEqual({
      id: "sig-id",
      record_id: "rec-1",
      slot_id: "sig_tested",
      role: "Tested by",
      name: "A. Engineer",
      company: "Kenyon Pte Ltd",
      image,
      method: "on_device",
      signed_by_user: "stub-user",
      device_id: "device-1",
      signed_at: "2026-08-02T02:00:00.000Z",
    });
  });
});

describe("formatSignedAt", () => {
  it("formats as dd/mm/yyyy HH:mm in Asia/Singapore (UTC+8)", () => {
    // 02:00 UTC is 10:00 in Singapore, same day.
    expect(formatSignedAt("2026-08-02T02:00:00.000Z")).toBe("02/08/2026 10:00");
  });

  it("rolls over the date across the +8 offset", () => {
    // 20:00 UTC is 04:00 next day in Singapore.
    expect(formatSignedAt("2026-08-02T20:00:00.000Z")).toBe("03/08/2026 04:00");
  });
});
