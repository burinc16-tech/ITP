import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Signature, Template } from "@schema";
import { createAuditEntry } from "../data/audit";
import type { AuditRepo } from "../data/audit-repo";
import { getDeviceId } from "../data/device";
import {
  createDraft,
  isoClock,
  reviseRejected,
  STUB_USER,
  templateVersionId,
  type ChecklistRecord,
  type Clock,
  type RecordStatus,
} from "../data/record";
import type { RecordsRepo } from "../data/records-repo";
import type { RegistryRepo } from "../data/registry-repo";
import type { Role } from "../data/roles";
import { saveRecord } from "../data/save";
import {
  createSignature,
  type SignatureView,
} from "../data/signature";
import type { SignaturesRepo } from "../data/signatures-repo";
import type { SignoffClient } from "../data/signoff-api";
import type { SyncLayer } from "../data/sync";
import { uuidv7 } from "../data/uuidv7";
import {
  fieldsEditable as statusFieldsEditable,
  isLocked,
  satisfiedStages,
  transition,
  type WorkflowAction,
  type WorkflowContext,
} from "../data/workflow";
import { fieldsComplete } from "../lib/completeness";
import { buildContextSnapshot } from "../lib/context-snapshot";
import { dataUrlToBlob } from "../lib/data-url";
import type { RecordValues } from "../lib/values";
import { PrintView } from "./print-view";
import { SaveBar, type SaveState } from "./save-bar";
import { SignSlot, type SignSlotInput } from "./sign-slot";
import { StatusBar } from "./status-bar";
import { RequestSignature } from "./request-signature";
import { TemplateForm } from "./template-form";

const noop = (): void => {};

// Statuses from which QA/QC can send the document out for a remote signature.
const REMOTE_REQUESTABLE: ReadonlySet<RecordStatus> = new Set<RecordStatus>([
  "completed",
  "submitted_for_witness",
  "witnessed",
]);

/**
 * Owns one record's lifecycle and connects the pure renderer to the local-first
 * save path. On mount it resumes the latest draft for this template, or creates
 * one. Every edit autosaves (debounced) through Dexie + the sync layer; an
 * explicit "Save record" flushes immediately. The form itself never persists —
 * this container decides where values go, keeping hard rule #1 intact.
 */
export function RecordForm(props: {
  template: Template;
  repo: RecordsRepo;
  signaturesRepo: SignaturesRepo;
  auditRepo: AuditRepo;
  registryRepo: RegistryRepo;
  sync: SyncLayer;
  role: Role;
  /** Remote sign-off client (QA/QC issue links). Null when the API isn't configured. */
  signoff?: SignoffClient | null;
  /** Open this specific record. Omit to resume/create the latest draft (legacy). */
  recordId?: string;
  /** Return to the register (shown when provided). */
  onBack?: () => void;
  /** Navigate to a newly created revision (register-first flow). */
  onRevised?: (recordId: string) => void;
  clock?: Clock;
  newId?: () => string;
  deviceId?: () => string;
  currentUser?: string | null;
  autosaveMs?: number;
}): ReactNode {
  const {
    template,
    repo,
    signaturesRepo,
    auditRepo,
    registryRepo,
    sync,
    role,
    signoff,
    recordId: openRecordId,
    onBack,
    onRevised,
    clock = isoClock,
    newId = uuidv7,
    deviceId = getDeviceId,
    currentUser = STUB_USER,
    autosaveMs = 800,
  } = props;

  const [record, setRecord] = useState<ChecklistRecord | null>(null);
  const [values, setValues] = useState<RecordValues | null>(null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [preview, setPreview] = useState(false);
  const [signatures, setSignatures] = useState<Map<string, SignatureView>>(
    () => new Map(),
  );
  const [signingSlot, setSigningSlot] = useState<Signature | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Object URLs backing the on-screen signature images, revoked on refresh/unmount.
  const imageUrls = useRef<string[]>([]);

  // Latest record and values, read by the debounced autosave without a stale
  // closure. Autosave persists whatever is current, so overlapping saves (e.g.
  // fast typing) converge on the newest values rather than racing.
  const recordRef = useRef<ChecklistRecord | null>(null);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);
  const valuesRef = useRef<RecordValues | null>(null);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  // Open a specific record by id, or (legacy) resume/create the latest draft.
  useEffect(() => {
    let alive = true;
    setNotFound(false);
    void (async () => {
      if (openRecordId) {
        const loaded = await repo.get(openRecordId);
        if (!alive) return;
        if (!loaded) {
          setNotFound(true);
          return;
        }
        setRecord(loaded);
        setValues(loaded.values);
        setSave({ status: "saved", at: loaded.updated_at });
        return;
      }
      const versionId = templateVersionId(template);
      // Prefer the active draft; otherwise fall back to a still-open rejected
      // record so it can be revised rather than orphaned (§6).
      const existing =
        (await repo.latestDraft(versionId)) ??
        (await repo.latestOpenRejected(versionId));
      if (!alive) return;
      const draft =
        existing ??
        createDraft(template, {
          id: newId(),
          now: clock(),
          createdBy: currentUser,
        });
      if (!existing) await repo.upsert(draft);
      if (!alive) return;
      setRecord(draft);
      setValues(draft.values);
      setSave({ status: existing ? "saved" : "idle", at: draft.updated_at });
    })();
    return () => {
      alive = false;
    };
    // Reload when the opened record changes (or template/store, in legacy mode).
  }, [openRecordId, template, repo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear any pending autosave on unmount.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Revoke any outstanding signature image URLs when the form unmounts.
  useEffect(
    () => () => {
      for (const url of imageUrls.current) URL.revokeObjectURL(url);
      imageUrls.current = [];
    },
    [],
  );

  // Load the captured signatures for a record and turn each stored blob into a
  // displayable object URL, revoking the previous batch first.
  const refreshSignatures = useCallback(
    async (recordId: string) => {
      const rows = await signaturesRepo.listByRecord(recordId);
      for (const url of imageUrls.current) URL.revokeObjectURL(url);
      const urls: string[] = [];
      const map = new Map<string, SignatureView>();
      for (const s of rows) {
        const url = URL.createObjectURL(s.image);
        urls.push(url);
        map.set(s.slot_id, {
          slot_id: s.slot_id,
          role: s.role,
          name: s.name,
          company: s.company,
          method: s.method,
          signed_at: s.signed_at,
          image_url: url,
        });
      }
      imageUrls.current = urls;
      setSignatures(map);
    },
    [signaturesRepo],
  );

  // Load signatures once the record is known (and only when its id changes).
  const recordId = record?.id;
  useEffect(() => {
    if (recordId) void refreshSignatures(recordId);
  }, [recordId, refreshSignatures]);

  // When a record is rejected, surface its reason from the audit trail (§6).
  const recordStatus = record?.status;
  useEffect(() => {
    if (!recordId || recordStatus !== "rejected") {
      setRejectionReason(null);
      return;
    }
    let alive = true;
    void (async () => {
      const entries = await auditRepo.listByRecord(recordId);
      if (!alive) return;
      const rejects = entries.filter((e) => e.after === "rejected");
      setRejectionReason(rejects.length ? rejects[rejects.length - 1]!.reason : null);
    })();
    return () => {
      alive = false;
    };
  }, [recordId, recordStatus, auditRepo]);

  const handleSign = useCallback((slot: Signature) => {
    setSigningSlot(slot);
  }, []);

  const handleConfirmSign = useCallback(
    async (input: SignSlotInput) => {
      const current = recordRef.current;
      const slot = signingSlot;
      if (!current || !slot) return;
      const signature = createSignature({
        id: newId(),
        recordId: current.id,
        slotId: slot.id,
        role: slot.role,
        name: input.name,
        company: input.company,
        image: dataUrlToBlob(input.png),
        signedByUser: currentUser,
        deviceId: deviceId(),
        now: clock(),
      });
      await signaturesRepo.add(signature);
      setSigningSlot(null);
      await refreshSignatures(current.id);
    },
    [signingSlot, newId, currentUser, deviceId, clock, signaturesRepo, refreshSignatures],
  );

  // Persist the current record + latest values through the local-first path.
  // Saves are chained so overlapping calls (fast typing) run in order and never
  // complete out of sequence — the store always ends on the newest values.
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const persist = useCallback(() => {
    saveChain.current = saveChain.current.then(async () => {
      const base = recordRef.current;
      const vals = valuesRef.current;
      if (!base || !vals) return;
      setSave({ status: "saving" });
      try {
        const saved = await saveRecord({ repo, sync, clock }, { ...base, values: vals });
        setRecord(saved);
        setSave({ status: "saved", at: saved.updated_at });
      } catch {
        setSave({ status: "error" });
      }
    });
    return saveChain.current;
  }, [repo, sync, clock]);

  const handleChange = useCallback(
    (next: RecordValues) => {
      setValues(next);
      valuesRef.current = next;
      setSave({ status: "unsaved" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist(), autosaveMs);
    },
    [autosaveMs, persist],
  );

  const handleSaveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    void persist();
  }, [persist]);

  // Apply a status transition: fold in any unsaved values, resolve the
  // context_snapshot at `completed`, save, then append the audit entry (§6/§9).
  const handleAction = useCallback(
    async (action: WorkflowAction, reason?: string) => {
      if (!record || !values) return;
      if (timer.current) clearTimeout(timer.current);
      setActionError(null);
      try {
        const now = clock();
        const ctx: WorkflowContext = {
          role,
          satisfiedStages: satisfiedStages(template, new Set(signatures.keys())),
          fieldsComplete: fieldsComplete(template, values),
        };
        // At completion, freeze the linked project/system/equipment names into
        // the record so a later rename can't alter the signed evidence (§2).
        let snapshot: ChecklistRecord["context_snapshot"] = record.context_snapshot;
        if (action === "complete") {
          const [project, system, equipment] = await Promise.all([
            record.project_id ? registryRepo.getProject(record.project_id) : undefined,
            record.system_id ? registryRepo.getSystem(record.system_id) : undefined,
            record.equipment_id ? registryRepo.getEquipment(record.equipment_id) : undefined,
          ]);
          snapshot = buildContextSnapshot(template, values, now, {
            project: project ?? null,
            system: system ?? null,
            equipment: equipment ?? null,
          });
        }
        const base: ChecklistRecord = {
          ...record,
          values,
          context_snapshot: snapshot,
        };
        const result = transition({ record: base, action, ctx, now, reason });
        const saved = await saveRecord({ repo, sync, clock }, result.record);
        await auditRepo.add(
          createAuditEntry({
            id: newId(),
            recordId: saved.id,
            user: currentUser,
            role,
            action,
            before: result.from,
            after: result.to,
            reason: reason ?? null,
            now,
          }),
        );
        setRecord(saved);
        setSave({ status: "saved", at: saved.updated_at });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Action failed");
      }
    },
    [record, values, signatures, role, template, clock, repo, sync, auditRepo, registryRepo, newId, currentUser],
  );

  // Correct a rejected record: create its next revision, save it, log the link,
  // and switch the form to the fresh draft (§6). The rejected rev is untouched.
  const handleRevise = useCallback(async () => {
    const current = recordRef.current;
    if (!current || current.status !== "rejected") return;
    setActionError(null);
    try {
      const now = clock();
      const next = reviseRejected(current, {
        id: newId(),
        now,
        createdBy: currentUser,
      });
      const saved = await saveRecord({ repo, sync, clock }, next);
      await auditRepo.add(
        createAuditEntry({
          id: newId(),
          recordId: saved.id,
          user: currentUser,
          role,
          action: "revised_from",
          before: current.status,
          after: saved.status,
          reason: `Supersedes ${current.id}`,
          now,
        }),
      );
      if (onRevised) {
        // Register-first: let the app navigate to the new revision.
        onRevised(saved.id);
      } else {
        setRejectionReason(null);
        setSignatures(new Map());
        setValues(saved.values);
        setRecord(saved);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Revise failed");
    }
  }, [clock, newId, currentUser, repo, sync, auditRepo, role, onRevised]);

  // Reflect a remote change into the local store. In 2a the only server-driven
  // status change is a rejection made via a sign-off link, so that is what this
  // adopts; the engineer sees it (and its reason) without leaving the app. A full
  // durable pull/merge — including remote signatures — is Phase 5.
  const handleSyncFromServer = useCallback(async () => {
    const current = recordRef.current;
    if (!current) return;
    setSyncNote(null);
    const server = await sync.pull(current.id);
    if (!server) {
      setSyncNote("Couldn't reach the server.");
      return;
    }
    if (server.status === current.status) {
      setSyncNote("Already up to date with the server.");
      return;
    }
    if (server.status === "rejected") {
      await repo.upsert(server);
      await auditRepo.add(
        createAuditEntry({
          id: newId(),
          recordId: server.id,
          user: currentUser,
          role,
          action: "reject",
          before: current.status,
          after: "rejected",
          reason: "Rejected remotely via signing link",
          now: clock(),
        }),
      );
      setRecord(server);
      setValues(server.values);
      setSave({ status: "saved", at: server.updated_at });
      setSyncNote("This document was rejected by the remote signer.");
    } else {
      setSyncNote(`Server status is “${server.status.replace(/_/g, " ")}”.`);
    }
  }, [sync, repo, auditRepo, newId, currentUser, role, clock]);

  if (notFound) {
    return (
      <div className="record-shell">
        <p className="record-loading">Record not found.</p>
        {onBack && (
          <button type="button" className="ghost-button" onClick={onBack}>
            Back to register
          </button>
        )}
      </div>
    );
  }

  if (!record || !values) {
    return <p className="record-loading">Loading record…</p>;
  }

  const editable = statusFieldsEditable(record.status);
  const canSign = !isLocked(record.status);
  const workflowCtx: WorkflowContext = {
    role,
    satisfiedStages: satisfiedStages(template, new Set(signatures.keys())),
    fieldsComplete: fieldsComplete(template, values),
  };

  return (
    <div className={preview ? "record-shell is-preview" : "record-shell"}>
      <div className="record-controls no-print">
        {onBack && (
          <button
            type="button"
            className="ghost-button record-back"
            onClick={onBack}
          >
            ← Register
          </button>
        )}
        {editable ? (
          <SaveBar state={save} onSave={handleSaveNow} />
        ) : (
          <span className="save-status save-saved" role="status">
            Fields locked — record is {record.status.replace(/_/g, " ")}
          </span>
        )}
        <StatusBar
          status={record.status}
          ctx={workflowCtx}
          rev={record.rev}
          rejectionReason={rejectionReason}
          error={actionError}
          onAction={(action, reason) => void handleAction(action, reason)}
          onRevise={() => void handleRevise()}
        />
        {signoff && role === "qa_qc" && REMOTE_REQUESTABLE.has(record.status) && (
          <RequestSignature client={signoff} recordId={record.id} template={template} />
        )}
        {signoff && REMOTE_REQUESTABLE.has(record.status) && (
          <div className="record-sync no-print">
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handleSyncFromServer()}
            >
              Sync from server
            </button>
            {syncNote && (
              <span className="record-sync-note" role="status">
                {syncNote}
              </span>
            )}
          </div>
        )}
        <div className="print-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? "Back to form" : "Preview print"}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => window.print()}
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="screen-view">
        <TemplateForm
          template={template}
          values={values}
          onChange={editable ? handleChange : noop}
          signatures={signatures}
          onSign={handleSign}
          locked={!editable}
          canSign={canSign}
        />
      </div>

      <PrintView
        template={template}
        values={values}
        status={record.status}
        serialNo={record.serial_no}
        signatures={signatures}
      />

      {signingSlot && (
        <SignSlot
          slot={signingSlot}
          onConfirm={handleConfirmSign}
          onCancel={() => setSigningSlot(null)}
        />
      )}
    </div>
  );
}
