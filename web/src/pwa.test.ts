import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The service worker's runtime behaviour is covered functionally in
 * sw.behavior.test.ts. These checks guard the surrounding PWA wiring — a valid,
 * installable manifest and the links that enable it.
 */
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("web manifest", () => {
  const manifest = JSON.parse(read("../../public/manifest.webmanifest")) as {
    name?: string;
    start_url?: string;
    display?: string;
    theme_color?: string;
    icons?: Array<{ src: string }>;
  };

  it("is installable — name, standalone display, start_url, an icon", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.icons?.length).toBeGreaterThan(0);
    expect(manifest.icons?.[0]?.src).toBe("/icon.svg");
  });
});

describe("index.html", () => {
  const html = read("../../index.html");

  it("links the manifest, icon, and theme colour", () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("/manifest.webmanifest");
    expect(html).toContain('rel="icon"');
    expect(html).toContain('name="theme-color"');
  });
});
