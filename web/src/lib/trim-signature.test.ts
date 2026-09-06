import { afterEach, describe, it, expect, vi } from "vitest";
import { inkBounds, trimSignature } from "./trim-signature";

/** RGBA buffer of a white-backed image with the given dark pixels set. */
function pixels(width: number, height: number, ink: Array<[number, number, number?]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x, y, shade = 0] of ink) {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = shade;
  }
  return data;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inkBounds", () => {
  it("returns null for a blank white image", () => {
    expect(inkBounds(pixels(8, 4, []), 8, 4)).toBeNull();
  });

  it("boxes the dark pixels inclusively", () => {
    const data = pixels(10, 6, [[2, 1], [7, 1], [4, 4]]);
    expect(inkBounds(data, 10, 6)).toEqual({ x: 2, y: 1, width: 6, height: 4 });
  });

  it("ignores near-white fringe and transparent pixels", () => {
    const data = pixels(10, 6, [[0, 0, 230], [5, 3]]);
    // A transparent dark pixel in the far corner does not count either.
    const i = (5 * 10 + 9) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
    data[i + 3] = 10;
    expect(inkBounds(data, 10, 6)).toEqual({ x: 5, y: 3, width: 1, height: 1 });
  });
});

describe("trimSignature", () => {
  const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

  it("returns the source unchanged when the runtime cannot decode (jsdom)", async () => {
    const src = blob();
    await expect(trimSignature(src)).resolves.toBe(src);
  });

  it("returns the source when the canvas is unavailable", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 600, height: 200, close() {} }));
    const src = blob();
    // jsdom has no 2D context, so the crop cannot run — display still works.
    await expect(trimSignature(src)).resolves.toBe(src);
  });
});
