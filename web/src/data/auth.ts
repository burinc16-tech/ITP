import type { Role } from "./roles";

/**
 * Client for email/password auth (SPEC §3, task 4). Talks to the Worker's
 * `/api/auth/*` endpoints; the returned bearer token is what ApiSync and the
 * SignoffClient send on privileged calls (it replaced the old shared secret).
 * `fetch` is injectable for tests.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Session {
  token: string;
  user: AuthUser;
  expires_at: string;
}

const trimBase = (base: string): string => base.replace(/\/$/, "");

export class AuthClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Log in; resolves to a session or throws with a user-facing message. */
  async login(email: string, password: string): Promise<Session> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${trimBase(this.baseUrl)}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new Error("Couldn't reach the server. Check your connection and try again.");
    }
    if (res.status === 401) throw new Error("Incorrect email or password.");
    if (!res.ok) throw new Error(`Login failed (HTTP ${res.status}).`);
    return (await res.json()) as Session;
  }

  /** Resolve the current user for a stored token, or null if it's invalid/expired. */
  async me(token: string): Promise<AuthUser | null> {
    try {
      const res = await this.fetchImpl(`${trimBase(this.baseUrl)}/api/auth/me`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return ((await res.json()) as { user: AuthUser }).user;
    } catch {
      return null;
    }
  }

  /** Best-effort logout; the local session is cleared regardless by the caller. */
  async logout(token: string): Promise<void> {
    try {
      await this.fetchImpl(`${trimBase(this.baseUrl)}/api/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      // Ignore — the client drops the token either way.
    }
  }
}

const STORAGE_KEY = "itp-itr-session-token";

/** Persist (or clear) the session token so a reload keeps the user signed in. */
export function storeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / storage disabled — the session is just in-memory this run.
  }
}

export function loadStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
