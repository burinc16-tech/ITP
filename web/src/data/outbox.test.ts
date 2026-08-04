import { describe, it, expect } from "vitest";
import { ChecklistDb } from "./db";
import { OutboxRepo, backoffMs } from "./outbox";
import { uuidv7 } from "./uuidv7";

function repo(): OutboxRepo {
  return new OutboxRepo(new ChecklistDb(`test-${uuidv7()}`));
}

const T0 = "2026-08-02T00:00:00.000Z";
const T1 = "2026-08-02T00:00:01.000Z";

describe("backoffMs", () => {
  it("is exponential from 1s, capped at 5 minutes", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(1_000);
    expect(backoffMs(2)).toBe(2_000);
    expect(backoffMs(3)).toBe(4_000);
    expect(backoffMs(50)).toBe(300_000); // capped
  });
});

describe("OutboxRepo", () => {
  it("enqueues a pending push and counts it", async () => {
    const r = repo();
    await r.enqueue("record", "rec-1", T0);
    expect(await r.pendingCount()).toBe(1);
    const [e] = await r.due(T0);
    expect(e).toMatchObject({
      id: "record:rec-1",
      kind: "record",
      target_id: "rec-1",
      enqueued_at: T0,
      attempts: 0,
      last_error: null,
    });
  });

  it("coalesces a re-enqueue onto one row, keeping the original enqueued_at", async () => {
    const r = repo();
    await r.enqueue("record", "rec-1", T0);
    await r.enqueue("record", "rec-1", T1);
    expect(await r.pendingCount()).toBe(1);
    const [e] = await r.due(T1);
    expect(e!.enqueued_at).toBe(T0); // waited since T0, position preserved
  });

  it("due() is oldest-first and respects the backoff gate", async () => {
    const r = repo();
    await r.enqueue("record", "old", T0);
    await r.enqueue("audit", "new", T1);

    const due = await r.due(T1);
    expect(due.map((e) => e.target_id)).toEqual(["old", "new"]);

    await r.reschedule(due[0]!, T1, "offline"); // pushes "old" into the future
    expect((await r.due(T1)).map((e) => e.target_id)).toEqual(["new"]);
  });

  it("reschedule increments attempts, records the error, and backs off", async () => {
    const r = repo();
    await r.enqueue("record", "rec-1", T0);
    const [e] = await r.due(T0);
    await r.reschedule(e!, T0, "offline");

    const [after] = await r.all();
    expect(after!.attempts).toBe(1);
    expect(after!.last_error).toBe("offline");
    expect(new Date(after!.next_attempt_at).getTime()).toBe(new Date(T0).getTime() + 1_000);
  });

  it("remove drops the entry", async () => {
    const r = repo();
    await r.enqueue("record", "rec-1", T0);
    await r.remove("record:rec-1");
    expect(await r.pendingCount()).toBe(0);
  });
});
