import type { FieldType } from "@schema";

const DEFAULT_PASS_FAIL_NA = ["Pass", "Fail", "N/A"];
const PASS_FAIL_NA_INDEX: Record<string, number> = { pass: 0, fail: 1, na: 2 };

/**
 * Format a stored value as the plain text that appears on the printed form
 * (SPEC §7 "values render as plain text"). Three-state controls print their
 * displayed word, not the semantic state; an empty value prints blank.
 */
export function formatFieldValue(
  type: FieldType,
  value: string,
  opts: {
    labels?: string[];
    unit?: string;
    states?: { value: string; label: string }[];
  } = {},
): string {
  if (value === "") return "";
  switch (type) {
    case "pass_fail_na": {
      const labels = opts.labels ?? DEFAULT_PASS_FAIL_NA;
      const index = PASS_FAIL_NA_INDEX[value];
      return index === undefined ? value : (labels[index] ?? value);
    }
    case "status": {
      // An N-state control prints its displayed label, not the stored value.
      const state = opts.states?.find((s) => s.value === value);
      return state ? state.label : value;
    }
    case "checkbox":
      return value === "true" ? "✓" : "";
    case "number":
      return opts.unit ? `${value} ${opts.unit}` : value;
    case "date":
      return formatIsoDate(value);
    default:
      return value;
  }
}

/** ISO `YYYY-MM-DD` → `dd/mm/yyyy` (CLAUDE.md display convention); else unchanged. */
function formatIsoDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}
