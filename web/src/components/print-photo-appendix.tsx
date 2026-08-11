import type { ReactNode } from "react";
import type { Template } from "@schema";
import { KENYON_LOGO } from "../assets/kenyon-logo";
import type { AttachmentView } from "../data/attachment";
import type { RecordStatus } from "../data/record";
import { paginatePhotos, photoRows } from "../lib/photo-appendix";

/**
 * The opt-in photo attachment pages (SPEC §12), printed after the record's
 * normal output when the print-step toggle is on. Layout replicates the site
 * team's standalone `Photo_Print_3x2.html` sheet: A4 portrait, 3 rows × 2
 * photos, each photo above its caption lines. ONE shared component driven by
 * the record's appendix attachments — never per-template markup (Hard Rule #4).
 *
 * The pages are A4 **portrait** regardless of the record's orientation; a named
 * `@page photo-appendix` rule (print.css) keeps them portrait even when the
 * record pages print landscape, mirroring the RFI cover's mixed-job approach.
 */
export function PrintPhotoAppendix(props: {
  template: Template;
  photos: AttachmentView[];
  status: RecordStatus;
  serialNo: string | null;
}): ReactNode {
  const { template, photos, status, serialNo } = props;
  if (photos.length === 0) return null;
  const pages = paginatePhotos(photos);

  return (
    <>
      {pages.map((page, pageIdx) => (
        <section
          key={page[0]!.id}
          className="print-page photo-appendix-page"
          data-orientation="portrait"
        >
          {status !== "accepted" && (
            <div className="print-watermark" aria-hidden="true">
              DRAFT
            </div>
          )}

          <header className="print-head">
            <img className="print-logo" src={KENYON_LOGO} alt="Kenyon" />
            <div className="print-head-title">{template.title}</div>
          </header>

          <div className="print-page-body appendix-body">
            <h2 className="appendix-title">Photographic Records</h2>

            <div className="appendix-grid">
              {photoRows(page).map((row) => (
                <div key={row[0]!.id} className="appendix-row">
                  {row.map((photo) => (
                    <figure key={photo.id} className="appendix-cell">
                      <div className="appendix-photo">
                        <img src={photo.image_url} alt={photo.caption || "Photo"} />
                      </div>
                      <figcaption className="appendix-caption">
                        {photo.caption}
                      </figcaption>
                    </figure>
                  ))}
                  {/* Keep the grid shape when a row has a single photo. */}
                  {row.length === 1 && <div className="appendix-cell appendix-cell-empty" />}
                </div>
              ))}
            </div>
          </div>

          <footer className="print-foot">
            <span className="print-foot-serial">{serialNo ?? "—"}</span>
            <span>
              {template.code} · Rev {template.rev} — Photo attachment
            </span>
            <span>
              Photo page {pageIdx + 1} of {pages.length}
            </span>
            <span className="print-foot-status">{status.toUpperCase()}</span>
          </footer>
        </section>
      ))}
    </>
  );
}
