/**
 * Transactional email for remote sign-off (SPEC §6 path B, task 3): delivering
 * the tokenized signing link to the recipient. Kept behind an `EmailSender`
 * interface — same DI pattern as the stores — so the app can run against an
 * in-memory fake in tests / a console logger in local dev, and a real provider
 * (Resend) once the deploy sets an API key.
 *
 * The message body is built by a PURE function so its contents are unit-testable
 * without sending anything.
 */

export interface EmailMessage {
  to: string;
  toName?: string | null;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

const EXPIRY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `dd/mm/yyyy HH:mm` in Asia/Singapore, matching the app's date convention. */
function formatExpiry(iso: string): string {
  return EXPIRY_FORMAT.format(new Date(iso)).replace(", ", " ");
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

export interface SignRequestEmailInput {
  recipientName: string | null;
  role: string;
  url: string;
  /** ISO expiry timestamp. */
  expiresAt: string;
  serialNo?: string | null;
}

/**
 * Build the sign-request email (subject + html + text). Pure: no I/O, no clock —
 * everything comes from the input, so the contents can be asserted directly.
 */
export function buildSignRequestEmail(input: SignRequestEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hello,";
  const ref = input.serialNo ? ` (${input.serialNo})` : "";
  const expiry = formatExpiry(input.expiresAt);
  const subject = `Signature requested — ${input.role}`;

  const text = [
    greeting,
    "",
    `You have been asked to sign a Kenyon Testing & Commissioning document${ref} as ${input.role}.`,
    "",
    "Open the secure link below to review the document and sign or reject it:",
    input.url,
    "",
    `This link is valid until ${expiry} and can be used once.`,
    "",
    "If you did not expect this, you can ignore this email.",
  ].join("\n");

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>You have been asked to sign a Kenyon Testing &amp; Commissioning document${escapeHtml(
      ref,
    )} as <strong>${escapeHtml(input.role)}</strong>.</p>`,
    `<p><a href="${escapeHtml(input.url)}">Review and sign the document</a></p>`,
    `<p style="color:#55606e;font-size:14px">This link is valid until ${escapeHtml(
      expiry,
    )} and can be used once.<br>If you did not expect this, you can ignore this email.</p>`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Real sender using Resend's REST API (https://resend.com). The account, sending
 * domain, and API key are the deploy's to manage; nothing is committed here.
 */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        from: this.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`email send failed (HTTP ${res.status}) ${body}`.trim());
    }
  }
}

/** Test/local fake: records every message instead of sending. */
export class MemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg);
  }
}

/** Local-dev fallback when no provider key is set: logs the link to the console. */
export class ConsoleEmailSender implements EmailSender {
  async send(msg: EmailMessage): Promise<void> {
    console.log(`[email] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
  }
}
