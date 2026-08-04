import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom doesn't implement the object-URL APIs the signature and photo thumbnails
// rely on; stub them so blob-backed images render in tests.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
}

// globals: false, so Testing Library's auto-cleanup isn't registered — do it here.
afterEach(cleanup);
