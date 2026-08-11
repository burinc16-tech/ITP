import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  headRecords,
  isoClock,
  type ChecklistRecord,
  type Clock,
} from "../data/record";
import { downloadText, readTextFile } from "../lib/files";
import {
  backupFilename,
  countsOf,
  describeCounts,
  parseBackup,
} from "../lib/registry-backup";
import type { RecordsRepo } from "../data/records-repo";
import {
  createEquipment,
  createProject,
  createSystem,
  type Equipment,
  type Project,
  type SystemNode,
} from "../data/registry";
import type { RegistryRepo } from "../data/registry-repo";
import { uuidv7 } from "../data/uuidv7";

/**
 * Project registry browser (SPEC §10 screen 8): pick a project and browse its
 * System → subsystem → Equipment tree, adding entries as you go. Per-tag ITR
 * completion and linking records to equipment are the next task; this establishes
 * the entities and the hierarchy.
 */
export function EquipmentTree(props: {
  registryRepo: RegistryRepo;
  recordsRepo: RecordsRepo;
  onNewITR: (equipment: Equipment) => void;
  newId?: () => string;
  clock?: Clock;
}): ReactNode {
  const { registryRepo: repo, recordsRepo, onNewITR, newId = uuidv7, clock = isoClock } =
    props;

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [systems, setSystems] = useState<SystemNode[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [records, setRecords] = useState<ChecklistRecord[]>([]);

  const [proj, setProj] = useState({ code: "", name: "", client: "" });
  const [sys, setSys] = useState({ code: "", name: "", parent: "" });
  const [equip, setEquip] = useState({ tag: "", description: "", system: "" });
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  const loadProjects = useCallback(async () => {
    setProjects(await repo.listProjects());
  }, [repo]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const loadTree = useCallback(
    async (projectId: string) => {
      const [s, e, allRecords] = await Promise.all([
        repo.listSystems(projectId),
        repo.listEquipment(projectId),
        recordsRepo.list(),
      ]);
      setSystems(s);
      setEquipment(e);
      setRecords(allRecords.filter((r) => r.project_id === projectId));
    },
    [repo, recordsRepo],
  );

  useEffect(() => {
    if (selectedId) void loadTree(selectedId);
    else {
      setSystems([]);
      setEquipment([]);
      setRecords([]);
    }
  }, [selectedId, loadTree]);

  const addProject = async () => {
    if (!proj.code.trim() || !proj.name.trim()) return;
    const project = createProject({
      id: newId(),
      now: clock(),
      code: proj.code.trim(),
      name: proj.name.trim(),
      client: proj.client.trim(),
    });
    await repo.addProject(project);
    setProj({ code: "", name: "", client: "" });
    await loadProjects();
    setSelectedId(project.id);
  };

  const addSystem = async () => {
    if (!selectedId || !sys.name.trim()) return;
    await repo.addSystem(
      createSystem({
        id: newId(),
        projectId: selectedId,
        name: sys.name.trim(),
        code: sys.code.trim(),
        parentSystemId: sys.parent || null,
      }),
    );
    setSys({ code: "", name: "", parent: "" });
    await loadTree(selectedId);
  };

  const addEquipment = async () => {
    if (!selectedId || !equip.tag.trim() || !equip.system) return;
    await repo.addEquipment(
      createEquipment({
        id: newId(),
        projectId: selectedId,
        systemId: equip.system,
        tag: equip.tag.trim(),
        description: equip.description.trim(),
      }),
    );
    setEquip({ tag: "", description: "", system: "" });
    await loadTree(selectedId);
  };

  /**
   * Write the registry out as a file. The registry has no server copy, so this
   * is the only backup that exists — see `lib/registry-backup.ts`.
   */
  const exportRegistry = async () => {
    const backup = await repo.exportBackup(clock());
    downloadText(
      backupFilename(backup.exported_at),
      JSON.stringify(backup, null, 2),
    );
    setBackupNote(`Saved ${describeCounts(countsOf(backup))} to your device.`);
  };

  const importRegistry = async (file: File) => {
    try {
      const counts = await repo.importBackup(
        parseBackup(await readTextFile(file)),
      );
      await loadProjects();
      if (selectedId) await loadTree(selectedId);
      setBackupNote(`Restored ${describeCounts(counts)}.`);
    } catch (err) {
      setBackupNote(
        err instanceof Error
          ? err.message
          : "That file could not be read. Choose a registry backup.",
      );
    }
  };

  const childrenOf = (id: string | null) =>
    systems.filter((s) => s.parent_system_id === id);
  const equipmentOf = (systemId: string) =>
    equipment.filter((e) => e.system_id === systemId);

  // ITR completion for a tag: one head record per ITR, and how many are accepted.
  const completionFor = (equipmentId: string) => {
    const heads = headRecords(records.filter((r) => r.equipment_id === equipmentId));
    const accepted = heads.filter((r) => r.status === "accepted").length;
    return { total: heads.length, accepted };
  };

  const renderSystem = (system: SystemNode): ReactNode => (
    <li key={system.id} className="tree-node">
      <div className="tree-system">
        {system.code && <span className="tree-code">{system.code}</span>}
        <span>{system.name}</span>
      </div>
      <ul className="tree-children">
        {equipmentOf(system.id).map((e) => {
          const { total, accepted } = completionFor(e.id);
          return (
            <li key={e.id} className="tree-equip">
              <span className="tree-tag">{e.tag}</span>
              {e.description && <span className="tree-desc">{e.description}</span>}
              <span className="tree-completion">
                {total === 0
                  ? "no ITRs"
                  : `${total} ITR${total === 1 ? "" : "s"} · ${accepted} accepted`}
              </span>
              <button
                type="button"
                className="ghost-button tree-new-itr"
                onClick={() => onNewITR(e)}
              >
                New ITR
              </button>
            </li>
          );
        })}
        {childrenOf(system.id).map(renderSystem)}
      </ul>
    </li>
  );

  return (
    <div className="equip-tree">
      <div className="registry-projects">
        <label className="register-filter">
          <span>Project</span>
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
          >
            <option value="">Select a project…</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </label>

        <div className="registry-form">
          <input
            aria-label="Project code"
            placeholder="Code"
            value={proj.code}
            onChange={(e) => setProj({ ...proj, code: e.target.value })}
          />
          <input
            aria-label="Project name"
            placeholder="Name"
            value={proj.name}
            onChange={(e) => setProj({ ...proj, name: e.target.value })}
          />
          <input
            aria-label="Project client"
            placeholder="Client"
            value={proj.client}
            onChange={(e) => setProj({ ...proj, client: e.target.value })}
          />
          <button
            type="button"
            className="save-button"
            disabled={!proj.code.trim() || !proj.name.trim()}
            onClick={() => void addProject()}
          >
            New project
          </button>
        </div>

        <div className="registry-backup">
          <p className="registry-backup-why">
            Projects, systems and equipment tags are stored on this device only.
            Export a copy so you can restore them if this browser is cleared, or
            load them onto another device.
          </p>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void exportRegistry()}
          >
            Export registry
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => backupInput.current?.click()}
          >
            Import registry
          </button>
          <input
            ref={backupInput}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            aria-label="Registry backup file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // so the same file can be picked twice
              if (file) void importRegistry(file);
            }}
          />
          {backupNote && (
            <p className="registry-backup-note" role="status">
              {backupNote}
            </p>
          )}
        </div>
      </div>

      {selectedId && (
        <>
          {childrenOf(null).length === 0 ? (
            <p className="register-empty">
              No systems yet. Add one to start the tree.
            </p>
          ) : (
            <ul className="tree-root">{childrenOf(null).map(renderSystem)}</ul>
          )}

          <div className="registry-adders">
            <div className="registry-form">
              <input
                aria-label="System code"
                placeholder="System code"
                value={sys.code}
                onChange={(e) => setSys({ ...sys, code: e.target.value })}
              />
              <input
                aria-label="System name"
                placeholder="System name"
                value={sys.name}
                onChange={(e) => setSys({ ...sys, name: e.target.value })}
              />
              <select
                aria-label="Parent system"
                value={sys.parent}
                onChange={(e) => setSys({ ...sys, parent: e.target.value })}
              >
                <option value="">(top level)</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    Under: {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="save-button"
                disabled={!sys.name.trim()}
                onClick={() => void addSystem()}
              >
                Add system
              </button>
            </div>

            <div className="registry-form">
              <input
                aria-label="Equipment tag"
                placeholder="Tag"
                value={equip.tag}
                onChange={(e) => setEquip({ ...equip, tag: e.target.value })}
              />
              <input
                aria-label="Equipment description"
                placeholder="Description"
                value={equip.description}
                onChange={(e) =>
                  setEquip({ ...equip, description: e.target.value })
                }
              />
              <select
                aria-label="Equipment system"
                value={equip.system}
                onChange={(e) => setEquip({ ...equip, system: e.target.value })}
              >
                <option value="">Select system…</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="save-button"
                disabled={!equip.tag.trim() || !equip.system}
                onClick={() => void addEquipment()}
              >
                Add equipment
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
