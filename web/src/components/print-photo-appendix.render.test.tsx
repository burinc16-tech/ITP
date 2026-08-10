import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import type { AttachmentView } from "../data/attachment";
import { PHOTO_APPENDIX_FIELD } from "../lib/photo-appendix";
import { PrintPhotoAppendix } from "./print-photo-appendix";

const template = parseTemplate(rawTemplate);

const photos = (n: number): AttachmentView[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    field_id: PHOTO_APPENDIX_FIELD,
    caption: `Location: L${i + 1}\nDate:\nTime:`,
    image_url: `blob:p${i + 1}`,
  }));

describe("PrintPhotoAppendix", () => {
  it("renders nothing when the record has no appendix photos", () => {
    const { container } = render(
      <PrintPhotoAppendix template={template} photos={[]} status="draft" serialNo={null} />,
    );
    expect(container.querySelectorAll(".photo-appendix-page")).toHaveLength(0);
  });

  it("lays out six photos on one A4 portrait page, 3 rows of 2", () => {
    const { container } = render(
      <PrintPhotoAppendix
        template={template}
        photos={photos(6)}
        status="draft"
        serialNo={null}
      />,
    );
    const pages = container.querySelectorAll(".photo-appendix-page");
    expect(pages).toHaveLength(1);
    // Portrait regardless of the record's (landscape) orientation.
    expect(pages[0]!.getAttribute("data-orientation")).toBe("portrait");
    expect(pages[0]!.querySelectorAll(".appendix-row")).toHaveLength(3);
    expect(pages[0]!.querySelectorAll(".appendix-photo img")).toHaveLength(6);
  });

  it("overflows onto further pages and numbers them", () => {
    const { container } = render(
      <PrintPhotoAppendix
        template={template}
        photos={photos(7)}
        status="draft"
        serialNo="AMK3-HLT-0007"
      />,
    );
    expect(container.querySelectorAll(".photo-appendix-page")).toHaveLength(2);
    expect(screen.getByText("Photo page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Photo page 2 of 2")).toBeInTheDocument();
    // Footer carries the record serial on every photo page.
    expect(screen.getAllByText("AMK3-HLT-0007")).toHaveLength(2);
  });

  it("prints multi-line captions beneath each photo", () => {
    const { container } = render(
      <PrintPhotoAppendix
        template={template}
        photos={photos(1)}
        status="draft"
        serialNo={null}
      />,
    );
    const caption = container.querySelector(".appendix-caption");
    expect(caption?.textContent).toBe("Location: L1\nDate:\nTime:");
    // A lone photo in a row keeps the two-column shape via a hidden filler.
    expect(container.querySelectorAll(".appendix-cell-empty")).toHaveLength(1);
  });

  it("watermarks DRAFT until the record is accepted", () => {
    const { container: draft } = render(
      <PrintPhotoAppendix template={template} photos={photos(1)} status="draft" serialNo={null} />,
    );
    expect(draft.querySelectorAll(".print-watermark")).toHaveLength(1);
    const { container: accepted } = render(
      <PrintPhotoAppendix template={template} photos={photos(1)} status="accepted" serialNo={null} />,
    );
    expect(accepted.querySelectorAll(".print-watermark")).toHaveLength(0);
  });
});
