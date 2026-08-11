import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTemplate } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import { createDraft, type ChecklistRecord } from "../data/record";
import type { SignatureView } from "../data/signature";
import { emptyValues } from "../lib/values";
import {
  defaultCoverOptions,
  RFI_DECLARATION,
  type RfiCoverOptions,
} from "../lib/rfi-cover";
import { PrintRfiCover } from "./print-rfi-cover";

const template = parseTemplate(heatLoadRaw);

function draft(): ChecklistRecord {
  return {
    ...createDraft(template, {
      id: "rec-1",
      now: "2026-08-05T02:00:00.000Z",
      createdBy: null,
    }),
    serial_no: "ACMV-01",
  };
}

function options(): RfiCoverOptions {
  return {
    ...defaultCoverOptions(template, emptyValues(template), draft()),
    project: "Apple AMK2&3 BOH & Infra Structure",
    floor: "Level 6&7",
    area: "AMK2&3",
    activity: "(Infra) Ductwork Leakage Test",
    discipline: "acmv",
  };
}

describe("PrintRfiCover", () => {
  it("renders as a single A4 portrait page", () => {
    const { container } = render(
      <PrintRfiCover
        template={template}
        record={draft()}
        options={options()}
        status="draft"
      />,
    );
    const page = container.querySelector(".rfi-cover-page");
    expect(page).not.toBeNull();
    expect(page?.getAttribute("data-orientation")).toBe("portrait");
    expect(container.querySelectorAll(".rfi-cover-page")).toHaveLength(1);
  });

  it("prints the app-filled fields, ref, and the verbatim declaration", () => {
    render(
      <PrintRfiCover
        template={template}
        record={draft()}
        options={options()}
        status="draft"
      />,
    );
    expect(
      screen.getByText("Apple AMK2&3 BOH & Infra Structure"),
    ).toBeInTheDocument();
    expect(screen.getByText("Level 6&7")).toBeInTheDocument();
    // Ref. cell (plus the footer serial, which equals the ref in this fixture).
    expect(screen.getAllByText("ACMV-01").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(RFI_DECLARATION)).toBeInTheDocument();
  });

  it("ticks only the user-chosen discipline", () => {
    const { container } = render(
      <PrintRfiCover
        template={template}
        record={draft()}
        options={{ ...options(), discipline: "electrical" }}
        status="draft"
      />,
    );
    const cells = Array.from(container.querySelectorAll(".rfi-cb-cell"));
    const ticked = cells.filter((c) => c.textContent?.includes("☑"));
    expect(ticked).toHaveLength(1);
    expect(ticked[0]?.textContent).toContain("Electrical");
  });

  it("shows the Other free text when discipline is 'other'", () => {
    render(
      <PrintRfiCover
        template={template}
        record={draft()}
        options={{ ...options(), discipline: "other", otherText: "Telecoms" }}
        status="draft"
      />,
    );
    expect(screen.getByText("Telecoms")).toBeInTheDocument();
  });

  it("prints the contractor sign-off name/date/signature when captured", () => {
    const captured: SignatureView = {
      slot_id: "sig_tested",
      role: "Inspection / Tested by",
      name: "Burin",
      company: "Kenyon Pte Ltd",
      method: "on_device",
      signed_at: "2026-07-03T02:00:00.000Z",
      image_url: "blob:sig",
    };
    const { container } = render(
      <PrintRfiCover
        template={template}
        record={draft()}
        options={options()}
        status="draft"
        signatures={new Map([["sig_tested", captured]])}
      />,
    );
    expect(screen.getByText("Burin")).toBeInTheDocument();
    expect(screen.getByText("03/07/2026")).toBeInTheDocument();
    const img = container.querySelector(".rfi-sig-img");
    expect(img?.getAttribute("src")).toBe("blob:sig");
  });

  it("leaves the inspector sign-off and result as blank boxes", () => {
    const { container } = render(
      <PrintRfiCover
        template={template}
        record={draft()}
        options={options()}
        status="draft"
      />,
    );
    // Both contractor (unsigned) and inspector signature boxes are blank.
    expect(container.querySelectorAll(".rfi-sig-box")).toHaveLength(2);
    // Result options print as empty (unchecked) boxes.
    expect(screen.getByText("☐ PASS")).toBeInTheDocument();
    expect(screen.getByText("☐ CONDITIONAL PASS")).toBeInTheDocument();
  });

  it("watermarks a draft but not an accepted record", () => {
    const draftRender = render(
      <PrintRfiCover
        template={template}
        record={draft()}
        options={options()}
        status="draft"
      />,
    );
    expect(
      draftRender.container.querySelectorAll(".print-watermark"),
    ).toHaveLength(1);
    draftRender.unmount();

    const accepted = render(
      <PrintRfiCover
        template={template}
        record={draft()}
        options={options()}
        status="accepted"
      />,
    );
    expect(
      accepted.container.querySelectorAll(".print-watermark"),
    ).toHaveLength(0);
  });
});
