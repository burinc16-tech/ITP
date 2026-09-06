import type { ReactNode } from "react";
import type { Template } from "@schema";
import { KENYON_LOGO } from "../assets/kenyon-logo";
import type { RecordStatus } from "../data/record";

/**
 * One printed A4 page: repeated Kenyon header, the page body, the DRAFT
 * watermark when `draft` is set (decided once per document from
 * `lib/watermark`), and a footer carrying serial no, template code
 * + rev, page X of Y, and status (CLAUDE.md print rules). Page dimensions come
 * from the template's orientation — never hardcoded, and so does the print
 * density (`page.density`), which tightens a dense form onto one sheet.
 */
export function PrintPage(props: {
  template: Template;
  index: number;
  total: number;
  serialNo: string | null;
  status: RecordStatus;
  draft: boolean;
  children: ReactNode;
}): ReactNode {
  const { template, index, total, serialNo, status, draft, children } = props;
  return (
    <section
      className="print-page"
      data-orientation={template.page.orientation}
      data-density={template.page.density ?? "normal"}
    >
      {draft && (
        <div className="print-watermark" aria-hidden="true">
          DRAFT
        </div>
      )}
      <header className="print-head">
        <img className="print-logo" src={KENYON_LOGO} alt="Kenyon" />
        <div className="print-head-title">{template.title}</div>
      </header>

      <div className="print-page-body">{children}</div>

      <footer className="print-foot">
        <span className="print-foot-serial">{serialNo ?? "—"}</span>
        <span>
          {template.code} · Rev {template.rev}
        </span>
        <span>
          Page {index} of {total}
        </span>
        <span className="print-foot-status">{status.toUpperCase()}</span>
      </footer>
    </section>
  );
}
