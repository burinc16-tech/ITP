import { describe, it, expect } from "vitest";
import { ChecklistDb } from "./db";
import { createInstrument } from "./instrument";
import { InstrumentsRepo } from "./instruments-repo";
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
