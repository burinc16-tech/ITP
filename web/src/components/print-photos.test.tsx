import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTemplate } from "@schema";
import idfRaw from "../../../spec/templates/idf-handover.json";
import type { AttachmentView } from "../data/attachment";
import { emptyValues } from "../lib/values";
import { PrintView } from "./print-view";

const template = parseTemplate(idfRaw);

// IDF rows are status + photo, so the add-on cell keys on `${rowId}:photo`.
const attachments = (): Map<string, AttachmentView[]> =>
  new Map([
    ["chk_3_1:photo", [{ id: "a1", field_id: "chk_3_1:photo", caption: "north wall", image_url: "blob:x" }]],
  ]);

describe("PrintView — photos", () => {
  it("prints a captured photo beneath its checklist item", () => {
    const { container } = render(
      <PrintView
        template={template}
        values={emptyValues(template)}
        status="completed"
        serialNo={null}
        attachments={attachments()}
      />,
    );
    const img = screen.getByAltText("north wall");
    expect(img).toHaveAttribute("src", "blob:x");
    expect(screen.getByText("north wall")).toBeInTheDocument(); // caption
    expect(container.querySelectorAll(".print-photo-row")).toHaveLength(1);
  });

  it("prints no photo row when the record has no attachments", () => {
    const { container } = render(
      <PrintView template={template} values={emptyValues(template)} status="completed" serialNo={null} />,
    );
    expect(container.querySelectorAll(".print-photo-row")).toHaveLength(0);
  });
});
