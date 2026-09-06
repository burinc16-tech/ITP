import type { Role } from "./roles";

/**
 * Client for email/password auth (SPEC §3, task 4). Talks to the Worker's
 * `/api/auth/*` endpoints; the returned bearer token is what the sync layer and
 * the SignoffClient send on privileged calls (it replaced the old shared secret).
 * `fetch` is injectable for tests.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** A directory entry: who a stored user id is. Never carries the email. */
export interface DirectoryUser {
  id: string;
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
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
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

  /**
   * Every user the server knows (id, name, role): the directory behind the
   * register BY column, which otherwise shows the raw creator id. Null when the
   * call fails so the caller keeps whatever directory it last cached.
   */
  async listUsers(token: string): Promise<DirectoryUser[] | null> {
    try {
      const res = await this.fetchImpl(`${trimBase(this.baseUrl)}/api/users`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return ((await res.json()) as { users: DirectoryUser[] }).users;
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

const DIRECTORY_KEY = "itp-itr-user-directory";

/**
 * Cache the user directory so names resolve offline and on the first render
 * after a reload, before the login backfill has re-fetched it.
 */
export function storeUserDirectory(users: DirectoryUser[]): void {
  try {
    localStorage.setItem(DIRECTORY_KEY, JSON.stringify(users));
  } catch {
    // Storage unavailable: the directory lives in memory for this run only.
  }
}

export function loadUserDirectory(): DirectoryUser[] {
  try {
    const raw = localStorage.getItem(DIRECTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (u): u is DirectoryUser =>
        typeof u === "object" &&
        u !== null &&
        typeof (u as DirectoryUser).id === "string" &&
        typeof (u as DirectoryUser).name === "string",
    );
  } catch {
    return [];
  }
}

/** id -> display name, the shape the register consumes. */
export function userNameMap(users: DirectoryUser[]): Map<string, string> {
  return new Map(users.map((u) => [u.id, u.name]));
}
