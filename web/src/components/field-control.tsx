import type { ReactNode } from "react";
import type { FieldType, Limit, StatusState } from "@schema";
import { evaluateLimit, toNumber } from "../lib/evaluate";

/**
 * The single place that maps a field type to an input control. Adding a new
 * field type (CLAUDE.md convention) means adding one `case` here — nothing
 * elsewhere hardcodes how a type is rendered.
 */
export interface FieldControlProps {
  type: FieldType;
  value: string;
  onChange: (value: string) => void;
  id: string;
  ariaLabel?: string;
  unit?: string;
  options?: string[];
  limit?: Limit;
  labels?: string[];
  /** Declared states for a `status` field (SPEC §12). */
  states?: StatusState[];
  readonly?: boolean;
  align?: "left" | "center" | "right";
}

const DEFAULT_PASS_FAIL_NA = ["Pass", "Fail", "N/A"];
const PASS_FAIL_NA_STATES = ["pass", "fail", "na"] as const;

export function FieldControl(props: FieldControlProps): ReactNode {
  const {
    type,
    value,
    onChange,
    id,
    ariaLabel,
    unit,
    options,
    limit,
    labels,
    states,
    readonly,
    align,
  } = props;

  const style = align ? { textAlign: align } : undefined;

  switch (type) {
    case "email":
      return (
        <input
          id={id}
          type="email"
          aria-label={ariaLabel}
          value={value}
          readOnly={readonly}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "tel":
      return (
        <input
          id={id}
          type="tel"
          aria-label={ariaLabel}
          value={value}
          readOnly={readonly}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "textarea":
      return (
        <textarea
          id={id}
          aria-label={ariaLabel}
          value={value}
          readOnly={readonly}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
        />
      );

    case "number": {
      const verdict = limit ? evaluateLimit(toNumber(value), limit) : null;
      return (
        <span className="field-number">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            aria-label={ariaLabel}
            value={value}
            readOnly={readonly}
            style={style}
            onChange={(e) => onChange(e.target.value)}
          />
          {unit && <span className="field-unit">{unit}</span>}
          {verdict && (
            <span className={`verdict verdict-${verdict}`} role="status">
              {verdict === "pass" ? "Pass" : "Fail"}
            </span>
          )}
        </span>
      );
    }

    case "pass_fail_na": {
      const words = labels ?? DEFAULT_PASS_FAIL_NA;
      return (
        <span className="field-pfn" role="group" aria-label={ariaLabel}>
          {PASS_FAIL_NA_STATES.map((state, i) => (
            <button
              key={state}
              type="button"
              className={`pfn-option pfn-${state}`}
              aria-pressed={value === state}
              onClick={() => onChange(value === state ? "" : state)}
            >
              {words[i] ?? state}
            </button>
          ))}
        </span>
      );
    }

    case "status": {
      const declared = states ?? [];
      return (
        <span className="field-status" role="group" aria-label={ariaLabel}>
          {declared.map((state) => (
            <button
              key={state.value}
              type="button"
              className={`status-option status-${state.outcome}`}
              aria-pressed={value === state.value}
              onClick={() => onChange(value === state.value ? "" : state.value)}
            >
              {state.label}
            </button>
          ))}
        </span>
      );
    }

    case "checkbox":
      return (
        <input
          id={id}
          type="checkbox"
          aria-label={ariaLabel}
          checked={value === "true"}
          disabled={readonly}
          onChange={(e) => onChange(e.target.checked ? "true" : "")}
        />
      );

    case "dropdown":
      return (
        <select
          id={id}
          aria-label={ariaLabel}
          value={value}
          disabled={readonly}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {(options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case "date":
      return (
        <input
          id={id}
          type="date"
          aria-label={ariaLabel}
          value={value}
          readOnly={readonly}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "time":
      return (
        <input
          id={id}
          type="time"
          aria-label={ariaLabel}
          value={value}
          readOnly={readonly}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "duration":
      return (
        <input
          id={id}
          type="text"
          aria-label={ariaLabel}
          value={value}
          readOnly={readonly}
          placeholder="e.g. 5min 23s"
          onChange={(e) => onChange(e.target.value)}
        />
      );

    // Not built in Phase 1 — rendered as clear placeholders so a template that
    // uses them still lays out, without pretending the capture works yet.
    case "photo":
      return <PlaceholderControl label="Photo capture — Phase 2" />;
    case "signature":
      return <PlaceholderControl label="Signature — Phase 3" />;
    case "calculated":
      return (
        <output id={id} className="field-calculated">
          {value || "—"}
        </output>
      );

    case "text":
    default:
      return (
        <input
          id={id}
          type="text"
          aria-label={ariaLabel}
          value={value}
          readOnly={readonly}
          style={style}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function PlaceholderControl({ label }: { label: string }): ReactNode {
  return (
    <span className="field-placeholder" aria-disabled="true">
      {label}
    </span>
  );
}
