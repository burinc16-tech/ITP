import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Signature, Template } from "@schema";
import { buildVarMap, type VarMap } from "../lib/interpolate";
import type { RecordValues } from "../lib/values";
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
  /** Field values are read-only (record is past draft). */
  locked: boolean;
  /** Signature slots are still interactive (record not yet accepted). */
  canSign: boolean;
}

const NO_SIGNATURES: Map<string, SignatureView> = new Map();
const noSign = (): void => {};

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
  locked?: boolean;
  canSign?: boolean;
  newId?: () => string;
  children: ReactNode;
}): ReactNode {
  const { template, values, onChange, signatures, onSign, locked, canSign, newId, children } =
    props;
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
        locked: locked ?? false,
        canSign: canSign ?? true,
        newId: newId ?? uuidv7,
      }}
    >
      {children}
    </FormContext.Provider>
  );
}
