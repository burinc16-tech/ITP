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
