import { afterEach, describe, it, expect, vi } from "vitest";
import { downscaleImage } from "./downscale-image";

const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("downscaleImage", () => {
  it("returns the original unchanged when the runtime can't decode (no createImageBitmap)", async () => {
    // jsdom provides no createImageBitmap — the fallback must return the source.
    const src = blob();
    await expect(downscaleImage(src)).resolves.toBe(src);
  });

  it("leaves an image already within bounds unchanged (no re-encode)", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 800, height: 600, close() {} }));
    const src = blob();
    await expect(downscaleImage(src, { maxDim: 1600 })).resolves.toBe(src);
  });

  it("falls back to the original if the canvas is unavailable for a large image", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close() {} }));
    const src = blob();
    // jsdom has no 2D canvas context, so the downscale can't run — capture still succeeds.
    await expect(downscaleImage(src, { maxDim: 1600 })).resolves.toBe(src);
  });
});
