import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { publishPending } from "../data/sync";
import type { SyncStatusSource } from "../data/sync-queue";
import { SyncStatus } from "./sync-status";

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

/** A source whose count is scripted call-by-call, plus a spyable drain. */
function source(counts: number[]): SyncStatusSource & { drain: ReturnType<typeof vi.fn> } {
  let i = 0;
  return {
    pendingCount: async () => counts[Math.min(i++, counts.length - 1)]!,
    drain: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => {
  setOnline(true);
});

describe("SyncStatus", () => {
  it("shows an all-clear status (not a button) when nothing is pending", async () => {
    render(<SyncStatus source={source([0])} />);
    expect(await screen.findByText("All synced")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a count and retries on click when online with a backlog", async () => {
    const user = userEvent.setup();
    const src = source([2]);
    render(<SyncStatus source={src} />);

    const btn = await screen.findByRole("button", { name: /2 pending sync\. Retry now\./ });
    await user.click(btn);
    expect(src.drain).toHaveBeenCalledOnce();
  });

  it("re-reads the count when the outbox changes", async () => {
    render(<SyncStatus source={source([1, 0])} />);
    expect(await screen.findByText("1 pending sync")).toBeInTheDocument();

    await act(async () => {
      publishPending();
    });
    expect(await screen.findByText("All synced")).toBeInTheDocument();
  });

  it("reflects offline, with the pending count", async () => {
    setOnline(false);
    render(<SyncStatus source={source([3])} />);
    expect(await screen.findByText("Offline — 3 pending")).toBeInTheDocument();
    // Offline is never a retry button — the drain would just fail.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("responds to an offline event after mount", async () => {
    render(<SyncStatus source={source([0])} />);
    await screen.findByText("All synced");

    await act(async () => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText("Offline")).toBeInTheDocument();
  });
});
