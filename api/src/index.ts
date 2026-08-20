import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { createApp } from "./app";
import {
  D1AttachmentStore,
  D1AuditStore,
  D1InstrumentStore,
  D1RecordStore,
  D1RegistryStore,
  D1SessionStore,
  D1SignatureRequestStore,
  D1SignatureStore,
  D1UserStore,
  R2SignatureImageStore,
} from "./store";
import { ConsoleEmailSender, ResendEmailSender } from "./email";

export interface Env {
  DB: D1Database;
  /** R2 bucket holding signature PNGs (keys stored in signatures.image_key). */
  SIGNATURES: R2Bucket;
  /** Base URL of the public /sign/:token page (web app). Optional; falls back to request origin. */
  SIGN_BASE_URL?: string;
  /** Resend API key (set via `wrangler secret`). When unset, links are logged, not emailed. */
  RESEND_API_KEY?: string;
  /** Verified From address for outgoing mail, e.g. "Kenyon T&C <no-reply@your-domain>". */
  EMAIL_FROM?: string;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    // Real email only when a provider key is configured; otherwise log the link
    // locally so dev never depends on an outbound mail account.
    const email =
      env.RESEND_API_KEY && env.EMAIL_FROM
        ? new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM)
        : new ConsoleEmailSender();
    const app = createApp({
      store: new D1RecordStore(env.DB),
      signRequests: new D1SignatureRequestStore(env.DB),
      signatures: new D1SignatureStore(env.DB),
      audit: new D1AuditStore(env.DB),
      images: new R2SignatureImageStore(env.SIGNATURES),
      attachments: new D1AttachmentStore(env.DB),
      instruments: new D1InstrumentStore(env.DB),
      registry: new D1RegistryStore(env.DB),
      users: new D1UserStore(env.DB),
      sessions: new D1SessionStore(env.DB),
      email,
      signBaseUrl: env.SIGN_BASE_URL,
    });
    return app.fetch(request, env, ctx);
  },
};
