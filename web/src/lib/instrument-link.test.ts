import { describe, it, expect } from "vitest";
import type { ColumnDef } from "@schema";
import { createInstrument } from "../data/instrument";
import {
  applyInstrumentToRow,
  expiredInstrumentWarning,
  instrumentOptionLabel,
  matchInstrument,
} from "./instrument-link";

const clampMeter = createInstrument({
  id: "i1",
  serialNo: "W8045321",
  description: "Clamp Meter",
  certNo: "BLE2604334-2",
  calDate: "2026-05-07",
  calDueDate: "2027-05-07",
});

const col = (id: string, type: ColumnDef["type"] = "text") => ({ id, type });

describe("instrument-link", () => {
  it("fills only the columns the section has, leaving the rest of the row alone", () => {
    // The heat-load TESTING EQUIPMENT shape: no serial column, so the serial
    // rides appended to the description (it must land on the printed sheet).
    const columns = [col("description", "textarea"), col("make_model"), col("qty"), col("cal_cert")];
    const row = applyInstrumentToRow({ qty: "1 no", remarks: "x" }, columns, clampMeter);
    expect(row).toEqual({
      qty: "1 no",
      remarks: "x",
      description: "Clamp Meter — S/N W8045321",
      cal_cert: "BLE2604334-2",
    });
  });

  it("uses a dedicated serial column when the table has one", () => {
    const columns = [col("description"), col("serial_no"), col("cal_due_date")];
    const row = applyInstrumentToRow({}, columns, clampMeter);
    expect(row.description).toBe("Clamp Meter");
    expect(row.serial_no).toBe("W8045321");
    expect(row.cal_due_date).toBe("2027-05-07");
  });

  it("fills every description-column and due-column spelling the templates use", () => {
    // "instrument" + "cal_due" (the ACMV function-test family, Billi tap, …).
    const acmv = applyInstrumentToRow(
      {},
      [col("instrument"), col("model"), col("serial_no"), col("cal_due", "date")],
      clampMeter,
    );
    expect(acmv).toEqual({ instrument: "Clamp Meter", serial_no: "W8045321", cal_due: "2027-05-07" });

    // "function" + "cal_cert" (power-turn-on, power/lighting circuit, bolt torque).
    const pto = applyInstrumentToRow(
      {},
      [col("function"), col("make_model"), col("serial_no"), col("cal_cert")],
      clampMeter,
    );
    expect(pto).toEqual({ function: "Clamp Meter", serial_no: "W8045321", cal_cert: "BLE2604334-2" });

    // "due_date" + "cal_date" (ductwork air leakage).
    const dal = applyInstrumentToRow(
      {},
      [col("instrument"), col("serial_no"), col("cal_date", "date"), col("due_date", "date")],
      clampMeter,
    );
    expect(dal).toMatchObject({ cal_date: "2026-05-07", due_date: "2027-05-07" });
  });

  it("never writes into a calculated column", () => {
    const columns = [col("cal_cert", "calculated")];
    expect(applyInstrumentToRow({}, columns, clampMeter)).toEqual({});
  });

  it("matches a row back to the register by certificate, then serial", () => {
    const instruments = [clampMeter];
    const columns = [col("description"), col("cal_cert"), col("serial_no")];
    expect(
      matchInstrument({ cal_cert: "BLE2604334-2" }, columns, instruments)?.id,
    ).toBe("i1");
    // A hand-typed serial matches too — the warning is not pick-only.
    expect(
      matchInstrument({ cal_cert: "", serial_no: "W8045321" }, columns, instruments)?.id,
    ).toBe("i1");
    expect(matchInstrument({ cal_cert: "OTHER" }, columns, instruments)).toBeUndefined();
    expect(matchInstrument({}, columns, instruments)).toBeUndefined();
  });

  it("warns for an expired calibration and stays quiet for a covered one", () => {
    expect(expiredInstrumentWarning(clampMeter, "2026-08-20")).toBeNull();
    expect(expiredInstrumentWarning(clampMeter, "2027-05-07")).toBeNull(); // due day still covered
    expect(expiredInstrumentWarning(clampMeter, "2027-05-08")).toMatch(
      /expired 2027-05-07/,
    );
  });

  it("labels a dropdown option with description and serial", () => {
    expect(instrumentOptionLabel(clampMeter)).toBe("Clamp Meter — S/N W8045321");
    expect(
      instrumentOptionLabel(
        createInstrument({ id: "i2", serialNo: "", calDate: "", calDueDate: "" }),
      ),
    ).toBe("(no description)");
  });
});
