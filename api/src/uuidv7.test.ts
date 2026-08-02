import { describe, it, expect } from "vitest";
import { uuidv7 } from "./uuidv7";

const UUIDV7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidv7 (server)", () => {
  it("produces a well-formed v7 uuid (version 7, variant 10xx)", () => {
    expect(uuidv7()).toMatch(UUIDV7);
  });

  it("is unique across many calls", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => uuidv7()));
    expect(ids.size).toBe(5000);
  });

  it("sorts lexicographically by creation time", () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_000_001);
    expect(earlier < later).toBe(true);
  });

  it("encodes the timestamp in the leading bytes", () => {
    const id = uuidv7(1_700_000_000_000);
    expect(id.slice(0, 8)).toBe((1_700_000_000_000).toString(16).padStart(12, "0").slice(0, 8));
  });
});
