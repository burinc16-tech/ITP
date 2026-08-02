/**
 * Crypto helpers for remote sign-off (SPEC §6 path B). Uses the Web Crypto API,
 * which is global in the Workers runtime and in the test runner (Node/jsdom), so
 * no runtime-specific import is needed.
 */

const HEX = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * A single-use link token: 32 crypto-random bytes as hex. This raw value is only
 * ever returned at issue time and carried in the link URL — the server stores the
 * sha-256 hash, never the token itself (§6).
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return HEX(bytes);
}

/** sha-256 of the raw token as lowercase hex. This is what we persist and match. */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return HEX(new Uint8Array(digest));
}

/**
 * A deterministic UUID (version 8) derived from `seed` via SHA-256. Same seed →
 * same id, so a server write that a concurrent or retried request would otherwise
 * repeat can be made idempotent by keying its id on the logical event it records
 * (SPEC §9/§12) — insert-once then drops the duplicate. Version 8 marks it as a
 * deliberately non-time-ordered, derived id, distinct from the UUIDv7s minted for
 * new entities.
 */
export async function deterministicId(seed: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  const b = new Uint8Array(digest).slice(0, 16);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x80; // version 8 (custom / deterministic)
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variant 10xx
  const hex = HEX(b);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Decode a signature image posted by a remote signer. Accepts either a
 * `data:<mime>;base64,...` URL (what a canvas `toDataURL()` produces) or bare
 * base64. Returns the raw bytes and the content type (default image/png).
 * Throws on empty/undecodable input so the caller can 400.
 */
export function decodeImage(input: string): { bytes: Uint8Array; contentType: string } {
  if (!input || typeof input !== "string") throw new Error("empty image");
  let contentType = "image/png";
  let b64 = input;
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(input);
  if (match) {
    if (match[1]) contentType = match[1];
    if (!match[2]) throw new Error("image must be base64");
    b64 = match[3] ?? "";
  }
  b64 = b64.trim();
  if (!b64) throw new Error("empty image");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}
