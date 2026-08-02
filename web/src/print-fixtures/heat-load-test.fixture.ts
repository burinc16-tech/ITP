import type { Template } from "@schema";
import { emptyValues, type RecordValues, type TableRow } from "../lib/values";

/**
 * A representative *completed* heat-load-test record, used to render the static
 * print output. Built on top of `emptyValues(template)` so the keys always match
 * the current template — variable defaults, the two prefilled equipment rows, and
 * the interpolated Equipment header all come from there; this only overlays the
 * filled-in values a finished test would carry.
 */
export function heatLoadTestFixture(template: Template): RecordValues {
  const v = emptyValues(template);

  Object.assign(v.header, {
    project: "L-4, APPLE @ AMK-3",
    doc_no: "Network Room Heat Load Test at L4, Apple",
    inspector: "J. Tan",
    insp_date: "2023-04-27", // stored ISO; prints as 27/04/2023
    stage: "Stage 2",
  });

  // Section 1 — calibration cert nos for the two prefilled instruments.
  setCell(v.tables.sec_1, 0, "cal_cert", "KEN-CAL-2301-8842");
  setCell(v.tables.sec_1, 1, "cal_cert", "KEN-CAL-2301-8843");

  // Section 2 — set-up checks all pass, two carry remarks.
  for (const id of ["s2_01", "s2_02", "s2_03", "s2_04", "s2_05"]) {
    v.rows[id] = { value: "pass", remarks: "" };
  }
  v.rows["s2_02"] = { value: "pass", remarks: "Balanced per TAB report AMK3-TAB-014" };
  v.rows["s2_04"] = { value: "pass", remarks: "2 × 9 kg CO₂ extinguishers" };

  // Section 3 — heat-load-test step timings (time of day) and observations.
  const steps: Array<[string, string, string]> = [
    ["s3_01", "10:30", "Cooling disabled; Hi set 26 °C"],
    ["s3_02", "10:45", "23.1 °C recorded"],
    ["s3_03", "10:50", "Set point restored to 23 °C"],
    ["s3_04", "11:00", "CHW FCU on, 6 kW heaters running"],
    ["s3_05", "14:55", "23 °C reached; Hi reset"],
    ["s3_06", "15:00", "23.0 °C recorded"],
    ["s3_07", "15:15", "DX FCU enabled after 15 min delay"],
    ["s3_08", "15:20", "Cooling disabled; Hi set 26 °C"],
    ["s3_09", "15:30", "DX FCU on, 6 kW heaters running"],
    ["s3_10", "19:25", "Set point restored to 23 °C"],
    ["s3_11", "19:30", "23.0 °C recorded"],
    ["s3_12", "19:35", "23 °C reached; Hi reset"],
    ["s3_13", "19:50", "Reached 26 °C in ~15 min, FCUs off"],
    ["s3_14", "20:05", "Back to 23 °C in ~15 min, FCUs on"],
    ["s3_15", "20:10", "Load banks switched off"],
    ["s3_16", "20:15", "End of test"],
  ];
  for (const [id, value, remarks] of steps) {
    v.rows[id] = { value, remarks };
  }

  // Section 4 — temperature & humidity log (the reconstructed section).
  const readings: Array<[string, string, string, string, string]> = [
    ["10:30", "HOBO-01", "23.1", "48", ""],
    ["11:00", "HOBO-01", "23.4", "47", ""],
    ["12:00", "HOBO-01", "24.2", "46", ""],
    ["13:00", "HOBO-01", "24.9", "45", ""],
    ["14:00", "HOBO-01", "25.6", "44", ""],
    ["14:55", "HOBO-01", "23.0", "47", "Set point reached"],
  ];
  readings.forEach(([time, logger, temp, rh, remarks], i) => {
    setCell(v.tables.sec_4, i, "time", time);
    setCell(v.tables.sec_4, i, "logger", logger);
    setCell(v.tables.sec_4, i, "temp", temp);
    setCell(v.tables.sec_4, i, "rh", rh);
    setCell(v.tables.sec_4, i, "remarks", remarks);
  });

  return v;
}

function setCell(
  table: TableRow[] | undefined,
  index: number,
  column: string,
  value: string,
): void {
  const row = table?.[index];
  if (row) row[column] = value;
}
