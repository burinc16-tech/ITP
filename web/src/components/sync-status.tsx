import { useCallback, useEffect, useState, type ReactNode } from "react";
import { subscribePending } from "../data/sync";
import type { SyncStatusSource } from "../data/sync-queue";

/**
 * The on-screen "pending unsynced" indicator (SPEC §8). Reads the outbox count
 * from the sync layer and refreshes on every outbox change (enqueue, delivery,
 * reschedule) via the pending bus — no polling. Also reflects connectivity, and
 * when online with a backlog it doubles as a "retry now" button so an engineer
 * who just walked back into signal can flush without waiting for the next kick.
 *
 * Only mounted when the durable queue exists (the API is configured); local-only
 * mode has nothing to sync.
 */
export function SyncStatus(props: { source: SyncStatusSource }): ReactNode {
  const { source } = props;
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);

  const refresh = useCallback(() => {
    void source.pendingCount().then(setPending);
  }, [source]);

  // Initial read, then re-read whenever the outbox changes.
  useEffect(() => {
    refresh();
    return subscribePending(refresh);
  }, [refresh]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const label = !online
    ? pending > 0
      ? `Offline — ${pending} pending`
      : "Offline"
    : pending > 0
      ? `${pending} pending sync`
      : "All synced";

  const stateClass = !online ? "is-offline" : pending > 0 ? "is-pending" : "is-synced";

  // Online with a backlog: offer an explicit retry. Otherwise it's a plain status.
  if (online && pending > 0) {
    return (
      <button
        type="button"
        className={`sync-status ${stateClass}`}
        onClick={() => void source.drain()}
        aria-label={`${label}. Retry now.`}
        aria-live="polite"
      >
        <span className="sync-dot" aria-hidden="true" />
        {label}
      </button>
    );
  }

  return (
    <span className={`sync-status ${stateClass}`} role="status" aria-live="polite">
      <span className="sync-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
