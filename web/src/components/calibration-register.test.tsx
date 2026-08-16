import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChecklistDb } from "../data/db";
import { createInstrument } from "../data/instrument";
import { InstrumentsRepo } from "../data/instruments-repo";
import { uuidv7 } from "../data/uuidv7";
import { CalibrationRegister } from "./calibration-register";

const today = () => "2026-08-04";

function freshRepo(): InstrumentsRepo {
  return new InstrumentsRepo(new ChecklistDb(`test-${uuidv7()}`));
}

describe("CalibrationRegister", () => {
  it("warns about expired instruments and sorts them to the top", async () => {
    const repo = freshRepo();
    await repo.add(
      createInstrument({ id: uuidv7(), serialNo: "NEW-1", calDate: "2026-01-01", calDueDate: "2026-12-31" }),
    );
    await repo.add(
      createInstrument({ id: uuidv7(), serialNo: "OLD-1", calDate: "2025-01-01", calDueDate: "2026-07-01" }),
    );

    render(<CalibrationRegister repo={repo} today={today} />);

    expect(await screen.findByText(/out of calibration/)).toBeInTheDocument();
    expect(screen.getByText("1 expired")).toBeInTheDocument();
    expect(screen.getByText("1 valid")).toBeInTheDocument();

    // Expired instrument sorts above the valid one.
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getByText("OLD-1")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("NEW-1")).toBeInTheDocument();
  });

  it("shows an empty state and no warning when there are no instruments", async () => {
    render(<CalibrationRegister repo={freshRepo()} today={today} />);
    expect(await screen.findByText(/No instruments yet/)).toBeInTheDocument();
    expect(screen.queryByText(/out of calibration/)).toBeNull();
  });

  it("adds an instrument through the form", async () => {
    const user = userEvent.setup();
    render(<CalibrationRegister repo={freshRepo()} today={today} />);
    await screen.findByText(/No instruments yet/);

    await user.type(screen.getByLabelText("Instrument serial number"), "FLK-77");
    await user.type(screen.getByLabelText("Instrument description"), "Clamp meter");
    // Date inputs take a value directly rather than typed keystrokes.
    fireEvent.change(screen.getByLabelText("Calibration due date"), {
      target: { value: "2027-06-30" },
    });
    await user.click(screen.getByRole("button", { name: "Add instrument" }));

    expect(await screen.findByText("FLK-77")).toBeInTheDocument();
    expect(screen.getByText("30/06/2027")).toBeInTheDocument(); // dd/mm/yyyy display
    expect(screen.getByText("1 valid")).toBeInTheDocument();
  });

  /**
   * The certificate number is what an auditor quotes when asking for the original
   * document, so it is the link text rather than a generic word. Rows written
   * before the register carried a number must still render a usable link.
   */
  it("labels the certificate link with the certificate number", async () => {
    const repo = freshRepo();
    await repo.add(
      createInstrument({
        id: uuidv7(),
        serialNo: "W8045321",
        calCertUrl: "/calibration-certs/clamp.pdf",
        certNo: "BLE2604334-2",
        calDate: "2026-05-08",
        calDueDate: "2027-05-07",
      }),
    );

    render(<CalibrationRegister repo={repo} today={today} />);

    const link = await screen.findByRole("link", { name: "BLE2604334-2" });
    expect(link).toHaveAttribute("href", "/calibration-certs/clamp.pdf");
  });

  it("falls back to a generic link label when the certificate number is blank", async () => {
    const repo = freshRepo();
    await repo.add(
      createInstrument({
        id: uuidv7(),
        serialNo: "NO-NUMBER",
        calCertUrl: "/calibration-certs/old.pdf",
        calDate: "2026-05-08",
        calDueDate: "2027-05-07",
      }),
    );

    render(<CalibrationRegister repo={repo} today={today} />);

    expect(await screen.findByRole("link", { name: "Certificate" })).toBeInTheDocument();
  });

  /** A number with no file still identifies the document; show it as plain text. */
  it("shows the certificate number even when no file is linked", async () => {
    const repo = freshRepo();
    await repo.add(
      createInstrument({
        id: uuidv7(),
        serialNo: "PAPER-ONLY",
        certNo: "CTT 2428-25",
        calDate: "2026-05-08",
        calDueDate: "2027-05-07",
      }),
    );

    render(<CalibrationRegister repo={repo} today={today} />);

    expect(await screen.findByText("CTT 2428-25")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps the certificate number when an instrument is edited", async () => {
    const user = userEvent.setup();
    const repo = freshRepo();
    await repo.add(
      createInstrument({
        id: uuidv7(),
        serialNo: "EDIT-ME",
        calCertUrl: "/calibration-certs/edit.pdf",
        certNo: "GCC251722",
        calDate: "2026-05-08",
        calDueDate: "2027-05-07",
      }),
    );

    render(<CalibrationRegister repo={repo} today={today} />);
    await screen.findByText("EDIT-ME");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Certificate number")).toHaveValue("GCC251722");

    await user.type(screen.getByLabelText("Instrument description"), "Sound level meter");
    await user.click(screen.getByRole("button", { name: "Save instrument" }));

    expect(await screen.findByRole("link", { name: "GCC251722" })).toBeInTheDocument();
  });
});
