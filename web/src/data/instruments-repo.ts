import type { ChecklistDb } from "./db";
import type { Instrument } from "./instrument";

/**
 * Local persistence for the calibration register (SPEC §4, §10 screen 9).
 * Reference data managed by a Project Admin (§9): writes are upserts keyed by
 * client id, like the project registry and unlike the append-only evidence stores.
 */
export class InstrumentsRepo {
  constructor(private readonly db: ChecklistDb) {}

  async add(instrument: Instrument): Promise<void> {
    await this.db.instruments.put(instrument);
  }

  async get(id: string): Promise<Instrument | undefined> {
    return this.db.instruments.get(id);
  }

  async list(): Promise<Instrument[]> {
    return this.db.instruments.toArray();
  }

  async remove(id: string): Promise<void> {
    await this.db.instruments.delete(id);
  }
}
