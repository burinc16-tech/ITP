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
  make: "Kyoritsu",
  model: "KS 2027",
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
 * flagged `link_to_instrument_register`, so its instrument column is a picker
 * over the calibration register as well as a plain text cell — clicking it
 * offers the register, typing is always still allowed. Picking copies the
 * instrument into the row. Expired instruments are allowed with a visible
 * warning, never blocked (settled with the user 2026-08-20).
 */
describe("instrument table register picker", () => {
  it("turns the instrument column into a combobox, and only when a register exists", () => {
    const { unmount } = render(<Harness instruments={[clampMeter]} />);
    // The section pads to its min_rows of 4 — one picker per row.
    expect(screen.getAllByRole("combobox", { name: /^Description row/ })).toHaveLength(4);
    unmount();

    // With no register supplied the table renders exactly as before.
    render(<Harness />);
    expect(screen.queryByRole("combobox", { name: /^Description row/ })).toBeNull();
    expect(screen.getByLabelText("Description row 3")).toHaveValue("");
  });

  it("opens the register on click and copies the pick into the row", async () => {
    const user = userEvent.setup();
    render(<Harness instruments={[clampMeter]} />);

    await user.click(screen.getByLabelText("Description row 3"));
    await user.click(screen.getByRole("option", { name: /Clamp Meter/ }));

    // No serial column on this table, so the serial rides in the description.
    expect(screen.getByLabelText("Description row 3")).toHaveValue(
      "Clamp Meter — S/N W8045321",
    );
    expect(screen.getByLabelText("Cal. Cert No. row 3")).toHaveValue("BLE2604334-2");
    // The menu closes behind the pick, and a valid cert warns nothing.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still takes free text, and filters the register down as you type", async () => {
    const user = userEvent.setup();
    render(<Harness instruments={[clampMeter, expiredLogger]} />);

    const cell = screen.getByLabelText("Description row 3");
    await user.type(cell, "Thermo");

    // Typing writes the cell, unchanged and unblocked…
    expect(cell).toHaveValue("Thermo");
    // …and narrows the register to what matches.
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /IR Thermometer/ })).toBeInTheDocument();

    // An instrument the register has never heard of is kept as typed.
    await user.clear(cell);
    await user.type(cell, "Borrowed anemometer");
    expect(cell).toHaveValue("Borrowed anemometer");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/what you typed is kept/)).toBeInTheDocument();
  });

  it("offers the whole register from a prefilled cell, not a filtered-out one", async () => {
    const user = userEvent.setup();
    render(<Harness template={powerTurnOn} instruments={[clampMeter, expiredLogger]} />);

    // Row 1's Function arrives prefilled from the template…
    expect(screen.getByLabelText("Function row 1")).toHaveValue("Insulation Resistance");
    await user.click(screen.getByLabelText("Function row 1"));
    // …and opening it still offers every instrument, unfiltered.
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("fills the power-turn-on shape too — function / serial / cert columns", async () => {
    const user = userEvent.setup();
    render(<Harness template={powerTurnOn} instruments={[clampMeter]} />);

    await user.click(screen.getByLabelText("Function row 1"));
    await user.click(screen.getByRole("option", { name: /Clamp Meter/ }));

    expect(screen.getByLabelText("Function row 1")).toHaveValue("Clamp Meter");
    expect(screen.getByLabelText("Serial No row 1")).toHaveValue("W8045321");
    expect(screen.getByLabelText("Calibration Cert row 1")).toHaveValue("BLE2604334-2");
    // One Make / Model column, so the register's two fields arrive joined.
    expect(screen.getByLabelText("Make / Model row 1")).toHaveValue("Kyoritsu/KS 2027");
  });

  it("picks with the keyboard as well as the pointer", async () => {
    const user = userEvent.setup();
    render(<Harness template={powerTurnOn} instruments={[clampMeter, expiredLogger]} />);

    // Opening highlights the first instrument, so one ArrowDown lands on the second.
    await user.click(screen.getByLabelText("Function row 2"));
    await user.keyboard("{ArrowDown}{Enter}");

    expect(screen.getByLabelText("Serial No row 2")).toHaveValue("E1034007017");
  });

  it("allows an expired instrument but shows a visible warning", async () => {
    const user = userEvent.setup();
    render(<Harness instruments={[clampMeter, expiredLogger]} />);

    await user.click(screen.getByLabelText("Description row 4"));
    await user.click(screen.getByRole("option", { name: /IR Thermometer/ }));

    // The pick still lands — expired is allowed, not blocked…
    expect(screen.getByLabelText("Cal. Cert No. row 4")).toHaveValue("PLS-26010053-01");
    // …but the row carries an unmissable warning.
    expect(screen.getByRole("alert")).toHaveTextContent(/Calibration expired 2020-01-01/);
  });
});
