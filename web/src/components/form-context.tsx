import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Signature, Template } from "@schema";
import { buildVarMap, type VarMap } from "../lib/interpolate";
import type { RecordValues } from "../lib/values";
import type { AttachmentView } from "../data/attachment";
import type { SignatureView } from "../data/signature";
import { uuidv7 } from "../data/uuidv7";

interface FormContextValue {
  template: Template;
  values: RecordValues;
  vars: VarMap;
  onChange: (next: RecordValues) => void;
  /** Mint a client id for appended ad-hoc rows (UUIDv7; injectable for tests). */
  newId: () => string;
  /** Captured signatures for the current record, keyed by slot id. */
  signatures: Map<string, SignatureView>;
  /** Open the signing screen for a slot. */
  onSign: (slot: Signature) => void;
  /** Photo attachments for the current record, keyed by field id (§8). */
  attachments: Map<string, AttachmentView[]>;
  /** Capture a photo against a field (stores the blob locally). */
  onAddPhoto: (fieldId: string, file: Blob) => void;
  /** Recaption a stored photo. */
  onCaptionPhoto: (id: string, caption: string) => void;
  /** Remove a stored photo (draft only; locked records are read-only). */
  onRemovePhoto: (id: string) => void;
  /** Field values are read-only (record is past draft). */
  locked: boolean;
  /** Signature slots are still interactive (record not yet accepted). */
  canSign: boolean;
}

const NO_SIGNATURES: Map<string, SignatureView> = new Map();
const NO_ATTACHMENTS: Map<string, AttachmentView[]> = new Map();
const noSign = (): void => {};
const noop = (): void => {};

const FormContext = createContext<FormContextValue | null>(null);

/** Access the current template, values, resolved variables, and change handler. */
export function useForm(): FormContextValue {
  const ctx = useContext(FormContext);
  if (ctx === null) {
    throw new Error("useForm must be used inside <FormProvider>");
  }
  return ctx;
}

export function FormProvider(props: {
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
  children: ReactNode;
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
    children,
  } = props;
  const vars = useMemo(
    () => buildVarMap(template.variables, values.variables),
    [template.variables, values.variables],
  );
  return (
    <FormContext.Provider
      value={{
        template,
        values,
        vars,
        onChange,
        signatures: signatures ?? NO_SIGNATURES,
        onSign: onSign ?? noSign,
        attachments: attachments ?? NO_ATTACHMENTS,
        onAddPhoto: onAddPhoto ?? noop,
        onCaptionPhoto: onCaptionPhoto ?? noop,
        onRemovePhoto: onRemovePhoto ?? noop,
        locked: locked ?? false,
        canSign: canSign ?? true,
        newId: newId ?? uuidv7,
      }}
    >
      {children}
    </FormContext.Provider>
  );
}
