import type { ReactNode } from "react";
import type { Section, Template } from "@schema";
import type { RecordStatus } from "../data/record";
import type { SignatureView } from "../data/signature";
import { buildVarMap } from "../lib/interpolate";
import type { RecordValues } from "../lib/values";
import { PrintInfoBlock } from "./print-info-block";
import { PrintPage } from "./print-page";
import { PrintSection } from "./print-section";
import { PrintSignOff } from "./print-sign-off";
import "../print.css";

const NO_SIGNATURES: Map<string, SignatureView> = new Map();

/**
 * Group sections into printed pages. A template that declares page boundaries
 * with `page_break_before` (SPEC §12, e.g. the multi-page Power Turn-on form)
 * paginates on those breaks; a template with none keeps the original
 * one-section-per-page layout, matching the source paper form.
 */
function paginate(sections: Section[]): Section[][] {
  const hasBreaks = sections.some(
    (s) => (s as { page_break_before?: boolean }).page_break_before,
  );
  if (!hasBreaks) return sections.map((s) => [s]);

  const pages: Section[][] = [];
  for (const s of sections) {
    const breakBefore = (s as { page_break_before?: boolean })
      .page_break_before;
    if (pages.length === 0 || breakBefore) pages.push([s]);
    else pages[pages.length - 1]!.push(s);
  }
  return pages;
}

/**
 * Static, read-only rendering of a record for print/PDF (SPEC §7). Page breaks
 * match the source form so each page can carry a real "Page X of Y" footer
 * without a PDF library. The `@page` size is derived from the template.
 */
export function PrintView(props: {
  template: Template;
  values: RecordValues;
  status: RecordStatus;
  serialNo: string | null;
  signatures?: Map<string, SignatureView>;
}): ReactNode {
  const { template, values, status, serialNo } = props;
  const signatures = props.signatures ?? NO_SIGNATURES;
  const vars = buildVarMap(template.variables, values.variables);

  const pageStyle = `@page { size: A4 ${template.page.orientation}; margin: 0; }`;
  const pages = paginate(template.sections);
  const total = pages.length + (template.footer ? 1 : 0);

  return (
    <div className="print-doc">
      <style>{pageStyle}</style>

      {pages.map((sections, pageIdx) => (
        <PrintPage
          key={sections[0]!.id}
          template={template}
          index={pageIdx + 1}
          total={total}
          serialNo={serialNo}
          status={status}
        >
          {sections.map((section, secIdx) => (
            <PrintSection
              key={section.id}
              section={section}
              values={values}
              vars={vars}
              signatures={signatures}
              interstitial={
                pageIdx === 0 && secIdx === 0 ? (
                  <PrintInfoBlock template={template} values={values} />
                ) : undefined
              }
            />
          ))}
        </PrintPage>
      ))}

      {template.footer && (
        <PrintPage
          template={template}
          index={total}
          total={total}
          serialNo={serialNo}
          status={status}
        >
          <PrintSignOff footer={template.footer} captured={signatures} />
        </PrintPage>
      )}
    </div>
  );
}
