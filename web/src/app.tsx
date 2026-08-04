import { useEffect, useState, type ReactNode } from "react";
import type { Template } from "@schema";
import { TEMPLATES } from "./templates";
import { BatchExport } from "./components/batch-export";
import { CalibrationRegister } from "./components/calibration-register";
import { Dashboard } from "./components/dashboard";
import { EquipmentTree } from "./components/equipment-tree";
import { Login } from "./components/login";
import {
  NewRecordDialog,
  type NewRecordPrefill,
  type NewRecordScope,
} from "./components/new-record-dialog";
import { OutstandingList } from "./components/outstanding-list";
import { RecordForm } from "./components/record-form";
import { Register } from "./components/register";
import { AttachmentsRepo } from "./data/attachments-repo";
import { AuditRepo } from "./data/audit-repo";
import { AuthClient, loadStoredToken, storeToken, type Session } from "./data/auth";
import { ChecklistDb } from "./data/db";
import { InstrumentsRepo } from "./data/instruments-repo";
import { RegistryRepo } from "./data/registry-repo";
import {
  createDraft,
  isoClock,
  STUB_USER,
  type ChecklistRecord,
} from "./data/record";
import { OutboxRepo } from "./data/outbox";
import { RecordsRepo } from "./data/records-repo";
import { ACTING_ROLES, ROLE_LABELS, type Role } from "./data/roles";
import { SignaturesRepo } from "./data/signatures-repo";
import {
  ApiTransport,
  PassthroughSync,
  publishConflict,
  publishPending,
  type SyncLayer,
} from "./data/sync";
import { QueuedSync } from "./data/sync-queue";
import { SyncStatus } from "./components/sync-status";
import { uuidv7 } from "./data/uuidv7";
import { SignoffClient } from "./data/signoff-api";
import "./styles.css";

// Local-first store + pass-through sync, constructed once for the app session.
// Records, signatures, and the audit log share the one Dexie database.
const db = new ChecklistDb();
const repo = new RecordsRepo(db);
const signaturesRepo = new SignaturesRepo(db);
const auditRepo = new AuditRepo(db);
const registryRepo = new RegistryRepo(db);
const instrumentsRepo = new InstrumentsRepo(db);
const attachmentsRepo = new AttachmentsRepo(db);
const outboxRepo = new OutboxRepo(db);
// Push to the Worker API when configured (VITE_API_URL), else stay local-only.
const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
// Current session token, read by the sync/signoff clients on every call so it
// tracks login/logout without rebuilding them. Set by the App on auth changes.
let sessionToken: string | null = null;
const getToken = (): string | null => sessionToken;
const authClient = apiUrl ? new AuthClient(apiUrl) : null;
// Durable offline sync (SPEC §8): every write goes to Dexie, is enqueued in the
// outbox, and drained oldest-first with backoff behind the SyncLayer boundary
// (hard rule #1). A lock conflict surfaces later during a drain, so it's routed
// through the conflict bus rather than the save's synchronous return.
const queuedSync = apiUrl
  ? new QueuedSync({
      transport: new ApiTransport(apiUrl, getToken),
      outbox: outboxRepo,
      records: repo,
      signatures: signaturesRepo,
      audit: auditRepo,
      attachments: attachmentsRepo,
      onConflict: publishConflict,
      onChange: publishPending,
    })
  : null;
const sync: SyncLayer = queuedSync ?? new PassthroughSync();
// Remote sign-off issue/revoke client (QA/QC). Only when the API is configured —
// the record must be synced to the server before a link can be issued.
const signoff = apiUrl ? new SignoffClient(apiUrl, getToken) : null;

type View =
  | { kind: "register" }
  | { kind: "dashboard" }
  | { kind: "equipment" }
  | { kind: "calibration" }
  | { kind: "outstanding" }
  | { kind: "batch"; ids: string[] }
  | { kind: "record"; id: string; template: Template };

const NAV_VIEWS = ["register", "dashboard", "outstanding", "equipment", "calibration"] as const;
const NAV_LABELS: Record<(typeof NAV_VIEWS)[number], string> = {
  register: "Register",
  dashboard: "Dashboard",
  outstanding: "Outstanding",
  equipment: "Equipment",
  calibration: "Calibration",
};

export function App(): ReactNode {
  const [view, setView] = useState<View>({ kind: "register" });
  // Acting role. With the API configured this comes from the signed-in user; in
  // local-only mode it's the stub picker (SPEC §9). Gates workflow transitions.
  const [stubRole, setStubRole] = useState<Role>("site_engineer");
  // Auth (task 4). Only meaningful when the API is configured; local-only mode
  // never authenticates. `checked` guards the flash of the login screen while a
  // stored token is being validated on load.
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(!authClient);
  // New-record dialog: null closed; an object (possibly empty) opens it, with an
  // optional prefilled scope (e.g. from an equipment tag in the tree).
  const [newDialog, setNewDialog] = useState<NewRecordPrefill | null>(null);

  const applySession = (next: Session | null) => {
    sessionToken = next?.token ?? null;
    storeToken(sessionToken);
    setSession(next);
  };

  // On load, restore a stored session by validating its token with the server.
  useEffect(() => {
    if (!authClient) return;
    const token = loadStoredToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }
    let alive = true;
    void authClient.me(token).then((user) => {
      if (!alive) return;
      if (user) applySession({ token, user, expires_at: "" });
      else storeToken(null);
      setAuthChecked(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Flush the durable outbox on startup (anything left unsynced from a previous
  // session) and whenever the browser regains connectivity. Enqueues during a
  // session self-kick their own drain; these cover the boot and reconnect gaps.
  useEffect(() => {
    if (!queuedSync) return;
    void queuedSync.drain();
    const onOnline = () => void queuedSync.drain();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const handleLogout = async () => {
    const token = session?.token;
    applySession(null);
    setView({ kind: "register" });
    if (authClient && token) await authClient.logout(token);
  };

  // The active role and the user attribution for new records/audit.
  const role: Role = authClient ? (session?.user.role ?? "site_engineer") : stubRole;
  const currentUser = session?.user.id ?? STUB_USER;

  const openRecord = (record: ChecklistRecord) => {
    const template = TEMPLATES.find(
      (t) => `${t.code}@${t.rev}` === record.template_version_id,
    );
    if (template) setView({ kind: "record", id: record.id, template });
  };

  const createFromScope = async (scope: NewRecordScope) => {
    const record = createDraft(scope.template, {
      id: uuidv7(),
      now: isoClock(),
      createdBy: currentUser,
      projectId: scope.projectId,
      systemId: scope.systemId,
      equipmentId: scope.equipmentId,
      scopeType: "equipment",
    });
    // Local-first create (SPEC §12 "Draft creation and sync"): persist locally
    // only. The record syncs on the first edit (autosave → saveRecord) or via the
    // Phase 5 queue, so an abandoned new draft leaves nothing on the server.
    await repo.upsert(record);
    setNewDialog(null);
    setView({ kind: "record", id: record.id, template: scope.template });
  };

  const openRevised = (id: string) => {
    setView((v) => (v.kind === "record" ? { ...v, id } : v));
  };

  // Auth gate: when the API is configured, require a signed-in session.
  if (authClient && !authChecked) {
    return <p className="record-loading">Loading…</p>;
  }
  if (authClient && !session) {
    return <Login client={authClient} onLogin={applySession} />;
  }

  return (
    <div className="app">
      <header className="app-bar">
        <div>
          <h1>ITP / ITR Checklists</h1>
          <p className="app-bar-meta">Kenyon Pte Ltd — Testing &amp; Commissioning</p>
        </div>
        <div className="app-bar-controls no-print">
          {queuedSync && <SyncStatus source={queuedSync} />}
          {NAV_VIEWS.some((v) => v === view.kind) && (
            <nav className="app-nav">
              {NAV_VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={view.kind === v ? "app-nav-btn is-active" : "app-nav-btn"}
                  onClick={() => setView({ kind: v })}
                >
                  {NAV_LABELS[v]}
                </button>
              ))}
            </nav>
          )}
          {session ? (
            <div className="app-user">
              <span className="app-user-name">
                {session.user.name} · {ROLE_LABELS[role]}
              </span>
              <button type="button" className="ghost-button" onClick={() => void handleLogout()}>
                Sign out
              </button>
            </div>
          ) : (
            <label className="role-picker">
              <span className="visually-hidden">Acting as</span>
              <select value={stubRole} onChange={(e) => setStubRole(e.target.value as Role)}>
                {ACTING_ROLES.map((r) => (
                  <option key={r} value={r}>
                    Acting as: {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>
      <main className="app-main">
        {view.kind === "register" ? (
          <Register
            repo={repo}
            registryRepo={registryRepo}
            templates={TEMPLATES}
            onOpen={openRecord}
            onNewRecord={() => setNewDialog({})}
            onExport={(ids) => setView({ kind: "batch", ids })}
          />
        ) : view.kind === "dashboard" ? (
          <Dashboard
            repo={repo}
            auditRepo={auditRepo}
            registryRepo={registryRepo}
            templates={TEMPLATES}
            onOpen={openRecord}
          />
        ) : view.kind === "equipment" ? (
          <EquipmentTree
            registryRepo={registryRepo}
            recordsRepo={repo}
            onNewITR={(e) =>
              setNewDialog({
                projectId: e.project_id,
                systemId: e.system_id,
                equipmentId: e.id,
              })
            }
          />
        ) : view.kind === "outstanding" ? (
          <OutstandingList
            repo={repo}
            registryRepo={registryRepo}
            templates={TEMPLATES}
            onOpen={openRecord}
            attachmentsRepo={attachmentsRepo}
          />
        ) : view.kind === "calibration" ? (
          <CalibrationRegister repo={instrumentsRepo} />
        ) : view.kind === "batch" ? (
          <BatchExport
            repo={repo}
            signaturesRepo={signaturesRepo}
            attachmentsRepo={attachmentsRepo}
            templates={TEMPLATES}
            ids={view.ids}
            onBack={() => setView({ kind: "register" })}
          />
        ) : (
          <RecordForm
            key={view.id}
            recordId={view.id}
            template={view.template}
            repo={repo}
            signaturesRepo={signaturesRepo}
            auditRepo={auditRepo}
            registryRepo={registryRepo}
            attachmentsRepo={attachmentsRepo}
            sync={sync}
            role={role}
            signoff={signoff}
            currentUser={currentUser}
            onBack={() => setView({ kind: "register" })}
            onRevised={openRevised}
          />
        )}
      </main>

      {newDialog !== null && (
        <NewRecordDialog
          templates={TEMPLATES}
          registryRepo={registryRepo}
          prefill={newDialog}
          onCreate={(scope) => void createFromScope(scope)}
          onCancel={() => setNewDialog(null)}
        />
      )}
    </div>
  );
}
