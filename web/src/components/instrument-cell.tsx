import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Instrument } from "../data/instrument";
import { instrumentOptionLabel } from "../lib/instrument-link";

/**
 * The instrument column of a table flagged `link_to_instrument_register`
 * (SPEC §5): a text cell that is also a picker over the calibration register.
 *
 * Typing is always allowed — an engineer with a tool the register does not hold
 * yet must not be blocked — and the list is a shortcut, not a constraint. This
 * is why the control is an input with a listbox rather than a `<select>`:
 * picking fills the whole row (make/serial/cert/dates), typing fills only the
 * cell, and both leave the same plain text on the printout.
 *
 * The menu is positioned `fixed` against the input: the table scrolls
 * horizontally (`.table-scroll { overflow-x: auto }`), and an absolutely
 * positioned menu would be clipped by it on a phone.
 */
export function InstrumentCell(props: {
  id: string;
  ariaLabel: string;
  value: string;
  instruments: readonly Instrument[];
  disabled: boolean;
  /** Free typing — writes this cell only. */
  onChange: (value: string) => void;
  /** A register pick — fills every matching column on the row. */
  onPick: (instrument: Instrument) => void;
  /** Expired-calibration warning for the instrument this row refers to. */
  warning?: string | null;
}): ReactNode {
  const { id, ariaLabel, value, instruments, disabled, onChange, onPick, warning } = props;
  const listId = `${useId()}-instrument-list`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // Filtering starts only once the engineer types INTO the open menu. Opening a
  // cell that already holds text — most instrument rows arrive prefilled with a
  // function like "Insulation Resistance" — must still offer the whole
  // register, not filter it down to nothing.
  const [query, setQuery] = useState<string>();
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number }>();

  const matches = filterInstruments(instruments, query ?? "");

  // Anchor the fixed menu under the input, and follow the input if the page or
  // the table scrolls while the menu is open.
  const place = useCallback(() => {
    const box = inputRef.current?.getBoundingClientRect();
    if (box) setAnchor({ left: box.left, top: box.bottom, width: box.width });
  }, []);
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onScroll = (): void => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  const openMenu = (): void => {
    setQuery(undefined);
    setActive(0);
    setOpen(true);
  };

  const pick = (instrument: Instrument): void => {
    onPick(instrument);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (matches.length ? (i + step + matches.length) % matches.length : 0));
    } else if (e.key === "Enter" && open) {
      const chosen = matches[active];
      if (chosen) {
        e.preventDefault();
        pick(chosen);
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div
      className="instrument-cell"
      ref={wrapRef}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className="instrument-cell-input">
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
          value={value}
          readOnly={disabled}
          onChange={(e) => {
            onChange(e.target.value);
            setQuery(e.target.value);
            setActive(0);
            if (!disabled) setOpen(true);
          }}
          onClick={() => {
            if (!disabled && !open) openMenu();
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="instrument-cell-toggle"
          aria-label={`Show the calibration register for ${ariaLabel}`}
          aria-expanded={open}
          disabled={disabled}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) setOpen(false);
            else openMenu();
            inputRef.current?.focus();
          }}
        >
          ▾
        </button>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="instrument-menu"
          aria-label="Calibration register"
          style={
            anchor && { left: anchor.left, top: anchor.top, minWidth: anchor.width }
          }
        >
          {matches.length === 0 ? (
            <li className="instrument-menu-empty" role="presentation">
              No instrument matches — what you typed is kept.
            </li>
          ) : (
            matches.map((instrument, i) => (
              <li
                key={instrument.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "is-active" : undefined}
                // Keep focus on the input so the cell's blur doesn't close the
                // menu before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(instrument)}
              >
                {instrumentOptionLabel(instrument)}
              </li>
            ))
          )}
        </ul>
      )}

      {warning && (
        <p className="cal-link-warning" role="alert">
          {warning}
        </p>
      )}
    </div>
  );
}

/**
 * Register rows matching what has been typed, over the three things an engineer
 * reads off a tool or its certificate. An empty cell offers the whole register.
 */
function filterInstruments(
  instruments: readonly Instrument[],
  query: string,
): readonly Instrument[] {
  const q = query.trim().toLowerCase();
  if (!q) return instruments;
  return instruments.filter((i) =>
    `${i.description} ${i.serial_no} ${i.cert_no ?? ""}`.toLowerCase().includes(q),
  );
}
