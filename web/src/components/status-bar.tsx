import { useState, type ReactNode } from "react";
import type { RecordStatus } from "../data/record";
import {
  ACTION_LABELS,
  actionsFrom,
  checkAction,
  type WorkflowAction,
  type WorkflowContext,
} from "../data/workflow";

export const STATUS_LABELS: Record<RecordStatus, string> = {
  draft: "Draft",
  completed: "Completed",
  submitted_for_witness: "Submitted for witness",
  witnessed: "Witnessed",
  accepted: "Accepted",
  rejected: "Rejected",
};

/**
 * The record's current status and the transitions available from it (SPEC §6),
 * gated by the acting role and by signature/field preconditions (§9). A blocked
 * action stays visible but disabled, with the reason shown, so the path forward
 * is obvious. Reject reveals a required-reason box.
 */
export function StatusBar(props: {
  status: RecordStatus;
  ctx: WorkflowContext;
  rev?: number;
  rejectionReason?: string | null;
  error?: string | null;
  onAction: (action: WorkflowAction, reason?: string) => void;
  onRevise?: () => void;
}): ReactNode {
  const { status, ctx, rev, rejectionReason, error, onAction, onRevise } = props;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const actions = actionsFrom(status);
  const rejectCheck = checkAction(status, "reject", ctx);

  return (
    <div className="status-bar-row">
      <div className="status-line">
        <span className={`status-chip status-chip-${status}`}>
          {STATUS_LABELS[status]}
        </span>
        {rev !== undefined && rev > 1 && (
          <span className="status-rev">Rev {rev}</span>
        )}
        <div className="status-actions">
          {actions
            .filter((a) => a !== "reject")
            .map((action) => (
              <TransitionButton
                key={action}
                status={status}
                action={action}
                ctx={ctx}
                onAction={onAction}
              />
            ))}
          {actions.includes("reject") && rejectCheck.allowed && (
            <button
              type="button"
              className="ghost-button status-reject-toggle"
              onClick={() => setRejecting((v) => !v)}
            >
              Reject
            </button>
          )}
          {status === "rejected" && onRevise && (
            <button
              type="button"
              className="save-button"
              onClick={onRevise}
            >
              Revise — create Rev {(rev ?? 1) + 1}
            </button>
          )}
        </div>
      </div>

      {status === "rejected" && rejectionReason && (
        <p className="status-reject-reason">
          <strong>Rejected:</strong> {rejectionReason}
        </p>
      )}

      {rejecting && (
        <div className="status-reject-box">
          <label className="sign-field">
            <span>Reason for rejection</span>
            <textarea
              value={reason}
              rows={2}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="save-button"
            disabled={reason.trim().length === 0}
            onClick={() => {
              onAction("reject", reason.trim());
              setRejecting(false);
              setReason("");
            }}
          >
            Confirm rejection
          </button>
        </div>
      )}

      {error && (
        <p className="status-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function TransitionButton(props: {
  status: RecordStatus;
  action: WorkflowAction;
  ctx: WorkflowContext;
  onAction: (action: WorkflowAction) => void;
}): ReactNode {
  const { status, action, ctx, onAction } = props;
  const check = checkAction(status, action, ctx);
  return (
    <span className="status-action">
      <button
        type="button"
        className="save-button"
        disabled={!check.allowed}
        onClick={() => onAction(action)}
      >
        {ACTION_LABELS[action]}
      </button>
      {!check.allowed && check.reason && (
        <span className="status-hint">{check.reason}</span>
      )}
    </span>
  );
}
