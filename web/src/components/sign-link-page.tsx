import { useEffect, useState, type ReactNode } from "react";
import type { Template } from "@schema";
import type { AttachmentView } from "../data/attachment";
import { templateFor } from "../data/record";
import { formatSignedAt } from "../data/signature";
import {
  openSignLink,
  rejectSignLink,
  submitSignature,
  type SignLinkError,
  type SignLinkView,
} from "../data/signoff-api";
import { SignatureCapture } from "./signature-capture";
import { PrintView } from "./print-view";
import "../styles.css";

const ERROR_MESSAGE: Record<SignLinkError, string> = {
  unknown: "This signing link is not valid. Please check the link, or ask for a new one.",
  closed: "This link has already been used or was cancelled. Nothing more to do here.",
  expired: "This signing link has expired. Please ask the sender for a fresh link.",
  version_mismatch:
    "The document changed after this link was sent, so it can no longer be signed. Please ask the sender for an updated link.",
  error: "Something went wrong reaching the server. Please check your connection and try again.",
};

type Phase = "loading" | "ready" | "signed" | "rejected";

/**
 * The account-less public signing page (SPEC §6 path B, §10 screen 5 for a
 * remote signer). Reached at the top-level `/sign/:token` route with NO app
 * chrome and NO local database — everything comes from the tokenized link. The
 * signer reviews the record read-only, then either draws a signature or rejects
 * with a reason. The single-use token is the only credential.
 *
 * `fetchImpl` is injectable for tests; in the app it defaults to `fetch`.
 */
export function SignLinkPage(props: {
  token: string;
  baseUrl: string;
  templates: Template[];
  fetchImpl?: typeof fetch;
}): ReactNode {
  const { token, baseUrl, templates, fetchImpl } = props;

  const [phase, setPhase] = useState<Phase>("loading");
  const [view, setView] = useState<SignLinkView | null>(null);
  const [loadError, setLoadError] = useState<SignLinkError | null>(null);

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [png, setPng] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setLoadError(null);
    void (async () => {
      const result = await openSignLink(baseUrl, token, fetchImpl);
      if (!alive) return;
      if (!result.ok) {
        setLoadError(result.kind);
        return;
      }
      setView(result.view);
      setName(result.view.recipient.name ?? "");
      setPhase("ready");
    })();
    return () => {
      alive = false;
    };
  }, [baseUrl, token, fetchImpl]);

  const failMessage = (kind: SignLinkError): void => {
    // A closed/expired/version error means the link is now dead — surface it as a
    // terminal load error rather than an inline action hint.
    if (kind === "error") {
      setActionError(ERROR_MESSAGE.error);
    } else {
      setLoadError(kind);
    }
    setBusy(false);
  };

  const confirmSign = async (): Promise<void> => {
    if (!png || name.trim().length === 0 || busy) return;
    setBusy(true);
    setActionError(null);
    const result = await submitSignature(
      baseUrl,
      token,
      { image: png, name: name.trim(), company: company.trim() },
      fetchImpl,
    );
    if (result.ok) {
      setPhase("signed");
    } else {
      failMessage(result.kind);
    }
  };

  const confirmReject = async (): Promise<void> => {
    if (reason.trim().length === 0 || busy) return;
    setBusy(true);
    setActionError(null);
    const result = await rejectSignLink(baseUrl, token, reason.trim(), fetchImpl);
    if (result.ok) {
      setPhase("rejected");
    } else {
      failMessage(result.kind);
    }
  };

  if (loadError) {
    return (
      <Shell>
        <div className="sign-page-notice" role="alert">
          <h2>Unable to sign</h2>
          <p>{ERROR_MESSAGE[loadError]}</p>
        </div>
      </Shell>
    );
  }

  if (phase === "loading" || !view) {
    return (
      <Shell>
        <p className="sign-page-loading">Loading document…</p>
      </Shell>
    );
  }

  if (phase === "signed") {
    return (
      <Shell>
        <div className="sign-page-notice sign-page-ok" role="status">
          <h2>Signature received</h2>
          <p>
            Thank you, {name || view.recipient.email}. Your signature for{" "}
            <strong>{view.slot.role}</strong> has been recorded. You can close this page.
          </p>
        </div>
      </Shell>
    );
  }

  if (phase === "rejected") {
    return (
      <Shell>
        <div className="sign-page-notice" role="status">
          <h2>Rejection recorded</h2>
          <p>
            The document has been marked as rejected and the sender has been notified. You can
            close this page.
          </p>
        </div>
      </Shell>
    );
  }

  const template = templateFor(view.record, templates);
  const values = view.record.values;
  if (!template || !values) {
    return (
      <Shell>
        <div className="sign-page-notice" role="alert">
          <h2>Unable to display document</h2>
          <p>This document can't be shown for signing. Please contact the sender.</p>
        </div>
      </Shell>
    );
  }

  const ready = png !== null && name.trim().length > 0;

  // Each photo's image is fetched from the token-gated route — the signer has no
  // account, so the URL itself carries the credential (§6, §8).
  const photos = new Map<string, AttachmentView[]>();
  const apiBase = baseUrl.replace(/\/$/, "");
  for (const a of view.attachments ?? []) {
    const image_url = `${apiBase}/api/sign/${token}/attachments/${a.id}`;
    const entry: AttachmentView = { id: a.id, field_id: a.field_id, caption: a.caption, image_url };
    const list = photos.get(a.field_id);
    if (list) list.push(entry);
    else photos.set(a.field_id, [entry]);
  }

  return (
    <Shell>
      <div className="sign-page-intro">
        <h2>Signature requested</h2>
        <p>
          You have been asked to sign as <strong>{view.slot.role}</strong>. Please review the
          document below, then sign or reject it.
        </p>
        <p className="sign-page-expiry">Link valid until {formatSignedAt(view.expires_at)}.</p>
      </div>

      <div className="sign-page-doc">
        <PrintView
          template={template}
          values={values}
          status={view.record.status}
          serialNo={view.record.serial_no ?? null}
          attachments={photos}
        />
      </div>

      {actionError && (
        <p className="status-error" role="alert">
          {actionError}
        </p>
      )}

      {!rejecting ? (
        <div className="sign-page-panel">
          <h3>Sign as {view.slot.role}</h3>
          <div className="sign-fields">
            <label className="sign-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="sign-field">
              <span>Company</span>
              <input
                type="text"
                value={company}
                autoComplete="organization"
                onChange={(e) => setCompany(e.target.value)}
              />
            </label>
          </div>
          <SignatureCapture ariaLabel={`Signature for ${view.slot.role}`} onChange={setPng} />
          <div className="sign-page-actions">
            <button
              type="button"
              className="save-button"
              disabled={!ready || busy}
              onClick={() => void confirmSign()}
            >
              {busy ? "Submitting…" : "Confirm signature"}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() => setRejecting(true)}
            >
              Reject
            </button>
          </div>
        </div>
      ) : (
        <div className="sign-page-panel">
          <h3>Reject this document</h3>
          <label className="sign-field">
            <span>Reason for rejection</span>
            <textarea value={reason} rows={3} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="sign-page-actions">
            <button
              type="button"
              className="save-button"
              disabled={reason.trim().length === 0 || busy}
              onClick={() => void confirmReject()}
            >
              {busy ? "Submitting…" : "Confirm rejection"}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

/** Minimal branded wrapper — deliberately no app navigation or role picker. */
function Shell(props: { children: ReactNode }): ReactNode {
  return (
    <div className="sign-page">
      <header className="sign-page-bar">
        <h1>Kenyon Pte Ltd</h1>
        <p>Testing &amp; Commissioning — Document signing</p>
      </header>
      <main className="sign-page-main">{props.children}</main>
    </div>
  );
}
