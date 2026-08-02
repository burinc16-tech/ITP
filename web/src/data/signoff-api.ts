import type { ChecklistRecord } from "./record";

/**
 * Client for the remote sign-off endpoints (SPEC §6 path B, server task 2a).
 *
 * Two audiences:
 *  - the PUBLIC token endpoints (`/api/sign/:token`), called by the account-less
 *    link page — no auth, guarded by the single-use token itself;
 *  - the PRIVILEGED issue/revoke endpoints, called in-app by QA/QC with the
 *    interim shared secret (until real auth, §3).
 *
 * `fetch` is injectable so the page and the issue UI can be tested without a
 * network. Errors are mapped to a small set of `kind`s so the UI can show the
 * right message (expired link, superseded by an edit, already used, …).
 */

/** What the public link page needs to render + sign. Mirrors the GET response. */
export interface SignLinkView {
  record: ChecklistRecord;
  slot: { slot_id: string; role: string };
  recipient: { name: string | null; email: string };
  expires_at: string;
  status: string;
}

/** Why a link can't be used. `error` is the catch-all (network/5xx/unexpected). */
export type SignLinkError = "unknown" | "closed" | "expired" | "version_mismatch" | "error";

export type OpenResult =
  | { ok: true; view: SignLinkView }
  | { ok: false; kind: SignLinkError };

export type ActionResult = { ok: true } | { ok: false; kind: SignLinkError };

export interface IssueInput {
  slot_id: string;
  role: string;
  recipient_name?: string | null;
  recipient_email: string;
}

export interface IssuedRequest {
  id: string;
  token: string;
  url: string;
  expires_at: string;
  /** Whether the server emailed the link to the recipient (task 3). */
  emailed?: boolean;
}

type Fetch = typeof fetch;

const trimBase = (base: string): string => base.replace(/\/$/, "");

/** Map a non-2xx response to an error kind, reading `error` from the JSON body. */
async function errorKind(res: Response): Promise<SignLinkError> {
  if (res.status === 404) return "unknown";
  if (res.status === 410) return "expired";
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error === "version_mismatch" ? "version_mismatch" : "closed";
  }
  return "error";
}

/** Open a link: fetch the read-only record + who is being asked to sign. */
export async function openSignLink(
  baseUrl: string,
  token: string,
  fetchImpl: Fetch = fetch,
): Promise<OpenResult> {
  try {
    const res = await fetchImpl(`${trimBase(baseUrl)}/api/sign/${token}`);
    if (!res.ok) return { ok: false, kind: await errorKind(res) };
    return { ok: true, view: (await res.json()) as SignLinkView };
  } catch {
    return { ok: false, kind: "error" };
  }
}

/** Submit a drawn signature (white-backed PNG data URL). */
export async function submitSignature(
  baseUrl: string,
  token: string,
  input: { image: string; name?: string; company?: string },
  fetchImpl: Fetch = fetch,
): Promise<ActionResult> {
  try {
    const res = await fetchImpl(`${trimBase(baseUrl)}/api/sign/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { ok: false, kind: await errorKind(res) };
    return { ok: true };
  } catch {
    return { ok: false, kind: "error" };
  }
}

/** Reject the link with a required reason; the server flips the record to rejected. */
export async function rejectSignLink(
  baseUrl: string,
  token: string,
  reason: string,
  fetchImpl: Fetch = fetch,
): Promise<ActionResult> {
  try {
    const res = await fetchImpl(`${trimBase(baseUrl)}/api/sign/${token}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) return { ok: false, kind: await errorKind(res) };
    return { ok: true };
  } catch {
    return { ok: false, kind: "error" };
  }
}

/** A bearer token, or a getter for the current session token (task 4). */
export type TokenSource = string | (() => string | null);

/**
 * Privileged issue/revoke client (QA/QC). Holds the API base + the signed-in
 * user's session token (task 4). The record must already be synced to the server
 * (ApiSync pushes on save) for issue to find it.
 */
export class SignoffClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: TokenSource,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private authHeaders(): Record<string, string> {
    const token = typeof this.token === "function" ? this.token() : this.token;
    return {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  /** Issue a link for one signature slot. Returns the request + raw token/url. */
  async issue(recordId: string, input: IssueInput): Promise<IssuedRequest> {
    const res = await this.fetchImpl(
      `${trimBase(this.baseUrl)}/api/records/${recordId}/sign-requests`,
      { method: "POST", headers: this.authHeaders(), body: JSON.stringify(input) },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Issue failed (HTTP ${res.status})`);
    }
    return (await res.json()) as IssuedRequest;
  }

  /** Revoke an outstanding request by id. */
  async revoke(requestId: string): Promise<void> {
    const res = await this.fetchImpl(
      `${trimBase(this.baseUrl)}/api/sign-requests/${requestId}/revoke`,
      { method: "POST", headers: this.authHeaders() },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Revoke failed (HTTP ${res.status})`);
    }
  }
}
