import type { ReactNode } from "react";
import type { Signature, Template } from "@schema";
import type { AttachmentView } from "../data/attachment";
import type { Instrument } from "../data/instrument";
import type { SignatureView } from "../data/signature";
import type { RecordValues } from "../lib/values";
import { FormProvider } from "./form-context";
import { FormHeader } from "./form-header";
import { FormSection } from "./form-section";
import { SignOff } from "./sign-off";
import { VariablesPanel } from "./variables-panel";

/**
 * The generic, JSON-driven checklist renderer. Given any template and a values
 * object it renders a fillable form; it never persists — the parent owns the
 * values and decides where they go (the sync layer, per SPEC §8). This keeps the
 * "form never calls the API directly" boundary intact.
 */
export function TemplateForm(props: {
  template: Template;
  values: RecordValues;
  onChange: (next: RecordValues) => void;
  signatures?: Map<string, SignatureView>;
  onSign?: (slot: Signature) => void;
  attachments?: Map<string, AttachmentView[]>;
  onAddPhoto?: (fieldId: string, file: Blob) => void;
  onCaptionPhoto?: (id: string, caption: string) => void;
  onRemovePhoto?: (id: string) => void;
  locked?: boolean;
  canSign?: boolean;
  newId?: () => string;
  /** Calibration register, for tables flagged `link_to_instrument_register`. */
  instruments?: Instrument[];
}): ReactNode {
  const {
    template,
    values,
    onChange,
    signatures,
    onSign,
    attachments,
    onAddPhoto,
    onCaptionPhoto,
    onRemovePhoto,
    locked,
    canSign,
    newId,
    instruments,
  } = props;
  return (
    <FormProvider
      template={template}
      values={values}
      onChange={onChange}
      signatures={signatures}
      onSign={onSign}
      attachments={attachments}
      onAddPhoto={onAddPhoto}
      onCaptionPhoto={onCaptionPhoto}
      onRemovePhoto={onRemovePhoto}
      locked={locked}
      canSign={canSign}
      newId={newId}
      instruments={instruments}
    >
      <form
        className={locked ? "template-form template-form-locked" : "template-form"}
        onSubmit={(e) => e.preventDefault()}
      >
        <VariablesPanel />
        <FormHeader />
        {template.sections.map((section) => (
          <FormSection key={section.id} section={section} />
        ))}
        <SignOff />
      </form>
    </FormProvider>
  );
}
