/**
 * A captured on-device signature (SPEC §4 `Signature`, §6 path A). This is the
 * filled-in evidence — distinct from the template's signature *slot* definition
 * (`Signature` in @schema, which only declares role/company/required).
 *
 * Named `CapturedSignature` to avoid colliding with that schema type. Once
 * written, a signature is never mutated or deleted (Hard Rule #6); the repo is
 * append-only, so nothing here provides an update path.
 */
export type SignatureMethod = "on_device" | "remote_link";

export interface CapturedSignature {
  /** UUIDv7, generated on the client. */
  id: string;
  /** The record this signature belongs to. */
  record_id: string;
  /** The template signature slot id it fills (e.g. "sig_contractor"). */
  slot_id: string;
  /** Role as printed, snapshotted from the slot at signing time. */
  role: string;
  /** Signer's typed name. */
  name: string;
  /** Signer's company. */
  company: string;
  /** PNG image of the signature, white-backed (see SignatureCapture). */
  image: Blob;
  method: SignatureMethod;
  /** Account that handed over the device (STUB_USER until real auth). */
  signed_by_user: string | null;
  /** Stable device identifier (§6 path A evidence). */
  device_id: string;
  /** UTC ISO string (CLAUDE.md convention). */
  signed_at: string;
}

/**
 * A signature prepared for rendering: metadata plus a displayable image URL
 * (an object URL created from the stored blob by the owner, which also revokes
 * it). Screen and print slots consume this, never the raw blob.
 */
export interface SignatureView {
  slot_id: string;
  role: string;
  name: string;
  company: string;
  method: SignatureMethod;
  signed_at: string;
  image_url: string;
}

const SIGNED_AT_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Signing timestamp for display: `dd/mm/yyyy HH:mm` in Asia/Singapore, matching
 * the date convention used across the app (CLAUDE.md).
 */
export function formatSignedAt(iso: string): string {
  return SIGNED_AT_FORMAT.format(new Date(iso)).replace(", ", " ");
}

/** Build a captured signature. Pure — id, time, and device id are passed in. */
export function createSignature(opts: {
  id: string;
  recordId: string;
  slotId: string;
  role: string;
  name: string;
  company: string;
  image: Blob;
  signedByUser: string | null;
  deviceId: string;
  now: string;
}): CapturedSignature {
  return {
    id: opts.id,
    record_id: opts.recordId,
    slot_id: opts.slotId,
    role: opts.role,
    name: opts.name,
    company: opts.company,
    image: opts.image,
    method: "on_device",
    signed_by_user: opts.signedByUser,
    device_id: opts.deviceId,
    signed_at: opts.now,
  };
}
