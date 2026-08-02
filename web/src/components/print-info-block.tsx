import { Fragment, type ReactNode } from "react";
import type { Template } from "@schema";
import { formatFieldValue } from "../lib/print-format";
import type { RecordValues } from "../lib/values";

/** The record header block (project, doc no, inspector, …) as printed values. */
export function PrintInfoBlock(props: {
  template: Template;
  values: RecordValues;
}): ReactNode {
  const { template, values } = props;
  return (
    <div className="print-info-block">
      {template.header.title && (
        <div className="print-block-title">{template.header.title}</div>
      )}
      <div className="print-info-grid">
        {template.header.fields.map((field) => (
          <Fragment key={field.id}>
            <div className="print-lbl">{field.label}</div>
            <div className="print-colon">:</div>
            <div className={field.bold ? "print-val print-bold" : "print-val"}>
              {formatFieldValue(field.type, values.header[field.id] ?? "", {
                unit: field.unit,
              })}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
