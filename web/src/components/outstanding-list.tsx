import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Template } from "@schema";
import type { ChecklistRecord } from "../data/record";
import type { RecordsRepo } from "../data/records-repo";
import type { Equipment, Project } from "../data/registry";
import type { RegistryRepo } from "../data/registry-repo";
import { outstandingItems, type OutstandingItem } from "../lib/outstanding";
import { STATUS_LABELS } from "./status-bar";

const UNASSIGNED = "__unassigned__";

interface Group {
  key: string;
  label: string;
  items: OutstandingItem[];
}

/**
 * The outstanding-items list (SPEC §6, §10 screen 2 / §11 Phase 5): every row that
 * evaluates to Fail across the store, derived — never stored — from the head of
 * each revision chain, so a Fail cleared by a later revision drops off. Unlike the
 * dashboard's at-a-glance card this is the working close-out view: grouped per
 * project and filterable, carrying the equipment tag and ITR serial for each snag.
 * (Photo evidence is listed by SPEC §6 but photo capture isn't built yet.)
 */
export function OutstandingList(props: {
  repo: RecordsRepo;
  registryRepo: RegistryRepo;
  templates: Template[];
  onOpen: (record: ChecklistRecord) => void;
}): ReactNode {
  const { repo, registryRepo, templates, onOpen } = props;
  const [records, setRecords] = useState<ChecklistRecord[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [templateFilter, setTemplateFilter] = useState<string>("all");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [all, ps, es] = await Promise.all([
        repo.list(),
        registryRepo.listProjects(),
        registryRepo.listAllEquipment(),
      ]);
      if (!alive) return;
      setRecords(all);
      setProjects(ps);
      setEquipment(es);
    })();
    return () => {
      alive = false;
    };
  }, [repo, registryRepo]);

  const recordById = useMemo(
    () => new Map((records ?? []).map((r) => [r.id, r])),
    [records],
  );
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const equipmentById = useMemo(() => new Map(equipment.map((e) => [e.id, e])), [equipment]);

  const items = useMemo(
    () => (records ? outstandingItems(records, templates) : []),
    [records, templates],
  );

  const filtered = useMemo(
    () =>
      items.filter((i) => {
        if (projectFilter !== "all" && (i.project_id ?? UNASSIGNED) !== projectFilter) return false;
        if (templateFilter !== "all" && i.template_title !== templateFilter) return false;
        return true;
      }),
    [items, projectFilter, templateFilter],
  );

  // Group per project (§6), with an "Unassigned" bucket last; tags within a group.
  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, OutstandingItem[]>();
    for (const item of filtered) {
      const key = item.project_id ?? UNASSIGNED;
      (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(item);
    }
    const tagOf = (i: OutstandingItem) =>
      i.equipment_id ? equipmentById.get(i.equipment_id)?.tag ?? "" : "";
    const result: Group[] = [];
    for (const [key, list] of byKey) {
      const project = key === UNASSIGNED ? null : projectById.get(key);
      const label = project ? `${project.code} — ${project.name}` : "Unassigned";
      list.sort(
        (a, b) => tagOf(a).localeCompare(tagOf(b)) || a.description.localeCompare(b.description),
      );
      result.push({ key, label, items: list });
    }
    result.sort((a, b) => {
      if (a.key === UNASSIGNED) return 1;
      if (b.key === UNASSIGNED) return -1;
      return a.label.localeCompare(b.label);
    });
    return result;
  }, [filtered, projectById, equipmentById]);

  const templateTitles = useMemo(
    () => [...new Set(items.map((i) => i.template_title))].sort(),
    [items],
  );

  if (records === null) return <p className="register-loading">Loading…</p>;

  return (
    <div className="outstanding">
      <div className="outstanding-head">
        <h2>Outstanding items ({filtered.length})</h2>
        <div className="register-filters">
          <label className="register-filter">
            <span>Project</span>
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
              <option value={UNASSIGNED}>Unassigned</option>
            </select>
          </label>
          <label className="register-filter">
            <span>Template</span>
            <select value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)}>
              <option value="all">All templates</option>
              {templateTitles.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="register-empty">No outstanding items.</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="outstanding-group">
            <h3 className="outstanding-group-title">
              {group.label} ({group.items.length})
            </h3>
            <table className="register-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Value</th>
                  <th scope="col">Equipment</th>
                  <th scope="col">ITR</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => {
                  const tag = item.equipment_id
                    ? equipmentById.get(item.equipment_id)?.tag
                    : undefined;
                  const record = recordById.get(item.record_id);
                  return (
                    <tr key={`${item.record_id}:${item.row_id}`} className="register-row">
                      <td>
                        <span className="outstanding-desc">
                          {item.no ? `${item.no} ` : ""}
                          {item.description}
                        </span>
                        {item.remarks && (
                          <span className="outstanding-remark">{item.remarks}</span>
                        )}
                      </td>
                      <td>{item.display}</td>
                      <td>{tag ?? "—"}</td>
                      <td>
                        {item.template_title} · Rev {item.rev}
                        {item.serial_no ? ` · ${item.serial_no}` : ""}
                      </td>
                      <td>
                        <span className={`status-chip status-chip-${item.status}`}>
                          {STATUS_LABELS[item.status]}
                        </span>
                      </td>
                      <td>
                        {record && (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => onOpen(record)}
                          >
                            Open
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
