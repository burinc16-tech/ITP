import type { ReactNode } from "react";

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

export interface SaveState {
  status: SaveStatus;
  at?: string;
}

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function statusText(state: SaveState): string {
  switch (state.status) {
    case "saving":
      return "Saving…";
    case "saved":
      return state.at
        ? `All changes saved · ${timeFormat.format(new Date(state.at))}`
        : "All changes saved";
    case "unsaved":
      return "Unsaved changes";
    case "error":
      return "Save failed — your work is kept locally; try Save record again";
    default:
      return "";
  }
}

/** Sticky bar showing local save status and an explicit Save action. */
export function SaveBar(props: {
  state: SaveState;
  onSave: () => void;
}): ReactNode {
  const { state, onSave } = props;
  return (
    <div className="save-bar">
      <span
        className={`save-status save-${state.status}`}
        role="status"
        aria-live="polite"
      >
        {statusText(state)}
      </span>
      <button
        type="button"
        className="save-button"
        onClick={onSave}
        disabled={state.status === "saving"}
      >
        Save record
      </button>
    </div>
  );
}
