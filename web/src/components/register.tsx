import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Template } from "@schema";
import {
  templateFor,
  templateVersionId,
  type ChecklistRecord,
  type RecordStatus,
} from "../data/record";
import type { RecordsRepo } from "../data/records-repo";
import type { Equipment, Project, SystemNode } from "../data/registry";
import type { RegistryRepo } from "../data/registry-repo";
import { deleteRecord } from "../data/save";
import type { SignaturesRepo } from "../data/signatures-repo";
import type { SyncLayer } from "../data/sync";
import { isDeletableStatus } from "../data/workflow";
import { STATUS_LABELS } from "./status-bar";

const STATUSES: RecordStatus[] = [
  "draft",
  "completed",
  "submitted_for_witness",
  "witnessed",
  "accepted",
  "rejected",
];

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * The ITR register (SPEC §10 screen 3): every record, filterable, opened into the
 * form. The hub of the register-first navigation. Columns are limited to what
 * exists client-side today — project/system/equipment entities and server-side
 * serial numbers are not modelled yet, so those columns arrive with them.
 */
export function Register(props: {
  repo: RecordsRepo;
  registryRepo: RegistryRepo;
  signaturesRepo: SignaturesRepo;
  sync: SyncLayer;
  templates: Template[];
  onOpen: (record: ChecklistRecord) => void;
  onNewRecord: () => void;
  onExport: (ids: string[]) => void;
}): ReactNode {
  const { repo, registryRepo, signaturesRepo, sync, templates, onOpen, onNewRecord, onExport } =
    props;
  const [records, setRecords] = useState<ChecklistRecord[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [systems, setSystems] = useState<SystemNode[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  // Records carrying signatures — never offered a Delete action (Hard Rule #6).
  const [signedIds, setSignedIds] = useState<Set<string>>(() => new Set());
  const [statusFilter, setStatusFilter] = useState<RecordStatus | "all">("all");
  const [templateFilter, setTemplateFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [all, ps, ss, es, signed] = await Promise.all([
        repo.list(),
        registryRepo.listProjects(),
        registryRepo.listAllSystems(),
        registryRepo.listAllEquipment(),
        signaturesRepo.signedRecordIds(),
      ]);
      if (!alive) return;
      all.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      setRecords(all);
      setProjects(ps);
      setSystems(ss);
      setEquipment(es);
      setSignedIds(signed);
    })();
    return () => {
      alive = false;
    };
  }, [repo, registryRepo, signaturesRepo]);

  // Soft-delete: the record becomes a synced tombstone (see data/save.ts), so it
  // disappears from the register on every device — not just this one.
  const removeRecord = async (record: ChecklistRecord) => {
    const template = templateFor(record, templates);
    const ok = window.confirm(
      `Delete this ${STATUS_LABELS[record.status].toLowerCase()} ${
        template?.title ?? "record"
      }? It will be removed from the register on every device. This cannot be undone.`,
    );
    if (!ok) return;
    await deleteRecord({ repo, sync, signatures: signaturesRepo }, record.id);
    setRecords((prev) => (prev ? prev.filter((r) => r.id !== record.id) : prev));
    setSelected((prev) => {
      if (!prev.has(record.id)) return prev;
      const next = new Set(prev);
      next.delete(record.id);
      return next;
    });
  };

  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const systemById = useMemo(
    () => new Map(systems.map((s) => [s.id, s])),
    [systems],
  );
  const equipmentById = useMemo(
    () => new Map(equipment.map((e) => [e.id, e])),
    [equipment],
  );

  // Ids that some later revision supersedes — shown as "superseded".
  const supersededIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of records ?? []) if (r.supersedes) ids.add(r.supersedes);
    return ids;
  }, [records]);

  const filtered = useMemo(
    () =>
      (records ?? []).filter(
        (r) =>
          (statusFilter === "all" || r.status === statusFilter) &&
          (templateFilter === "all" || r.template_version_id === templateFilter) &&
          (projectFilter === "all" || r.project_id === projectFilter),
      ),
    [records, statusFilter, templateFilter, projectFilter],
  );

  const allSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of filtered) {
        if (allSelected) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });

  return (
    <div className="register">
      <div className="register-toolbar">
        <div className="register-filters">
          <label className="register-filter">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as RecordStatus | "all")
              }
            >
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="register-filter">
            <span>Template</span>
            <select
              value={templateFilter}
              onChange={(e) => setTemplateFilter(e.target.value)}
            >
              <option value="all">All templates</option>
              {templates.map((t) => (
                <option key={t.code} value={templateVersionId(t)}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label className="register-filter">
            <span>Project</span>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="register-actions">
          <button type="button" className="save-button" onClick={onNewRecord}>
            New record
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={selected.size === 0}
            onClick={() => onExport([...selected])}
          >
            Export {selected.size} selected
          </button>
        </div>
      </div>

      {records === null ? (
        <p className="register-empty">Loading records…</p>
      ) : filtered.length === 0 ? (
        <p className="register-empty">No records yet. Create one above.</p>
      ) : (
        <table className="register-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={toggleAll}
                />
              </th>
              <th>Template</th>
              <th>Project</th>
              <th>System</th>
              <th>Equipment</th>
              <th>Status</th>
              <th>Rev</th>
              <th>Serial</th>
              <th>Updated</th>
              <th>By</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const template = templateFor(r, templates);
              const superseded = supersededIds.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={superseded ? "register-row is-superseded" : "register-row"}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${template?.title ?? r.template_version_id}`}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td>{template?.title ?? r.template_version_id}</td>
                  <td>
                    {(r.project_id && projectById.get(r.project_id)?.code) || "—"}
                  </td>
                  <td>
                    {(r.system_id && systemById.get(r.system_id)?.name) || "—"}
                  </td>
                  <td className="register-tag">
                    {(r.equipment_id && equipmentById.get(r.equipment_id)?.tag) ||
                      "—"}
                  </td>
                  <td>
                    <span className={`status-chip status-chip-${r.status}`}>
                      {STATUS_LABELS[r.status]}
                    </span>
                  </td>
                  <td>
                    {r.rev}
                    {r.supersedes ? " ↻" : ""}
                    {superseded ? (
                      <span className="register-superseded"> superseded</span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td>{r.serial_no ?? "—"}</td>
                  <td>{DATE_FORMAT.format(new Date(r.updated_at))}</td>
                  <td>{r.created_by ?? "—"}</td>
                  <td className="register-row-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => onOpen(r)}
                    >
                      Open
                    </button>
                    {isDeletableStatus(r.status) && !signedIds.has(r.id) && (
                      <button
                        type="button"
                        className="ghost-button is-danger"
                        onClick={() => void removeRecord(r)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
