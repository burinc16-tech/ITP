import type { ReactNode } from "react";
import type { Footer, Signature } from "@schema";
import { formatSignedAt, type SignatureView } from "../data/signature";

/**
 * The signature grid as printed. An unsigned slot prints role, company, and
 * empty ruled lines / a signature box — exactly like the paper form. A signed
 * slot prints the captured image plus name, company, and date (SPEC §7). Shared
 * by the footer block and `sign_off` sections (SPEC §12).
 */
export function PrintSignatureGrid(props: {
  signatures: Signature[];
  captured?: Map<string, SignatureView>;
}): ReactNode {
  const { signatures, captured } = props;
  return (
    <div className="print-signoff-grid">
      {signatures.map((sig) => {
        const signed = captured?.get(sig.id);
        return (
          <div key={sig.id} className="print-sign-col">
            <h3>{sig.role}</h3>
            <SignRow label="Name" value={signed?.name} />
            <SignRow
              label="Company"
              value={signed?.company || sig.company_default}
            />
            <div className="print-sign-row print-sign-sigrow">
              <span className="print-sign-lbl">Signature</span>
              <span className="print-colon">:</span>
              {signed ? (
                <span className="print-sign-pad print-sign-pad-filled">
                  <img className="print-sign-img" src={signed.image_url} alt="" />
                </span>
              ) : (
                <span className="print-sign-pad" />
              )}
            </div>
            <SignRow
              label="Date"
              value={signed ? formatSignedAt(signed.signed_at) : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

/** The footer sign-off block as printed (single-block templates). */
export function PrintSignOff(props: {
  footer: Footer;
  captured?: Map<string, SignatureView>;
}): ReactNode {
  const { footer, captured } = props;
  return (
    <>
      <h1 className="print-section-title">
        {footer.no ?? ""}
        <span />
        {footer.title ?? "Sign-off"}
      </h1>
      <PrintSignatureGrid signatures={footer.signatures} captured={captured} />
    </>
  );
}

function SignRow(props: { label: string; value?: string }): ReactNode {
  return (
    <div className="print-sign-row">
      <span className="print-sign-lbl">{props.label}</span>
      <span className="print-colon">:</span>
      <span className="print-sign-fld">{props.value ?? ""}</span>
    </div>
  );
}
