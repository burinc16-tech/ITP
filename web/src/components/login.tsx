import { useState, type ReactNode } from "react";
import type { AuthClient, Session } from "../data/auth";

/**
 * Sign-in screen (SPEC §3, task 4). Shown when the app is configured to talk to
 * the API but has no valid session. On success it hands the session up to the app,
 * which stores the token and uses the authenticated user's role.
 */
export function Login(props: {
  client: AuthClient;
  onLogin: (session: Session) => void;
}): ReactNode {
  const { client, onLogin } = props;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const session = await client.login(email.trim(), password);
      onLogin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <header className="login-bar">
        <h1>ITP / ITR Checklists</h1>
        <p>Kenyon Pte Ltd — Testing &amp; Commissioning</p>
      </header>
      <main className="login-main">
        <form className="login-card" onSubmit={(e) => void submit(e)}>
          <h2>Sign in</h2>
          <label className="sign-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              autoComplete="username"
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="sign-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="status-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="save-button" disabled={!ready}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}
