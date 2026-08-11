import { describe, it, expect } from "vitest";
import {
  createEquipment,
  createProject,
  createSystem,
} from "../data/registry";
import {
  backupFilename,
  buildBackup,
  countsOf,
  describeCounts,
  parseBackup,
} from "./registry-backup";

const NOW = "2026-08-10T03:22:00.000Z";

function sample() {
  return {
    projects: [
      createProject({ id: "p1", now: NOW, code: "AMK3", name: "AMK", client: "Apple" }),
    ],
    systems: [createSystem({ id: "s1", projectId: "p1", name: "ACMV", code: "A" })],
    equipment: [
      createEquipment({ id: "e1", projectId: "p1", systemId: "s1", tag: "AHU-B-102" }),
    ],
    now: NOW,
  };
}

describe("registry backup", () => {
  it("round-trips the whole registry through a file", () => {
    const backup = buildBackup(sample());
    const restored = parseBackup(JSON.stringify(backup));
    expect(restored).toEqual(backup);
    expect(restored.projects[0]!.name).toBe("AMK");
    expect(restored.equipment[0]!.tag).toBe("AHU-B-102");
  });

  it("names the file by the day it was exported", () => {
    expect(backupFilename(NOW)).toBe("itp-itr-registry-2026-08-10.json");
  });

  it("counts and describes what a backup holds", () => {
    const counts = countsOf(buildBackup(sample()));
    expect(counts).toEqual({ projects: 1, systems: 1, equipment: 1 });
    expect(describeCounts(counts)).toBe("1 project, 1 system, 1 equipment tag");
    expect(describeCounts({ projects: 2, systems: 0, equipment: 34 })).toBe(
      "2 projects, 0 systems, 34 equipment tags",
    );
  });

  it("rejects a file that is not JSON, saying which file to pick", () => {
    expect(() => parseBackup("not json at all")).toThrow(/Export registry/);
  });

  it("rejects JSON that is not a backup from this app", () => {
    expect(() => parseBackup(JSON.stringify({ hello: "world" }))).toThrow(
      /registry backup from this app/,
    );
    // A record export, say — right app, wrong file.
    expect(() =>
      parseBackup(JSON.stringify({ format: "itp-itr-records", version: 1 })),
    ).toThrow(/registry backup from this app/);
  });

  it("rejects a backup whose entities are malformed rather than importing junk", () => {
    const backup = buildBackup(sample()) as unknown as Record<string, unknown>;
    const broken = {
      ...backup,
      projects: [{ id: "p1", code: "AMK3" }], // missing name/status/…
    };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow();
  });

  it("rejects a future format version rather than guessing at it", () => {
    const backup = buildBackup(sample());
    expect(() => parseBackup(JSON.stringify({ ...backup, version: 2 }))).toThrow();
  });
});
