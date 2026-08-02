import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { SignLinkPage } from "./components/sign-link-page";
import { TEMPLATES } from "./templates";

// The main app is loaded lazily so the account-less /sign/:token page never
// pulls in app.tsx and its Dexie construction — a remote signer needs none of it.
const App = lazy(() => import("./app").then((m) => ({ default: m.App })));

/** Match `/sign/:token` (token = hex). Returns the token, or null for the app. */
function signToken(pathname: string): string | null {
  const match = /^\/sign\/([0-9a-fA-F]+)\/?$/.exec(pathname);
  return match ? match[1]! : null;
}

function Root(): ReactNode {
  const token = signToken(window.location.pathname);
  if (token) {
    // Same-origin API by default; VITE_API_URL points elsewhere in split deploys.
    const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
    return <SignLinkPage token={token} baseUrl={baseUrl} templates={TEMPLATES} />;
  }
  return (
    <Suspense fallback={<p className="record-loading">Loading…</p>}>
      <App />
    </Suspense>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
