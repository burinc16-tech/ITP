import type { ReactNode } from "react";
import type { Signature } from "@schema";
import { formatSignedAt } from "../data/signature";
import { useForm } from "./form-context";

/**
 * One signature slot (SPEC §6 path A). Unsigned, it shows the role and a Sign
 * button that opens the signing screen. Once signed, it shows the captured image
 * with the signer's name, company, and timestamp — and offers no way to change
 * or clear it, because a captured signature is immutable (Hard Rule #6). Shared
 * by the footer block and `sign_off` sections.
 */
export function SignatureSlot(props: { sig: Signature }): ReactNode {
  const { sig } = props;
  const { signatures, onSign, canSign } = useForm();
  const signed = signatures.get(sig.id);

  if (signed) {
    return (
      <div className="signature signature-signed">
        <img
          className="signature-image"
          src={signed.image_url}
          alt={`${signed.role} signature`}
        />
        <div className="signature-meta">
          <strong>{signed.role}</strong>
          <span>{signed.name}</span>
          {signed.company && <span>{signed.company}</span>}
          <span className="signature-time">
            {formatSignedAt(signed.signed_at)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="signature">
      {canSign ? (
        <button
          type="button"
          className="signature-sign-btn"
          onClick={() => onSign(sig)}
        >
          Sign
        </button>
      ) : (
        <div className="signature-pad" aria-hidden="true">
          Not signed
        </div>
      )}
      <div className="signature-meta">
        <strong>{sig.role}</strong>
        {sig.company_default && <span>{sig.company_default}</span>}
        {sig._note && <em className="section-note">{sig._note}</em>}
      </div>
    </div>
  );
}

/**
 * The footer sign-off block (single-block templates). Multi-block templates use
 * `sign_off` sections in the flow instead — see SignOffSection.
 */
export function SignOff(): ReactNode {
  const { template } = useForm();
  const footer = template.footer;
  if (!footer) return null;

  return (
    <section className="section panel-signoff">
      <h2 className="section-title">
        {footer.no ? `${footer.no}. ` : ""}
        {footer.title ?? "Sign-off"}
      </h2>
      <div className={`signatures layout-${footer.layout ?? "stacked"}`}>
        {footer.signatures.map((sig) => (
          <SignatureSlot key={sig.id} sig={sig} />
        ))}
      </div>
    </section>
  );
}
