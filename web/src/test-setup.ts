import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// globals: false, so Testing Library's auto-cleanup isn't registered — do it here.
afterEach(cleanup);
