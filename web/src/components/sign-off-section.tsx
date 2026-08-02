import type { ReactNode } from "react";
import type { SignOffSection as SignOffSectionDef } from "@schema";
import { SignatureSlot } from "./sign-off";

/**
 * A sign-off block placed in the section flow (SPEC §12) — for templates with
 * more than one signature group or per-page roles, e.g. the three Power Turn-on
 * pages. Single-block templates use the top-level footer (see SignOff) instead.
 */
export function SignOffSection(props: {
  section: SignOffSectionDef;
}): ReactNode {
  const { section } = props;
  return (
    <section className="section panel-signoff">
      <h2 className="section-title">
        {section.no ? `${section.no}. ` : ""}
        {section.title ?? "Sign-off"}
      </h2>
      <div className={`signatures layout-${section.layout ?? "stacked"}`}>
        {section.signatures.map((sig) => (
          <SignatureSlot key={sig.id} sig={sig} />
        ))}
      </div>
    </section>
  );
}
