import type { ChecklistDb } from "./db";
import type { Instrument } from "./instrument";
import type { SyncLayer } from "./sync";

/** Epoch stand-in for rows written before the register carried `updated_at`. */
const NEVER = "";

/**
 * Local persistence for the calibration register (SPEC §4, §10 screen 9).
 * Reference data managed by a Project Admin (§9): writes are upserts keyed by
 * client id, like the project registry and unlike the append-only evidence stores.
 *
 * Writes go to Dexie first and are pushed afterwards (Hard Rule #1) — the push is
 * best-effort, so the register keeps working with no network and the row is
 * durable either way. `syncDown` merges the server's copy in, which is what makes
 * a register built on one device visible on the next.
 */
export class InstrumentsRepo {
  constructor(
    private readonly db: ChecklistDb,
    private readonly sync?: SyncLayer,
  ) {}

  async add(instrument: Instrument): Promise<void> {
    const row: Instrument = {
      ...instrument,
      updated_at: instrument.updated_at ?? new Date().toISOString(),
      deleted: instrument.deleted ?? false,
    };
    await this.db.instruments.put(row);
    await this.sync?.pushInstrument(row);
  }

  async get(id: string): Promise<Instrument | undefined> {
    const row = await this.db.instruments.get(id);
    return row?.deleted ? undefined : row;
  }

  async list(): Promise<Instrument[]> {
    const rows = await this.db.instruments.toArray();
    return rows.filter((r) => !r.deleted);
  }

  /**
   * Remove an instrument. Kept as a tombstone rather than deleted outright: the
   * removal has to reach the other devices, and a row erased locally has nothing
   * left to push.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.db.instruments.get(id);
    if (!existing) return;
    const tombstone: Instrument = {
      ...existing,
      deleted: true,
      updated_at: new Date().toISOString(),
    };
    await this.db.instruments.put(tombstone);
    await this.sync?.pushInstrument(tombstone);
  }

  /**
   * Merge the server's register into the local one, newest edit winning per row,
   * then push back anything the server has not seen. Best-effort: with no sync
   * layer or no network it is a no-op and the local register is unchanged.
   */
  async syncDown(): Promise<void> {
    if (!this.sync) return;
    const remote = await this.sync.pullInstruments();
    if (!remote) return;

    const local = new Map((await this.db.instruments.toArray()).map((r) => [r.id, r]));

    for (const row of remote) {
      const mine = local.get(row.id);
      if (!mine || (mine.updated_at ?? NEVER) < (row.updated_at ?? NEVER)) {
        await this.db.instruments.put(row);
        local.set(row.id, row);
      }
    }

    // Anything local that the server does not have, or has an older copy of, is a
    // row typed while offline (or before the register synced at all) — push it up.
    const remoteById = new Map(remote.map((r) => [r.id, r]));
    for (const mine of local.values()) {
      const theirs = remoteById.get(mine.id);
      if (!theirs || (theirs.updated_at ?? NEVER) < (mine.updated_at ?? NEVER)) {
        await this.sync.pushInstrument(mine);
      }
    }
  }
}
