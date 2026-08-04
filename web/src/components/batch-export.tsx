import { useEffect, useState, type ReactNode } from "react";
import type { Template } from "@schema";
import type { AttachmentView } from "../data/attachment";
import type { AttachmentsRepo } from "../data/attachments-repo";
import { templateFor, type ChecklistRecord } from "../data/record";
import type { RecordsRepo } from "../data/records-repo";
import type { SignaturesRepo } from "../data/signatures-repo";
import type { SignatureView } from "../data/signature";
import { PrintView } from "./print-view";

interface ExportRecord {
  record: ChecklistRecord;
  template: Template;
  signatures: Map<string, SignatureView>;
  attachments: Map<string, AttachmentView[]>;
}

/**
 * Batch PDF export (SPEC §7): the selected records rendered as stacked print
 * views, printed to one PDF via the browser — no PDF library. Each record keeps
 * its own header, footer, serial, watermark, and page numbering; a page break
 * before each record starts it on a fresh sheet.
 *
 * Browser `@page` orientation is document-global, so a single job can't mix
 * landscape and portrait. A mixed selection is blocked with guidance rather than
 * printed wrong — one orientation per package for now.
 */
export function BatchExport(props: {
  repo: RecordsRepo;
  signaturesRepo: SignaturesRepo;
  attachmentsRepo?: AttachmentsRepo;
  templates: Template[];
  ids: string[];
  onBack: () => void;
}): ReactNode {
  const { repo, signaturesRepo, attachmentsRepo, templates, ids, onBack } = props;
  const [loaded, setLoaded] = useState<ExportRecord[] | null>(null);
  const [missing, setMissing] = useState(0);

  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void (async () => {
      const out: ExportRecord[] = [];
      let notFound = 0;
      for (const id of ids) {
        const record = await repo.get(id);
        const template = record && templateFor(record, templates);
        if (!record || !template) {
          notFound += 1;
          continue;
        }
        const signatures = new Map<string, SignatureView>();
        for (const s of await signaturesRepo.listByRecord(id)) {
          const url = URL.createObjectURL(s.image);
          urls.push(url);
          signatures.set(s.slot_id, {
            slot_id: s.slot_id,
            role: s.role,
            name: s.name,
            company: s.company,
            method: s.method,
            signed_at: s.signed_at,
            image_url: url,
          });
        }
        const attachments = new Map<string, AttachmentView[]>();
        for (const a of (await attachmentsRepo?.listByRecord(id)) ?? []) {
          const url = URL.createObjectURL(a.image);
          urls.push(url);
          const view: AttachmentView = {
            id: a.id,
            field_id: a.field_id,
            caption: a.caption,
            image_url: url,
          };
          const list = attachments.get(a.field_id);
          if (list) list.push(view);
          else attachments.set(a.field_id, [view]);
        }
        out.push({ record, template, signatures, attachments });
      }
      if (!alive) {
        for (const url of urls) URL.revokeObjectURL(url);
        return;
      }
      setLoaded(out);
      setMissing(notFound);
    })();
    return () => {
      alive = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [ids, repo, signaturesRepo, attachmentsRepo, templates]);

  const orientations = new Set(
    (loaded ?? []).map((l) => l.template.page.orientation),
  );
  const mixed = orientations.size > 1;

  return (
    <div className="batch-export">
      <div className="batch-controls no-print">
        <button type="button" className="ghost-button" onClick={onBack}>
          ← Register
        </button>
        <span className="batch-count">
          {loaded ? `${loaded.length} record${loaded.length === 1 ? "" : "s"}` : "Loading…"}
          {missing > 0 ? ` · ${missing} not found` : ""}
        </span>
        <button
          type="button"
          className="save-button"
          disabled={!loaded || loaded.length === 0 || mixed}
          onClick={() => window.print()}
        >
          Print / Save as PDF
        </button>
      </div>

      {loaded && mixed && (
        <p className="batch-warning no-print" role="alert">
          This selection mixes landscape and portrait forms, which can't share one
          PDF. Filter the register to a single template (one orientation) and
          export again.
        </p>
      )}

      {loaded && !mixed &&
        loaded.map(({ record, template, signatures, attachments }) => (
          <div key={record.id} className="batch-record">
            <PrintView
              template={template}
              values={record.values}
              status={record.status}
              serialNo={record.serial_no}
              signatures={signatures}
              attachments={attachments}
            />
          </div>
        ))}
    </div>
  );
}
