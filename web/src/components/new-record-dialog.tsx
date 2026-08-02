import { useEffect, useState, type ReactNode } from "react";
import type { Template } from "@schema";
import type { Equipment, Project, SystemNode } from "../data/registry";
import type { RegistryRepo } from "../data/registry-repo";

export interface NewRecordScope {
  template: Template;
  projectId: string;
  systemId: string | null;
  equipmentId: string | null;
}

export interface NewRecordPrefill {
  projectId?: string;
  systemId?: string | null;
  equipmentId?: string | null;
}

/**
 * New-record dialog (record ↔ registry linking, §4/§10 screen 8). Picks the
 * template and the project/system/equipment scope, so the draft is created with
 * `project_id`/`system_id`/`equipment_id` set. Project is required (a record
 * belongs to a project); equipment is optional. Can be prefilled — e.g. when
 * starting an ITR from an equipment tag in the tree.
 */
export function NewRecordDialog(props: {
  templates: Template[];
  registryRepo: RegistryRepo;
  prefill?: NewRecordPrefill;
  onCreate: (scope: NewRecordScope) => void;
  onCancel: () => void;
}): ReactNode {
  const { templates, registryRepo, prefill, onCreate, onCancel } = props;

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [systems, setSystems] = useState<SystemNode[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);

  const [templateCode, setTemplateCode] = useState(templates[0]?.code ?? "");
  const [projectId, setProjectId] = useState(prefill?.projectId ?? "");
  const [systemId, setSystemId] = useState(prefill?.systemId ?? "");
  const [equipmentId, setEquipmentId] = useState(prefill?.equipmentId ?? "");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await registryRepo.listProjects();
      if (alive) setProjects(list);
    })();
    return () => {
      alive = false;
    };
  }, [registryRepo]);

  useEffect(() => {
    if (!projectId) {
      setSystems([]);
      setEquipment([]);
      return;
    }
    let alive = true;
    void (async () => {
      const [s, e] = await Promise.all([
        registryRepo.listSystems(projectId),
        registryRepo.listEquipment(projectId),
      ]);
      if (!alive) return;
      setSystems(s);
      setEquipment(e);
    })();
    return () => {
      alive = false;
    };
  }, [projectId, registryRepo]);

  const equipmentOptions = systemId
    ? equipment.filter((e) => e.system_id === systemId)
    : equipment;

  const create = () => {
    const template = templates.find((t) => t.code === templateCode);
    if (!template || !projectId) return;
    onCreate({
      template,
      projectId,
      systemId: systemId || null,
      equipmentId: equipmentId || null,
    });
  };

  return (
    <div className="sign-overlay" role="dialog" aria-modal="true" aria-label="New record">
      <div className="sign-dialog">
        <header className="sign-dialog-head">
          <h2>New record</h2>
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
        </header>

        {projects === null ? (
          <p className="register-empty">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="register-empty">
            No projects yet. Create one in the Equipment tab first.
          </p>
        ) : (
          <>
            <div className="sign-fields">
              <label className="sign-field">
                <span>Template</span>
                <select
                  value={templateCode}
                  onChange={(e) => setTemplateCode(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sign-field">
                <span>Project</span>
                <select
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setSystemId("");
                    setEquipmentId("");
                  }}
                >
                  <option value="">Select a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sign-field">
                <span>System (optional)</span>
                <select
                  value={systemId}
                  disabled={!projectId}
                  onChange={(e) => {
                    setSystemId(e.target.value);
                    setEquipmentId("");
                  }}
                >
                  <option value="">—</option>
                  {systems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sign-field">
                <span>Equipment (optional)</span>
                <select
                  value={equipmentId}
                  disabled={!projectId}
                  onChange={(e) => setEquipmentId(e.target.value)}
                >
                  <option value="">—</option>
                  {equipmentOptions.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.tag}
                      {e.description ? ` — ${e.description}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="sign-dialog-actions">
              <button
                type="button"
                className="save-button"
                disabled={!projectId || !templateCode}
                onClick={create}
              >
                Create record
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
