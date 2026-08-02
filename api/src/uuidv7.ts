/**
 * Client-generated UUIDv7 (SPEC §4, Hard Rule #2): a 48-bit big-endian
 * millisecond timestamp followed by 74 random bits, so ids are unique and
 * roughly sortable by creation time. Uses the Web Crypto API, which is global in
 * the Workers runtime and the test runner — no dependency required.
 *
 * SPEC §4 requires every entity `id` to be UUIDv7. Records/signatures/audit
 * entries minted on the device use `web/src/data/uuidv7.ts`; the ids the server
 * mints itself (remote-link SignatureRequest, remote signature, server-side audit
 * rows, sessions) must match, so this is a deliberate copy of that function — the
 * two TS projects are built separately and share no code. Keep them in sync.
 *
 * Note: ordering is guaranteed across milliseconds, not within a single one.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);

  // 48-bit timestamp, big-endian, in bytes 0..5. Extracted with divide/mod to
  // avoid the 32-bit wrap that bitwise ops would cause on a ~41-bit value.
  let t = Math.floor(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = t % 256;
    t = Math.floor(t / 256);
  }

  crypto.getRandomValues(bytes.subarray(6));

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
