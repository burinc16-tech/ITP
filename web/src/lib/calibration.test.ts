import { describe, it, expect } from "vitest";
import type { Instrument } from "../data/instrument";
import { calibrationStanding, certValidOn, daysBetween } from "./calibration";

describe("daysBetween", () => {
  it("counts whole calendar days, signed", () => {
    expect(daysBetween("2026-08-04", "2026-08-04")).toBe(0);
    expect(daysBetween("2026-08-04", "2026-08-05")).toBe(1);
    expect(daysBetween("2026-08-05", "2026-08-04")).toBe(-1);
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
  });

  it("crosses a leap day correctly", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2); // 2024 is a leap year
  });

  it("returns NaN for a malformed date", () => {
    expect(daysBetween("", "2026-08-04")).toBeNaN();
    expect(daysBetween("2026-8-4", "2026-08-04")).toBeNaN();
  });
});

describe("calibrationStanding", () => {
  const asOf = "2026-08-04";

  it("is valid when the due date is comfortably ahead", () => {
    expect(calibrationStanding("2026-12-31", asOf)).toEqual({ status: "valid", daysUntilDue: 149 });
  });

  it("is due_soon within the window, valid just outside it", () => {
    expect(calibrationStanding("2026-09-03", asOf).status).toBe("due_soon"); // 30 days
    expect(calibrationStanding("2026-09-04", asOf).status).toBe("valid"); // 31 days
  });

  it("treats the due day itself as still valid (due today)", () => {
    expect(calibrationStanding(asOf, asOf)).toEqual({ status: "due_soon", daysUntilDue: 0 });
  });

  it("is expired the day after the due date, with a negative day count", () => {
    expect(calibrationStanding("2026-08-03", asOf)).toEqual({ status: "expired", daysUntilDue: -1 });
  });

  it("respects a custom soon window", () => {
    expect(calibrationStanding("2026-08-10", asOf, 7).status).toBe("due_soon");
    expect(calibrationStanding("2026-08-12", asOf, 7).status).toBe("valid");
  });

  it("treats a missing/bad due date as expired (fail safe)", () => {
    const standing = calibrationStanding("", asOf);
    expect(standing.status).toBe("expired");
    expect(standing.daysUntilDue).toBeNaN();
  });
});

describe("certValidOn", () => {
  const instrument: Instrument = {
    id: "i1",
    serial_no: "FLK-01",
    description: "Multimeter",
    cal_cert_url: "",
    cal_date: "2026-01-15",
    cal_due_date: "2027-01-15",
  };

  it("is valid on a use date inside the calibration window", () => {
    expect(certValidOn(instrument, "2026-08-04")).toBe(true);
    expect(certValidOn(instrument, "2026-01-15")).toBe(true); // cal day
    expect(certValidOn(instrument, "2027-01-15")).toBe(true); // due day
  });

  it("is invalid before calibration or after expiry", () => {
    expect(certValidOn(instrument, "2026-01-14")).toBe(false); // before cal
    expect(certValidOn(instrument, "2027-01-16")).toBe(false); // after due
  });
});
