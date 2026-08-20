import { useState, type ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate, type Template } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import rawPowerTurnOn from "../../../spec/templates/power-turn-on.json";
import { createInstrument, type Instrument } from "../data/instrument";
import { emptyValues } from "../lib/values";
import { TemplateForm } from "./template-form";

const template = parseTemplate(rawTemplate);
const powerTurnOn = parseTemplate(rawPowerTurnOn);

const clampMeter = createInstrument({
  id: "i1",
  serialNo: "W8045321",
  description: "Clamp Meter",
  certNo: "BLE2604334-2",
  calDate: "2026-05-07",
  calDueDate: "2099-05-07",
});

// Expired long before any plausible "today" the test could run on.
const expiredLogger = createInstrument({
  id: "i2",
  serialNo: "E1034007017",
  description: "IR Thermometer",
  certNo: "PLS-26010053-01",
  calDate: "2019-01-01",
  calDueDate: "2020-01-01",
});

function Harness(props: { instruments?: Instrument[]; template?: Template }): ReactNode {
  const t = props.template ?? template;
  const [values, setValues] = useState(() => emptyValues(t));
  return (
    <TemplateForm
      template={t}
      values={values}
      onChange={setValues}
      instruments={props.instruments}
    />
  );
}

/**
 * Record↔instrument linking (SPEC §5): the heat-load TESTING EQUIPMENT table is
 * flagged `link_to_instrument_register`, so each row offers a picker over the
 * calibration register that copies the instrument into the row. Expired
 * instruments are allowed with a visible warning, never blocked (settled with
 * the user 2026-08-20).
 */
describe("instrument table register picker", () => {
  it("renders a picker per row on the flagged table, none without instruments", () => {
    const { unmount } = render(<Harness instruments={[clampMeter]} />);
    // The section pads to its min_rows of 4 — one picker per row.
    expect(
      screen.getAllByRole("combobox", { name: /Pick instrument for row/ }),
    ).toHaveLength(4);
    unmount();

    // With no register supplied the table renders exactly as before.
    render(<Harness />);
    expect(
      screen.queryByRole("combobox", { name: /Pick instrument for row/ }),
    ).toBeNull();
  });

  it("copies the picked instrument into the row's description and cert columns", async () => {
    const user = userEvent.setup();
    render(<Harness instruments={[clampMeter]} />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Pick instrument for row 3 from the calibration register" }),
      "i1",
    );

    // No serial column on this table, so the serial rides in the description.
    expect(screen.getByLabelText("Description row 3")).toHaveValue(
      "Clamp Meter — S/N W8045321",
    );
    expect(screen.getByLabelText("Cal. Cert No. row 3")).toHaveValue("BLE2604334-2");
    // The picker now shows the linked instrument, and a valid cert warns nothing.
    expect(
      screen.getByRole("combobox", { name: /row 3/ }),
    ).toHaveValue("i1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fills the power-turn-on shape too — function / serial / cert columns", async () => {
    const user = userEvent.setup();
    render(<Harness template={powerTurnOn} instruments={[clampMeter]} />);

    await user.selectOptions(
      screen.getAllByRole("combobox", { name: /Pick instrument for row 1 / })[0]!,
      "i1",
    );

    expect(screen.getByLabelText("Function row 1")).toHaveValue("Clamp Meter");
    expect(screen.getByLabelText("Serial No row 1")).toHaveValue("W8045321");
    expect(screen.getByLabelText("Calibration Cert row 1")).toHaveValue("BLE2604334-2");
    // Make / Model isn't in the register — left for the engineer.
    expect(screen.getByLabelText("Make / Model row 1")).toHaveValue("");
  });

  it("allows an expired instrument but shows a visible warning", async () => {
    const user = userEvent.setup();
    render(<Harness instruments={[clampMeter, expiredLogger]} />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /row 1 / }),
      "i2",
    );

    // The pick still lands — expired is allowed, not blocked…
    expect(screen.getByLabelText("Cal. Cert No. row 1")).toHaveValue("PLS-26010053-01");
    // …but the row carries an unmissable warning.
    expect(screen.getByRole("alert")).toHaveTextContent(/Calibration expired 2020-01-01/);
  });
});
