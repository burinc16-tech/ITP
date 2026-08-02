import type { Limit } from "@schema";

export type Verdict = "pass" | "fail";

/**
 * Evaluate a numeric reading against its limit.
 *
 * Returns `null` when there is nothing to judge (empty or non-numeric input),
 * so the UI shows no verdict rather than a misleading Pass/Fail. Bounds are
 * inclusive: a reading exactly on `min` or `max` passes.
 */
export function evaluateLimit(
  value: number | null,
  limit: Limit,
): Verdict | null {
  if (value === null || Number.isNaN(value)) return null;
  if (limit.min !== undefined && value < limit.min) return "fail";
  if (limit.max !== undefined && value > limit.max) return "fail";
  return "pass";
}

/** Parse a raw input string to a number, or null if it is not a finite number. */
export function toNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}
