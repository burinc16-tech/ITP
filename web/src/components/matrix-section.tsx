import { Fragment, type ReactNode } from "react";
import type { MatrixSection as MatrixSectionDef } from "@schema";
import { setRowValue } from "../lib/values";
import { FieldControl } from "./field-control";
import { useForm } from "./form-context";

/**
 * A fixed numeric grid (SPEC §12) — e.g. the Power Turn-on insulation and
 * voltage tables. Each band renders a header row of its measurement-point
 * labels and an input row of numeric cells. A point evaluates against its band
 * `limit`, or the section `limit` when the band sets none. Point values live in
 * `values.rows`, keyed by point id.
 */
export function MatrixSection(props: {
  section: MatrixSectionDef;
}): ReactNode {
  const { section } = props;
  const { values, onChange } = useForm();

  return (
    <section className="section">
      <h2 className="section-title">
        {section.no ? `${section.no}. ` : ""}
        {section.title}
      </h2>
      {section._status && (
        <p className="section-note" role="note">
          {section._status}
        </p>
      )}

      <div className="table-scroll">
        <table className="matrix-table">
          <tbody>
            {section.row_bands.map((band) => {
              const limit = band.limit ?? section.limit;
              const key = band.id ?? band.label;
              return (
                <Fragment key={key}>
                  <tr className="matrix-band-head">
                    <th scope="row">
                      {band.label}
                      {band.unit ? ` (${band.unit})` : ""}
                    </th>
                    {band.points.map((point) => (
                      <td key={point.id} className="matrix-point-label">
                        {point.label}
                      </td>
                    ))}
                  </tr>
                  <tr className="matrix-band-inputs">
                    <td className="matrix-unit">{band.unit ?? ""}</td>
                    {band.points.map((point) => (
                      <td key={point.id}>
                        <FieldControl
                          type="number"
                          value={values.rows[point.id]?.value ?? ""}
                          onChange={(v) =>
                            onChange(setRowValue(values, point.id, v))
                          }
                          id={`matrix-${point.id}`}
                          ariaLabel={`${band.label} ${point.label}`}
                          limit={limit}
                        />
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
