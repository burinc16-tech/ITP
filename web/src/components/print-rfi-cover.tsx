import type { ReactNode } from "react";
import type { Template } from "@schema";
import { RFI_COVER_LOGO_LEFT, RFI_COVER_LOGO_RIGHT } from "../assets/rfi-cover-logos";
import type { ChecklistRecord, RecordStatus } from "../data/record";
import type { SignatureView } from "../data/signature";
import {
  buildRfiCoverData,
  RFI_DISCIPLINES,
  type RfiCoverOptions,
} from "../lib/rfi-cover";

const EMPTY: Map<string, SignatureView> = new Map();

/**
 * The opt-in Inspection Request (RFI) cover page (SPEC §12, handover task 2),
 * printed as page 1 in front of the record when the print-step toggle is on.
 * ONE shared component, driven entirely by record/template data and the
 * user-chosen options — never per-template markup (Hard Rule #4). Layout
 * replicates `spec/reference/inspection-request-form.html` (A4 portrait).
 *
 * The page is A4 **portrait** regardless of the record's orientation; a named
 * `@page rfi-cover` rule (print.css) keeps it portrait even when the record
 * pages print landscape, so one print action produces the correct mixed job.
 */
export function PrintRfiCover(props: {
  template: Template;
  record: ChecklistRecord;
  options: RfiCoverOptions;
  status: RecordStatus;
  signatures?: Map<string, SignatureView>;
}): ReactNode {
  const { template, record, options, status } = props;
  const data = buildRfiCoverData(template, props.signatures ?? EMPTY, options);
  const disciplineLabel = (v: string): string =>
    RFI_DISCIPLINES.find((d) => d.value === v)?.label ?? v;

  return (
    <section className="print-page rfi-cover-page" data-orientation="portrait">
      {status !== "accepted" && (
        <div className="print-watermark" aria-hidden="true">
          DRAFT
        </div>
      )}

      <div className="print-page-body rfi-cover">
        {/* Header: two logos flanking the form title. */}
        <div className="rfi-header">
          <img className="rfi-logo-left" src={RFI_COVER_LOGO_LEFT} alt="Contractor" />
          <h1 className="rfi-title">Inspection Request Form (M&amp;E)</h1>
          <img className="rfi-logo-right" src={RFI_COVER_LOGO_RIGHT} alt="Project" />
        </div>

        {/* Project / Contractor / IRF No. */}
        <table className="rfi-table">
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "43%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "20%" }} />
          </colgroup>
          <tbody>
            <tr>
              <td className="rfi-lbl">Project:</td>
              <td className="rfi-val" colSpan={3}>
                {data.project}
              </td>
            </tr>
            <tr>
              <td className="rfi-lbl">Contractor:</td>
              <td className="rfi-val">{data.contractor}</td>
              <td className="rfi-lbl">IRF No.:</td>
              {/* Manual: site-assigned sequence, left blank. */}
              <td className="rfi-val rfi-blank" />
            </tr>
          </tbody>
        </table>

        {/* Discipline — the user-chosen box is ticked. */}
        <table className="rfi-table rfi-discipline">
          <tbody>
            <tr>
              {RFI_DISCIPLINES.map((d) => (
                <RfiDisciplineCell
                  key={d.value}
                  checked={data.discipline === d.value}
                  label={d.label}
                  other={
                    d.value === "other"
                      ? data.discipline === "other"
                        ? data.otherText
                        : ""
                      : undefined
                  }
                />
              ))}
            </tr>
          </tbody>
        </table>

        {/* Form details. */}
        <table className="rfi-table">
          <colgroup>
            <col style={{ width: "17%" }} />
            <col style={{ width: "46%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "24%" }} />
          </colgroup>
          <tbody>
            <tr>
              <td className="rfi-lbl">Drawing No.:</td>
              <td className="rfi-val">{data.drawingNo}</td>
              <td className="rfi-lbl">Floor:</td>
              <td className="rfi-val">{data.floor}</td>
            </tr>
            <tr>
              <td className="rfi-lbl">Area:</td>
              <td className="rfi-val">{data.area}</td>
              <td className="rfi-lbl">Date:</td>
              <td className="rfi-val">{data.date}</td>
            </tr>
            <tr>
              <td className="rfi-lbl">Activity:</td>
              <td className="rfi-val" colSpan={3}>
                {data.activity}
              </td>
            </tr>
            <tr>
              <td className="rfi-lbl">Ref.:</td>
              <td className="rfi-val" colSpan={3}>
                {data.ref}
              </td>
            </tr>
            <tr>
              <td className="rfi-lbl rfi-top">Scope / Remarks:</td>
              {/* Manual: filled in by hand on site. */}
              <td className="rfi-val rfi-blank rfi-area" colSpan={3} />
            </tr>
          </tbody>
        </table>

        {/* Declaration, verbatim. */}
        <table className="rfi-table">
          <tbody>
            <tr>
              <td className="rfi-declaration">{data.declaration}</td>
            </tr>
          </tbody>
        </table>

        {/* Contractor sign-off — from the record's captured contractor signature. */}
        <table className="rfi-table">
          <colgroup>
            <col style={{ width: "25%" }} />
            <col style={{ width: "40%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "20%" }} />
          </colgroup>
          <tbody>
            <tr>
              <td className="rfi-section" colSpan={4}>
                CONTRACTOR SIGN-OFF
              </td>
            </tr>
            <tr>
              <td className="rfi-lbl">Inspected By:</td>
              <td className="rfi-val">{data.contractorSignOff?.name ?? ""}</td>
              <td className="rfi-lbl">Date:</td>
              <td className="rfi-val">{data.contractorSignOff?.date ?? ""}</td>
            </tr>
            <tr>
              <td className="rfi-lbl rfi-top">Signature:</td>
              <td className="rfi-sig-cell" colSpan={3}>
                {data.contractorSignOff?.imageUrl ? (
                  <img
                    className="rfi-sig-img"
                    src={data.contractorSignOff.imageUrl}
                    alt=""
                  />
                ) : (
                  <span className="rfi-sig-box" />
                )}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Inspection result — manual, blank boxes for handwriting on site. */}
        <table className="rfi-table">
          <tbody>
            <tr>
              <td className="rfi-section" colSpan={4}>
                INSPECTION RESULT
              </td>
            </tr>
            <tr>
              <td className="rfi-result-cell" colSpan={4}>
                <span className="rfi-result-box">☐ PASS</span>
                <span className="rfi-result-box">☐ FAIL</span>
                <span className="rfi-result-box">☐ CONDITIONAL PASS</span>
              </td>
            </tr>
            <tr>
              <td className="rfi-lbl rfi-top">Comments:</td>
              <td className="rfi-val rfi-blank rfi-area" colSpan={3} />
            </tr>
          </tbody>
        </table>

        {/* Inspector / engineer sign-off — manual, blank. */}
        <table className="rfi-table">
          <colgroup>
            <col style={{ width: "25%" }} />
            <col style={{ width: "40%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "20%" }} />
          </colgroup>
          <tbody>
            <tr>
              <td className="rfi-section" colSpan={4}>
                INSPECTOR / ENGINEER SIGN-OFF
              </td>
            </tr>
            <tr>
              <td className="rfi-lbl">Inspected By:</td>
              <td className="rfi-val rfi-blank" />
              <td className="rfi-lbl">Date:</td>
              <td className="rfi-val rfi-blank" />
            </tr>
            <tr>
              <td className="rfi-lbl rfi-top">Signature:</td>
              <td className="rfi-sig-cell" colSpan={3}>
                <span className="rfi-sig-box" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer className="print-foot rfi-foot">
        <span>{record.serial_no ?? "—"}</span>
        <span>Inspection Request cover</span>
        <span>
          {template.code} · Rev {template.rev}
        </span>
        <span className="print-foot-status">{status.toUpperCase()}</span>
      </footer>
    </section>
  );
}

/** One discipline checkbox cell; `other` (when defined) renders the free-text box. */
function RfiDisciplineCell(props: {
  checked: boolean;
  label: string;
  other?: string;
}): ReactNode {
  return (
    <td className="rfi-cb-cell">
      <span className="rfi-cb">{props.checked ? "☑" : "☐"}</span>
      <span className="rfi-cb-label">{props.label}</span>
      {props.other !== undefined && (
        <span className="rfi-cb-other">{props.other}</span>
      )}
    </td>
  );
}
