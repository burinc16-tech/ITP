/**
 * Ask the browser to keep this origin's storage (SPEC §8).
 *
 * Everything the app knows lives in IndexedDB, and the project registry has no
 * server copy at all — no `/api/projects` route, no `projects` table in D1 — so
 * a browser that evicts "best-effort" storage takes the project list with it and
 * nothing can restore it. `navigator.storage.persist()` moves the origin into
 * the persistent bucket, which browsers clear only on an explicit user action.
 *
 * Best-effort by design: it is unavailable in insecure contexts and older
 * browsers, Chrome may grant it silently or refuse outright, and it cannot
 * override a "clear site data on close" setting or a private window. A refusal
 * is not an error and nothing else in the app waits on the answer — this only
 * closes the eviction path, not every way a browser can drop the data.
 */
export async function requestPersistentStorage(
  storage: StorageManager | undefined = globalThis.navigator?.storage,
): Promise<boolean> {
  if (!storage?.persist || !storage.persisted) return false;
  try {
    // Already persistent on a return visit — asking again would be a no-op.
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
