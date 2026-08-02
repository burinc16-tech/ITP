import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Template } from "@schema";
import type { AuditEntry } from "../data/audit";
import type { AuditRepo } from "../data/audit-repo";
import { templateFor, type ChecklistRecord, type RecordStatus } from "../data/record";
import type { RecordsRepo } from "../data/records-repo";
import type { Equipment, Project, SystemNode } from "../data/registry";
import type { RegistryRepo } from "../data/registry-repo";
import { ROLE_LABELS, type Role } from "../data/roles";
import { formatSignedAt } from "../data/signature";
import { ACTION_LABELS, type WorkflowAction } from "../data/workflow";
import {
  completionByProject,
  completionBySystem,
  completionSummary,
  type ScopeCompletion,
} from "../lib/completion";
import { outstandingItems } from "../lib/outstanding";
import { STATUS_LABELS } from "./status-bar";

const STATUS_ORDER: RecordStatus[] = [
  "draft",
  "completed",
  "submitted_for_witness",
  "witnessed",
  "accepted",
  "rejected",
];

function actionLabel(action: string): string {
  if (action in ACTION_LABELS) return ACTION_LABELS[action as WorkflowAction];
  if (action === "revised_from") return "Revised";
  return action;
}

/**
 * The project dashboard (SPEC §10 screen 2): completion summary, the derived
 * outstanding-items list (§6), and recent activity. Read-only; every item and
 * activity row opens its record. Global and grouped by template until project /
 * system entities exist.
 */
export function Dashboard(props: {
  repo: RecordsRepo;
  auditRepo: AuditRepo;
  registryRepo: RegistryRepo;
  templates: Template[];
  onOpen: (record: ChecklistRecord) => void;
}): ReactNode {
  const { repo, auditRepo, registryRepo, templates, onOpen } = props;
  const [records, setRecords] = useState<ChecklistRecord[] | null>(null);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [systems, setSystems] = useState<SystemNode[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [all, recent, ps, ss, es] = await Promise.all([
        repo.list(),
        auditRepo.recent(20),
        registryRepo.listProjects(),
        registryRepo.listAllSystems(),
        registryRepo.listAllEquipment(),
      ]);
      if (!alive) return;
      setRecords(all);
      setActivity(recent);
      setProjects(ps);
      setSystems(ss);
      setEquipment(es);
    })();
    return () => {
      alive = false;
    };
  }, [repo, auditRepo, registryRepo]);

  const summary = useMemo(
    () => (records ? completionSummary(records, templates) : null),
    [records, templates],
  );
  const byProject = useMemo(
    () => (records ? completionByProject(records, projects) : []),
    [records, projects],
  );
  const bySystem = useMemo(
    () => (records ? completionBySystem(records, systems) : []),
    [records, systems],
  );
  const items = useMemo(
    () => (records ? outstandingItems(records, templates) : []),
    [records, templates],
  );
  const byId = useMemo(
    () => new Map((records ?? []).map((r) => [r.id, r])),
    [records],
  );
  const equipmentById = useMemo(
    () => new Map(equipment.map((e) => [e.id, e])),
    [equipment],
  );

  const open = (id: string) => {
    const record = byId.get(id);
    if (record) onOpen(record);
  };

  if (!records || !summary) {
    return <p className="register-empty">Loading dashboard…</p>;
  }

  return (
    <div className="dashboard">
      <section className="dash-card">
        <h2>Completion</h2>
        <div className="dash-headline">
          <span className="dash-percent">{summary.percentComplete}%</span>
          <span className="dash-headline-sub">
            {summary.accepted} of {summary.total} accepted
          </span>
        </div>
        <div className="dash-status-counts">
          {STATUS_ORDER.map((s) => (
            <span key={s} className="dash-status-count">
              <span className={`status-chip status-chip-${s}`}>
                {STATUS_LABELS[s]}
              </span>
              <strong>{summary.byStatus[s]}</strong>
            </span>
          ))}
        </div>
        {summary.byTemplate.length > 0 && (
          <ul className="dash-template-list">
            {summary.byTemplate.map((t) => (
              <li key={t.template_version_id}>
                <span>{t.title}</span>
                <span className="dash-template-count">
                  {t.accepted}/{t.total} accepted
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="dash-scope-cards">
        <ScopeCard title="By system" rows={bySystem} />
        <ScopeCard title="By project" rows={byProject} />
      </div>

      <section className="dash-card">
        <h2>Outstanding items ({items.length})</h2>
        {items.length === 0 ? (
          <p className="register-empty">No outstanding items.</p>
        ) : (
          <ul className="dash-outstanding">
            {items.map((item) => (
              <li key={`${item.record_id}:${item.row_id}`} className="dash-item">
                <div className="dash-item-main">
                  <span className="dash-item-desc">
                    {item.no ? `${item.no} ` : ""}
                    {item.description}
                  </span>
                  <span className="dash-item-value">{item.display}</span>
                </div>
                <div className="dash-item-meta">
                  {(() => {
                    const rec = byId.get(item.record_id);
                    const tag = rec?.equipment_id
                      ? equipmentById.get(rec.equipment_id)?.tag
                      : undefined;
                    return tag ? <span className="dash-item-tag">{tag}</span> : null;
                  })()}
                  <span>
                    {item.template_title} · Rev {item.rev} ·{" "}
                    {STATUS_LABELS[item.status]}
                    {item.serial_no ? ` · ${item.serial_no}` : ""}
                  </span>
                  {item.remarks && (
                    <span className="dash-item-remark">{item.remarks}</span>
                  )}
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => open(item.record_id)}
                  >
                    Open
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dash-card">
        <h2>Recent activity</h2>
        {activity.length === 0 ? (
          <p className="register-empty">No activity yet.</p>
        ) : (
          <ul className="dash-activity">
            {activity.map((e) => {
              const rec = byId.get(e.record_id);
              const title = rec
                ? templateFor(rec, templates)?.title ?? e.record_id
                : e.record_id;
              return (
                <li key={e.id} className="dash-activity-row">
                  <span className="dash-activity-action">{actionLabel(e.action)}</span>
                  <span className="dash-activity-detail">
                    {title}
                    {e.before && e.after ? ` · ${e.before} → ${e.after}` : ""} ·{" "}
                    {ROLE_LABELS[e.role as Role] ?? e.role} ·{" "}
                    {formatSignedAt(e.at)}
                  </span>
                  {rec && (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => open(e.record_id)}
                    >
                      Open
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** A completion breakdown grouped by a scope (system or project), §10 screen 2. */
function ScopeCard(props: {
  title: string;
  rows: ScopeCompletion[];
}): ReactNode {
  const { title, rows } = props;
  return (
    <section className="dash-card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="register-empty">No records yet.</p>
      ) : (
        <ul className="dash-template-list">
          {rows.map((row) => (
            <li key={row.key}>
              <span>{row.label}</span>
              <span className="dash-template-count">
                {row.accepted}/{row.total} accepted
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
