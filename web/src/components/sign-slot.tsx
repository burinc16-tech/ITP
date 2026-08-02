import { useState, type ReactNode } from "react";
import type { Signature } from "@schema";
import { SignatureCapture } from "./signature-capture";

export interface SignSlotInput {
  name: string;
  company: string;
  /** White-backed PNG data URL from the pad. */
  png: string;
}

/**
 * Full-screen signing screen (SPEC §10 screen 5, §6 path A). The signer picks up
 * the device, sees their role, types name and company, draws, and confirms. It
 * is a controlled dialog — it captures input and hands it back through
 * `onConfirm`; persistence and evidence stamping happen in the owner (RecordForm).
 *
 * Company is prefilled from the slot's `company_default` and shown read-only when
 * the slot sets `company_locked`, so a fixed contractor company can't be edited.
 */
export function SignSlot(props: {
  slot: Signature;
  onConfirm: (input: SignSlotInput) => void;
  onCancel: () => void;
}): ReactNode {
  const { slot, onConfirm, onCancel } = props;
  const [name, setName] = useState("");
  const [company, setCompany] = useState(slot.company_default ?? "");
  const [png, setPng] = useState<string | null>(null);

  const companyLocked = slot.company_locked === true;
  const ready = name.trim().length > 0 && png !== null;

  const confirm = () => {
    if (!ready || png === null) return;
    onConfirm({ name: name.trim(), company: company.trim(), png });
  };

  return (
    <div
      className="sign-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Sign as ${slot.role}`}
    >
      <div className="sign-dialog">
        <header className="sign-dialog-head">
          <h2>{slot.role}</h2>
          <button
            type="button"
            className="ghost-button"
            onClick={onCancel}
          >
            Cancel
          </button>
        </header>

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
              readOnly={companyLocked}
              autoComplete="organization"
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>
        </div>

        <SignatureCapture
          ariaLabel={`Signature for ${slot.role}`}
          onChange={setPng}
        />

        <div className="sign-dialog-actions">
          <button
            type="button"
            className="save-button"
            onClick={confirm}
            disabled={!ready}
          >
            Confirm signature
          </button>
        </div>
      </div>
    </div>
  );
}
