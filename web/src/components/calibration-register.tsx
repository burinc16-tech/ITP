import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createInstrument, type Instrument } from "../data/instrument";
import type { InstrumentsRepo } from "../data/instruments-repo";
import { uuidv7 } from "../data/uuidv7";
import { calibrationStanding, type CalStatus } from "../lib/calibration";

const STATUS_LABEL: Record<CalStatus, string> = {
  valid: "Valid",
  due_soon: "Due soon",
  expired: "Expired",
};
// Worst standing first, so anything needing attention is at the top of the list.
const STATUS_ORDER: Record<CalStatus, number> = { expired: 0, due_soon: 1, valid: 2 };

const emptyForm = { serial: "", description: "", certUrl: "", calDate: "", dueDate: "" };

/** `YYYY-MM-DD` → `dd/mm/yyyy` for display (CLAUDE.md); anything else unchanged. */
function displayDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/** Today in Asia/Singapore as `YYYY-MM-DD` — the as-of date for expiry (§8). */
function sgtToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date());
}

function dueLabel(status: CalStatus, days: number): string {
  if (Number.isNaN(days)) return "no due date";
  if (status === "expired") return `overdue ${Math.abs(days)}d`;
  if (days === 0) return "due today";
  return `${days}d left`;
}

/**
 * The calibration register (SPEC §10 screen 9): every test instrument, its
 * certificate expiry, and expired/expiring warnings so an out-of-calibration
 * tool is never used unknowingly. Instruments are local-first reference data
 * edited in place (upsert). Linking instruments to the records that used them —
 * and flagging a record that used an expired one — is the next task.
 */
export function CalibrationRegister(props: {
  repo: InstrumentsRepo;
  newId?: () => string;
  today?: () => string;
}): ReactNode {
  const { repo, newId = uuidv7, today = sgtToday } = props;
  const asOf = today();

  const [instruments, setInstruments] = useState<Instrument[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Show what is on the device first, then reconcile with the server: the
    // register must stay usable in a plant room with no signal, and a merge that
    // fails or hangs should never leave the screen empty.
    setInstruments(await repo.list());
    await repo.syncDown();
    setInstruments(await repo.list());
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load]);

  // Attach standing and sort worst-first, then soonest-due, then by serial.
  const rows = useMemo(() => {
    const withStanding = (instruments ?? []).map((instrument) => ({
      instrument,
      standing: calibrationStanding(instrument.cal_due_date, asOf),
    }));
    withStanding.sort((a, b) => {
      const byStatus = STATUS_ORDER[a.standing.status] - STATUS_ORDER[b.standing.status];
      if (byStatus !== 0) return byStatus;
      if (a.standing.daysUntilDue !== b.standing.daysUntilDue) {
        return (a.standing.daysUntilDue || 0) - (b.standing.daysUntilDue || 0);
      }
      return a.instrument.serial_no.localeCompare(b.instrument.serial_no);
    });
    return withStanding;
  }, [instruments, asOf]);

  const counts = useMemo(() => {
    const c = { expired: 0, due_soon: 0, valid: 0 };
    for (const r of rows) c[r.standing.status] += 1;
    return c;
  }, [rows]);

  const canSave = form.serial.trim() !== "" && form.dueDate !== "";

  const save = async () => {
    if (!canSave) return;
    await repo.add(
      createInstrument({
        id: editingId ?? newId(),
        serialNo: form.serial.trim(),
        description: form.description.trim(),
        calCertUrl: form.certUrl.trim(),
        calDate: form.calDate,
        calDueDate: form.dueDate,
      }),
    );
    setForm(emptyForm);
    setEditingId(null);
    await load();
  };

  const edit = (instrument: Instrument) => {
    setEditingId(instrument.id);
    setForm({
      serial: instrument.serial_no,
      description: instrument.description,
      certUrl: instrument.cal_cert_url,
      calDate: instrument.cal_date,
      dueDate: instrument.cal_due_date,
    });
  };

  const remove = async (id: string) => {
    await repo.remove(id);
    if (editingId === id) {
      setEditingId(null);
      setForm(emptyForm);
    }
    await load();
  };

  return (
    <div className="cal-register">
      <div className="cal-summary" role="status" aria-live="polite">
        {counts.expired > 0 && (
          <p className="cal-warning">
            {counts.expired} instrument{counts.expired === 1 ? "" : "s"} out of calibration —
            do not use until re-certified.
          </p>
        )}
        <div className="cal-counts">
          <span className="cal-badge is-expired">{counts.expired} expired</span>
          <span className="cal-badge is-due_soon">{counts.due_soon} due soon</span>
          <span className="cal-badge is-valid">{counts.valid} valid</span>
        </div>
      </div>

      <div className="registry-form cal-form">
        <input
          aria-label="Instrument serial number"
          placeholder="Serial no."
          value={form.serial}
          onChange={(e) => setForm({ ...form, serial: e.target.value })}
        />
        <input
          aria-label="Instrument description"
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <label className="cal-date-field">
          <span>Calibrated</span>
          <input
            aria-label="Calibration date"
            type="date"
            value={form.calDate}
            onChange={(e) => setForm({ ...form, calDate: e.target.value })}
          />
        </label>
        <label className="cal-date-field">
          <span>Due</span>
          <input
            aria-label="Calibration due date"
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          />
        </label>
        <input
          aria-label="Calibration certificate reference"
          placeholder="Certificate ref / URL"
          value={form.certUrl}
          onChange={(e) => setForm({ ...form, certUrl: e.target.value })}
        />
        <button
          type="button"
          className="save-button"
          disabled={!canSave}
          onClick={() => void save()}
        >
          {editingId ? "Save instrument" : "Add instrument"}
        </button>
        {editingId && (
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setEditingId(null);
              setForm(emptyForm);
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {instruments === null ? (
        <p className="register-loading">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="register-empty">
          No instruments yet. Add the test equipment used on this project.
        </p>
      ) : (
        <table className="cal-table">
          <thead>
            <tr>
              <th scope="col">Serial no.</th>
              <th scope="col">Description</th>
              <th scope="col">Calibrated</th>
              <th scope="col">Due</th>
              <th scope="col">Standing</th>
              <th scope="col">Certificate</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ instrument, standing }) => (
              <tr key={instrument.id} className={`cal-row is-${standing.status}`}>
                <td>{instrument.serial_no}</td>
                <td>{instrument.description}</td>
                <td>{instrument.cal_date ? displayDate(instrument.cal_date) : "—"}</td>
                <td>{instrument.cal_due_date ? displayDate(instrument.cal_due_date) : "—"}</td>
                <td>
                  <span className={`cal-badge is-${standing.status}`}>
                    {STATUS_LABEL[standing.status]}
                  </span>{" "}
                  <span className="cal-due-note">
                    {dueLabel(standing.status, standing.daysUntilDue)}
                  </span>
                </td>
                <td>
                  {instrument.cal_cert_url ? (
                    <a href={instrument.cal_cert_url} target="_blank" rel="noreferrer">
                      Certificate
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="cal-actions">
                  <button type="button" className="ghost-button" onClick={() => edit(instrument)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void remove(instrument.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
