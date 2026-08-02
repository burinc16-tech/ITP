import { Fragment, type ReactNode } from "react";
import {
  isDynamicTableSection,
  isFieldGroupSection,
  isMatrixSection,
  isSignOffSection,
  isStandardSection,
  type Section,
} from "@schema";
import { DynamicTableSection } from "./dynamic-table-section";
import { FieldGroupSection } from "./field-group-section";
import { MatrixSection } from "./matrix-section";
import { SignOffSection } from "./sign-off-section";
import { StandardSection } from "./standard-section";

/** Dispatches a section to the renderer for its shape. */
export function FormSection(props: { section: Section }): ReactNode {
  const { section } = props;

  const content = renderSection(section);
  const breakBefore = (section as { page_break_before?: boolean })
    .page_break_before;

  if (!breakBefore) return content;
  return (
    <Fragment>
      <div className="page-break" role="separator" aria-label="Page break" />
      {content}
    </Fragment>
  );
}

function renderSection(section: Section): ReactNode {
  if (isDynamicTableSection(section))
    return <DynamicTableSection section={section} />;
  if (isMatrixSection(section)) return <MatrixSection section={section} />;
  if (isFieldGroupSection(section))
    return <FieldGroupSection section={section} />;
  if (isSignOffSection(section)) return <SignOffSection section={section} />;
  if (isStandardSection(section)) return <StandardSection section={section} />;
  return null;
}
