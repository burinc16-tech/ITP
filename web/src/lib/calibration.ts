import type { Instrument } from "../data/instrument";

/**
 * Calibration-standing rules for the register (SPEC §10 screen 9). Pure so the
 * screen and its tests share one definition of "expired" — a wrong rule here
 * would let an out-of-calibration instrument read as valid, which invalidates the
 * test evidence it supports.
 *
 * Dates are compared as calendar days (`YYYY-MM-DD` at UTC midnight), never as
 * timestamps, so a certificate due "today" is valid all of today regardless of
 * the device's time zone.
 */
export type CalStatus = "valid" | "due_soon" | "expired";

export interface CalStanding {
  status: CalStatus;
  /** Whole calendar days from `asOf` to the due date; negative once overdue. */
  daysUntilDue: number;
}

const DAY_MS = 86_400_000;

/** Parse a `YYYY-MM-DD` date to a UTC-midnight epoch, or NaN if malformed. */
function dayEpoch(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Whole calendar days from `from` to `to` (`to - from`); NaN if either is bad. */
export function daysBetween(from: string, to: string): number {
  const a = dayEpoch(from);
  const b = dayEpoch(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / DAY_MS);
}

/**
 * An instrument's standing as of `asOf` (a `YYYY-MM-DD` date, usually today).
 * Expired once the due date has passed; due-soon within `soonDays` ahead; valid
 * otherwise. A due date equal to `asOf` is still valid (0 days left) — the cert
 * covers its due day.
 */
export function calibrationStanding(
  dueDate: string,
  asOf: string,
  soonDays = 30,
): CalStanding {
  const daysUntilDue = daysBetween(asOf, dueDate);
  if (Number.isNaN(daysUntilDue)) return { status: "expired", daysUntilDue: NaN };
  if (daysUntilDue < 0) return { status: "expired", daysUntilDue };
  if (daysUntilDue <= soonDays) return { status: "due_soon", daysUntilDue };
  return { status: "valid", daysUntilDue };
}

/**
 * Whether an instrument's calibration covered a given use date — the basis for an
 * expired-use warning when a record's test date is compared against the
 * instruments it used (record↔instrument linking, a later task). Valid when the
 * use date is on or after the cal date and on or before the due date.
 */
export function certValidOn(instrument: Instrument, useDate: string): boolean {
  const fromCal = daysBetween(instrument.cal_date, useDate);
  const toDue = daysBetween(useDate, instrument.cal_due_date);
  if (Number.isNaN(fromCal) || Number.isNaN(toDue)) return false;
  return fromCal >= 0 && toDue >= 0;
}
