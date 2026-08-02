import { useMemo, useState, type ReactNode } from "react";
import type { Template } from "@schema";
import { collectSignatureSlots } from "../data/workflow";
import type { IssuedRequest, SignoffClient } from "../data/signoff-api";

/**
 * In-app "Request remote signature" panel (SPEC §6 path B, QA/QC side). Lets QA/QC
 * issue a tokenized link for one of the record's signature slots to an external
 * signer, then shows the link to copy (email delivery is a later task). The record
 * must already be synced to the server — ApiSync pushes it on save.
 *
 * Only rendered when the API is configured (a `client` is present) and the acting
 * role is QA/QC; the parent decides that.
 */
export function RequestSignature(props: {
  client: SignoffClient;
  recordId: string;
  template: Template;
  /** Clock injected for testability; defaults to the real one via toLocaleString. */
  onIssued?: (req: IssuedRequest) => void;
}): ReactNode {
  const { client, recordId, template, onIssued } = props;

  const slots = useMemo(() => collectSignatureSlots(template), [template]);
  const [slotId, setSlotId] = useState(slots[0]?.id ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedRequest | null>(null);
  const [copied, setCopied] = useState(false);

  if (slots.length === 0) return null;

  const slot = slots.find((s) => s.id === slotId) ?? slots[0]!;
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const ready = slotId.length > 0 && emailValid && !busy;

  const issue = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const req = await client.issue(recordId, {
        slot_id: slot.id,
        role: slot.role,
        recipient_name: name.trim() || null,
        recipient_email: email.trim(),
      });
      setIssued(req);
      onIssued?.(req);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not issue the link.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!issued) return;
    try {
      await navigator.clipboard?.writeText(issued.url);
      setCopied(true);
    } catch {
      // Clipboard may be blocked (insecure context) — the link is shown to copy manually.
      setCopied(false);
    }
  };

  return (
    <details className="request-signature no-print">
      <summary>Request remote signature</summary>
      <div className="request-signature-body">
        {issued ? (
          <div className="request-signature-issued">
            <p>
              {issued.emailed ? (
                <>
                  Link emailed to {email.trim()} for <strong>{slot.role}</strong>. You can also
                  share it directly:
                </>
              ) : (
                <>
                  Link issued for <strong>{slot.role}</strong>, but the email could not be sent —
                  please share it with the signer:
                </>
              )}
            </p>
            <div className="request-signature-link">
              <input type="text" readOnly value={issued.url} aria-label="Signing link" />
              <button type="button" className="ghost-button" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setIssued(null);
                setName("");
                setEmail("");
              }}
            >
              Issue another
            </button>
          </div>
        ) : (
          <>
            <div className="sign-fields">
              <label className="sign-field">
                <span>Signature slot</span>
                <select value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                  {slots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sign-field">
                <span>Recipient name (optional)</span>
                <input
                  type="text"
                  value={name}
                  autoComplete="name"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="sign-field">
                <span>Recipient email</span>
                <input
                  type="email"
                  value={email}
                  autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            </div>
            {error && (
              <p className="status-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              className="save-button"
              disabled={!ready}
              onClick={() => void issue()}
            >
              {busy ? "Issuing…" : "Issue signing link"}
            </button>
          </>
        )}
      </div>
    </details>
  );
}
