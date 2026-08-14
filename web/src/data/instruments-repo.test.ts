import { describe, it, expect } from "vitest";
import { ChecklistDb } from "./db";
import { createInstrument, type Instrument } from "./instrument";
import { InstrumentsRepo } from "./instruments-repo";
import type { SyncLayer } from "./sync";
import { uuidv7 } from "./uuidv7";

function freshRepo(): InstrumentsRepo {
  return new InstrumentsRepo(new ChecklistDb(`test-${uuidv7()}`));
}

describe("createInstrument", () => {
  it("fills blank defaults for the optional fields", () => {
    const i = createInstrument({ id: "i1", serialNo: "FLK-01", calDate: "2026-01-15", calDueDate: "2027-01-15" });
    expect(i.description).toBe("");
    expect(i.cal_cert_url).toBe("");
    expect(i.cal_due_date).toBe("2027-01-15");
  });
});

describe("InstrumentsRepo", () => {
  it("stores, gets, and lists instruments", async () => {
    const repo = freshRepo();
    const id = uuidv7();
    await repo.add(createInstrument({ id, serialNo: "FLK-01", calDate: "2026-01-15", calDueDate: "2027-01-15" }));
    await repo.add(createInstrument({ id: uuidv7(), serialNo: "HOBO-02", calDate: "2026-02-01", calDueDate: "2027-02-01" }));

    expect(await repo.list()).toHaveLength(2);
    expect((await repo.get(id))?.serial_no).toBe("FLK-01");
  });

  it("upserts by id rather than duplicating", async () => {
    const repo = freshRepo();
    const id = uuidv7();
    await repo.add(createInstrument({ id, serialNo: "FLK-01", calDate: "2026-01-15", calDueDate: "2027-01-15" }));
    await repo.add(createInstrument({ id, serialNo: "FLK-01", description: "Recalibrated", calDate: "2027-01-16", calDueDate: "2028-01-16" }));

    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.description).toBe("Recalibrated");
    expect(all[0]!.cal_due_date).toBe("2028-01-16");
  });

  it("removes an instrument", async () => {
    const repo = freshRepo();
    const id = uuidv7();
    await repo.add(createInstrument({ id, serialNo: "FLK-01", calDate: "2026-01-15", calDueDate: "2027-01-15" }));
    await repo.remove(id);
    expect(await repo.list()).toHaveLength(0);
  });
});

/**
 * Register sync (SPEC §10 screen 9). The register used to live only in the
 * browser that typed it — no route, no table — so one built in the office was
 * invisible on site. These cover the merge rules that make it travel.
 */
describe("InstrumentsRepo sync", () => {
  const sample = (id: string, serial: string, updatedAt: string): Instrument => ({
    ...createInstrument({ id, serialNo: serial, calDate: "2026-01-15", calDueDate: "2027-01-15" }),
    updated_at: updatedAt,
  });

  function fakeSync(remote: Instrument[] | null) {
    const pushed: Instrument[] = [];
    const sync = {
      pushInstrument: async (i: Instrument) => {
        pushed.push(i);
      },
      pullInstruments: async () => remote,
    } as unknown as SyncLayer;
    return { sync, pushed };
  }

  it("pushes an added instrument after the local write", async () => {
    const { sync, pushed } = fakeSync([]);
    const repo = new InstrumentsRepo(new ChecklistDb(`test-${uuidv7()}`), sync);
    const id = uuidv7();

    await repo.add(createInstrument({ id, serialNo: "FLK-01", calDate: "2026-01-15", calDueDate: "2027-01-15" }));

    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.id).toBe(id);
    // Durable locally regardless of what the network did.
    expect(await repo.get(id)).toBeDefined();
  });

  it("keeps a remove as a tombstone so the delete can travel", async () => {
    const { sync, pushed } = fakeSync([]);
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new InstrumentsRepo(db, sync);
    const id = uuidv7();
    await repo.add(createInstrument({ id, serialNo: "FLK-01", calDate: "2026-01-15", calDueDate: "2027-01-15" }));

    await repo.remove(id);

    expect(await repo.list()).toHaveLength(0);
    expect(await repo.get(id)).toBeUndefined();
    // The row is still there, flagged — a hard delete would have nothing to push.
    expect(await db.instruments.get(id)).toMatchObject({ deleted: true });
    expect(pushed.at(-1)).toMatchObject({ id, deleted: true });
  });

  it("merges the server's newer edit in and leaves the older one alone", async () => {
    const id = uuidv7();
    const { sync } = fakeSync([
      { ...sample(id, "FLK-01-RECAL", "2026-06-01T00:00:00.000Z"), description: "server" },
    ]);
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new InstrumentsRepo(db, sync);
    await db.instruments.put(sample(id, "FLK-01", "2026-01-01T00:00:00.000Z"));

    await repo.syncDown();

    expect((await repo.get(id))?.serial_no).toBe("FLK-01-RECAL");
  });

  it("does not let a stale server copy clobber a newer local edit", async () => {
    const id = uuidv7();
    const { sync, pushed } = fakeSync([sample(id, "OLD", "2026-01-01T00:00:00.000Z")]);
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new InstrumentsRepo(db, sync);
    await db.instruments.put(sample(id, "NEW", "2026-06-01T00:00:00.000Z"));

    await repo.syncDown();

    expect((await repo.get(id))?.serial_no).toBe("NEW");
    // ...and the newer local row is pushed up so the server catches up.
    expect(pushed.at(-1)).toMatchObject({ id, serial_no: "NEW" });
  });

  it("pushes rows the server has never seen", async () => {
    const { sync, pushed } = fakeSync([]);
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new InstrumentsRepo(db, sync);
    const id = uuidv7();
    // A row typed before the register synced at all — no updated_at.
    await db.instruments.put({
      id,
      serial_no: "PRE-SYNC",
      description: "",
      cal_cert_url: "",
      cal_date: "",
      cal_due_date: "2027-01-15",
    });

    await repo.syncDown();

    expect(pushed.map((p) => p.id)).toContain(id);
  });

  it("is a no-op when the server cannot be read", async () => {
    const { sync, pushed } = fakeSync(null);
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new InstrumentsRepo(db, sync);
    await db.instruments.put(sample(uuidv7(), "LOCAL", "2026-01-01T00:00:00.000Z"));

    await repo.syncDown();

    expect(pushed).toHaveLength(0);
    expect(await repo.list()).toHaveLength(1);
  });
});
