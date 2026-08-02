import { describe, it, expect } from "vitest";
import { dataUrlToBlob } from "./data-url";

describe("dataUrlToBlob", () => {
  it("decodes a base64 PNG data URL to a Blob of the right type and size", async () => {
    // 1x1 transparent PNG.
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const blob = dataUrlToBlob(`data:image/png;base64,${b64}`);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(atob(b64).length);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("preserves the decoded byte length and mime type", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const b64 = btoa(String.fromCharCode(...bytes));
    const blob = dataUrlToBlob(`data:application/octet-stream;base64,${b64}`);
    // jsdom's Blob has no arrayBuffer(); size + type confirm the decode ran.
    expect(blob.size).toBe(bytes.length);
    expect(blob.type).toBe("application/octet-stream");
  });

  it("rejects a string that is not a data URL", () => {
    expect(() => dataUrlToBlob("https://example.com/x.png")).toThrow();
  });
});
