import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Signature, Template } from "@schema";
import { createAttachment, type AttachmentView } from "../data/attachment";
import type { AttachmentsRepo } from "../data/attachments-repo";
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
import { subscribeConflicts, type SyncLayer } from "../data/sync";
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
import { downscaleImage } from "../lib/downscale-image";
import { appendixPhotos } from "../lib/photo-appendix";
import {
  defaultCoverOptions,
  RFI_DISCIPLINES,
  type RfiCoverOptions,
} from "../lib/rfi-cover";
import type { RecordValues } from "../lib/values";
import { PhotoAppendixPanel } from "./photo-appendix-panel";
import { PrintPhotoAppendix } from "./print-photo-appendix";
import { PrintRfiCover } from "./print-rfi-cover";
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
  /** Photo attachment store (§8). Optional so tests can omit it; the app supplies it. */
  attachmentsRepo?: AttachmentsRepo;
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
    attachmentsRepo,
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
  // Opt-in Inspection Request (RFI) cover page (handover task 2). Off by
  // default; options are seeded from the record on first enable, then the
  // user's edits win (SPEC §12).
  const [coverEnabled, setCoverEnabled] = useState(false);
  const [coverOptions, setCoverOptions] = useState<RfiCoverOptions | null>(null);
  // Opt-in photo attachment pages (SPEC §12). Off by default; the photos
  // themselves live on the record either way — the toggle only controls print.
  const [photoPagesEnabled, setPhotoPagesEnabled] = useState(false);
  const [signatures, setSignatures] = useState<Map<string, SignatureView>>(
    () => new Map(),
  );
  const [signingSlot, setSigningSlot] = useState<Signature | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  // A save that the server refused because the record is locked (§8). Shown
  // prominently and unconditionally — it can happen during any autosave.
  const [conflictNote, setConflictNote] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Map<string, AttachmentView[]>>(
    () => new Map(),
  );
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Object URLs backing the on-screen signature images, revoked on refresh/unmount.
  const imageUrls = useRef<string[]>([]);
  // Object URLs backing the on-screen photo thumbnails, revoked on refresh/unmount.
  const photoUrls = useRef<string[]>([]);
  // Debounce timers for re-pushing a photo caption, keyed by attachment id.
  const captionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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
      // Local-first create (SPEC §12 "Draft creation and sync"): a new draft is a
      // local write only. It is pushed on the first edit (autosave → saveRecord)
      // or by the Phase 5 queue — deliberately not through saveRecord here, so an
      // opened-but-untouched draft never lands an empty record on the server.
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

  // Revoke any outstanding photo thumbnail URLs and cancel pending caption
  // pushes when the form unmounts.
  useEffect(() => {
    const timers = captionTimers.current;
    return () => {
      for (const url of photoUrls.current) URL.revokeObjectURL(url);
      photoUrls.current = [];
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Load the record's photos, turning each stored blob into a thumbnail URL
  // grouped by the field it evidences, revoking the previous batch first.
  const refreshAttachments = useCallback(
    async (id: string) => {
      if (!attachmentsRepo) return;
      const rows = await attachmentsRepo.listByRecord(id);
      for (const url of photoUrls.current) URL.revokeObjectURL(url);
      const urls: string[] = [];
      const map = new Map<string, AttachmentView[]>();
      for (const a of rows) {
        const url = URL.createObjectURL(a.image);
        urls.push(url);
        const view: AttachmentView = {
          id: a.id,
          field_id: a.field_id,
          caption: a.caption,
          image_url: url,
        };
        const list = map.get(a.field_id);
        if (list) list.push(view);
        else map.set(a.field_id, [view]);
      }
      photoUrls.current = urls;
      setAttachments(map);
    },
    [attachmentsRepo],
  );

  // Load signatures once the record is known (and only when its id changes).
  const recordId = record?.id;
  useEffect(() => {
    if (recordId) void refreshSignatures(recordId);
  }, [recordId, refreshSignatures]);

  // On open, backfill photos captured on another device (§8): pull the server's
  // list and, for any we don't hold locally, fetch the image (with auth) and store
  // it, so the record's evidence is complete on this device too. Best-effort —
  // offline or local-only mode just shows what's local. Then refresh thumbnails.
  const backfillAttachments = useCallback(
    async (id: string) => {
      if (attachmentsRepo) {
        const server = await sync.pullAttachments(id);
        if (server) {
          const local = new Set((await attachmentsRepo.listByRecord(id)).map((a) => a.id));
          for (const meta of server) {
            if (local.has(meta.id)) continue;
            const image = await sync.pullAttachmentImage(id, meta.id);
            if (!image) continue;
            await attachmentsRepo.add(
              createAttachment({
                id: meta.id,
                recordId: id,
                fieldId: meta.field_id,
                image,
                mime: image.type,
                caption: meta.caption,
                deviceId: meta.device_id,
                now: meta.created_at,
              }),
            );
          }
        }
      }
      await refreshAttachments(id);
    },
    [attachmentsRepo, sync, refreshAttachments],
  );

  useEffect(() => {
    if (recordId) void backfillAttachments(recordId);
  }, [recordId, backfillAttachments]);

  // Photo capture is a local write (§8): store the blob, enqueue the upload, then
  // refresh thumbnails. The blob is durable in Dexie and the queue drives the R2
  // upload. Gated by field-editability so a locked record can't gain photos.
  const handleAddPhoto = useCallback(
    async (fieldId: string, file: Blob, caption?: string) => {
      const current = recordRef.current;
      if (!attachmentsRepo || !current || !statusFieldsEditable(current.status)) return;
      const image = await downscaleImage(file);
      const attachment = createAttachment({
        id: newId(),
        recordId: current.id,
        fieldId,
        image,
        caption,
        deviceId: deviceId(),
        now: clock(),
      });
      await attachmentsRepo.add(attachment);
      await sync.pushAttachment(attachment);
      await refreshAttachments(current.id);
    },
    [attachmentsRepo, sync, newId, deviceId, clock, refreshAttachments],
  );

  // Recaption in place — persisted, but without recreating the object URLs (which
  // would flicker every thumbnail on each keystroke). The re-upload is debounced
  // so rapid typing pushes once, not per keystroke.
  const handleCaptionPhoto = useCallback(
    async (id: string, caption: string) => {
      const current = recordRef.current;
      if (!attachmentsRepo || !current || !statusFieldsEditable(current.status)) return;
      setAttachments((prev) => {
        const next = new Map(prev);
        for (const [field, list] of next) {
          const i = list.findIndex((p) => p.id === id);
          if (i >= 0) {
            const copy = list.slice();
            copy[i] = { ...copy[i]!, caption };
            next.set(field, copy);
          }
        }
        return next;
      });
      await attachmentsRepo.setCaption(id, caption);
      const existing = captionTimers.current.get(id);
      if (existing) clearTimeout(existing);
      captionTimers.current.set(
        id,
        setTimeout(() => {
          void (async () => {
            const updated = await attachmentsRepo.get(id);
            if (updated) await sync.pushAttachment(updated);
          })();
        }, autosaveMs),
      );
    },
    [attachmentsRepo, sync, autosaveMs],
  );

  const handleRemovePhoto = useCallback(
    async (id: string) => {
      const current = recordRef.current;
      if (!attachmentsRepo || !current || !statusFieldsEditable(current.status)) return;
      await attachmentsRepo.remove(id);
      await refreshAttachments(current.id);
    },
    [attachmentsRepo, refreshAttachments],
  );

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
      await sync.pushSignature(signature);
      setSigningSlot(null);
      await refreshSignatures(current.id);
    },
    [signingSlot, newId, currentUser, deviceId, clock, signaturesRepo, sync, refreshSignatures],
  );

  // A push refused because the server copy is locked (accepted/rejected, §8):
  // warn and reload the server's version, so the form shows the truth rather than
  // the local change the server rejected. The local write already happened; this
  // reconciles it back to server state.
  const reconcileConflict = useCallback(
    async (id: string) => {
      setConflictNote(
        "This record is locked on the server (already accepted or rejected), so your change wasn't saved. Reloading the server's version.",
      );
      const server = await sync.pull(id);
      if (!server) return;
      await repo.upsert(server);
      setRecord(server);
      setValues(server.values);
      setSave({ status: "saved", at: server.updated_at });
    },
    [sync, repo],
  );

  // A queued push resolves optimistically, so a lock conflict surfaces later,
  // during a drain, via the conflict bus (§8). If it's for the record on screen,
  // reconcile to the server copy just as the synchronous save path would.
  useEffect(
    () =>
      subscribeConflicts((id) => {
        if (id === recordRef.current?.id) void reconcileConflict(id);
      }),
    [reconcileConflict],
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
        const { record: saved, conflict } = await saveRecord(
          { repo, sync, clock },
          { ...base, values: vals },
        );
        if (conflict) {
          await reconcileConflict(saved.id);
          return;
        }
        setRecord(saved);
        setSave({ status: "saved", at: saved.updated_at });
      } catch {
        setSave({ status: "error" });
      }
    });
    return saveChain.current;
  }, [repo, sync, clock, reconcileConflict]);

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
        const { record: saved, conflict } = await saveRecord(
          { repo, sync, clock },
          result.record,
        );
        if (conflict) {
          // The server has a locked version; the transition didn't take. Warn and
          // reconcile instead of logging an audit entry for a change that was refused.
          await reconcileConflict(saved.id);
          return;
        }
        const auditEntry = createAuditEntry({
          id: newId(),
          recordId: saved.id,
          user: currentUser,
          role,
          action,
          before: result.from,
          after: result.to,
          reason: reason ?? null,
          now,
        });
        await auditRepo.add(auditEntry);
        await sync.pushAudit(auditEntry);
        setRecord(saved);
        setSave({ status: "saved", at: saved.updated_at });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Action failed");
      }
    },
    [record, values, signatures, role, template, clock, repo, sync, auditRepo, registryRepo, newId, currentUser, reconcileConflict],
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
      // A revision always has a fresh id the server has never seen, so it can't
      // hit a lock conflict — take the record and move on.
      const { record: saved } = await saveRecord({ repo, sync, clock }, next);
      const auditEntry = createAuditEntry({
        id: newId(),
        recordId: saved.id,
        user: currentUser,
        role,
        action: "revised_from",
        before: current.status,
        after: saved.status,
        reason: `Supersedes ${current.id}`,
        now,
      });
      await auditRepo.add(auditEntry);
      await sync.pushAudit(auditEntry);
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
      // Local mirror of a server-authored rejection: the server already logged
      // its own audit entry when the link was rejected (§6), so this one is not
      // pushed back — it only records locally that the client observed it.
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
        {conflictNote && (
          <p className="record-conflict" role="alert">
            {conflictNote}
          </p>
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
          <label className="cover-toggle">
            <input
              type="checkbox"
              checked={coverEnabled}
              onChange={(e) => {
                const on = e.target.checked;
                setCoverEnabled(on);
                if (on && !coverOptions) {
                  setCoverOptions(defaultCoverOptions(template, values, record));
                }
              }}
            />
            Include Inspection Request cover page
          </label>
          <label className="cover-toggle">
            <input
              type="checkbox"
              checked={photoPagesEnabled}
              onChange={(e) => setPhotoPagesEnabled(e.target.checked)}
            />
            Include photo attachment pages
            {appendixPhotos(attachments).length > 0
              ? ` (${appendixPhotos(attachments).length} photo${appendixPhotos(attachments).length === 1 ? "" : "s"})`
              : " (no photos added yet)"}
          </label>
        </div>

        {coverEnabled && coverOptions && (
          <CoverOptionsPanel
            options={coverOptions}
            onChange={setCoverOptions}
            onReset={() =>
              setCoverOptions(defaultCoverOptions(template, values, record))
            }
          />
        )}
      </div>

      <div className="screen-view">
        <TemplateForm
          template={template}
          values={values}
          onChange={editable ? handleChange : noop}
          signatures={signatures}
          onSign={handleSign}
          attachments={attachments}
          onAddPhoto={handleAddPhoto}
          onCaptionPhoto={handleCaptionPhoto}
          onRemovePhoto={handleRemovePhoto}
          locked={!editable}
          canSign={canSign}
          newId={newId}
        />
        {attachmentsRepo && (
          <PhotoAppendixPanel
            photos={appendixPhotos(attachments)}
            onAddPhoto={(fieldId, file, caption) =>
              void handleAddPhoto(fieldId, file, caption)
            }
            onCaptionPhoto={(id, caption) => void handleCaptionPhoto(id, caption)}
            onRemovePhoto={(id) => void handleRemovePhoto(id)}
            locked={!editable}
          />
        )}
      </div>

      {coverEnabled && coverOptions && (
        <div className="print-doc rfi-cover-doc">
          <PrintRfiCover
            template={template}
            record={record}
            options={coverOptions}
            status={record.status}
            signatures={signatures}
          />
        </div>
      )}

      <PrintView
        template={template}
        values={values}
        status={record.status}
        serialNo={record.serial_no}
        signatures={signatures}
        attachments={attachments}
      />

      {photoPagesEnabled && (
        <div className="print-doc photo-appendix-doc">
          <PrintPhotoAppendix
            template={template}
            photos={appendixPhotos(attachments)}
            status={record.status}
            serialNo={record.serial_no}
          />
        </div>
      )}

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

/**
 * Print-step editor for the RFI cover (handover task 2). The discipline is
 * user-chosen (SPEC §12) and the app-filled text fields are pre-seeded but
 * editable — the user's edits are what print. Manual on-site fields (IRF No.,
 * Scope, Result, Inspector sign-off) are not here; they print as blank boxes.
 */
function CoverOptionsPanel(props: {
  options: RfiCoverOptions;
  onChange: (next: RfiCoverOptions) => void;
  onReset: () => void;
}): ReactNode {
  const { options, onChange, onReset } = props;
  const set = <K extends keyof RfiCoverOptions>(
    key: K,
    value: RfiCoverOptions[K],
  ): void => onChange({ ...options, [key]: value });

  const field = (
    key: keyof RfiCoverOptions,
    label: string,
  ): ReactNode => (
    <label className="cover-field">
      <span>{label}</span>
      <input
        type="text"
        value={options[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );

  return (
    <div className="cover-options no-print">
      <div className="cover-options-head">
        <strong>Inspection Request cover — details</strong>
        <button type="button" className="ghost-button" onClick={onReset}>
          Reset to record
        </button>
      </div>

      <fieldset className="cover-discipline">
        <legend>Discipline</legend>
        {RFI_DISCIPLINES.map((d) => (
          <label key={d.value} className="cover-radio">
            <input
              type="radio"
              name="rfi-discipline"
              checked={options.discipline === d.value}
              onChange={() => set("discipline", d.value)}
            />
            {d.label}
          </label>
        ))}
        {options.discipline === "other" && (
          <input
            type="text"
            className="cover-other"
            placeholder="Please specify"
            value={options.otherText}
            onChange={(e) => set("otherText", e.target.value)}
          />
        )}
      </fieldset>

      <div className="cover-fields">
        {field("project", "Project")}
        {field("contractor", "Contractor")}
        {field("drawingNo", "Drawing No.")}
        {field("ref", "Ref.")}
        {field("floor", "Floor")}
        {field("area", "Area")}
        {field("date", "Date")}
        {field("activity", "Activity")}
      </div>
    </div>
  );
}
