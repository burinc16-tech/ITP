/**
 * A photo (or file) captured against one record field (SPEC §4 `Attachment`, §8).
 * Local-first, exactly like a signature: the bytes live as a Blob in IndexedDB
 * and the record references the attachment by id, never a URL. The server `url`
 * and `uploaded_at` arrive only when the upload machinery (R2) is built — a later
 * task — so they aren't modelled here yet.
 *
 * Unlike a signature an attachment is NOT append-only: while the record is a
 * draft an engineer can recaption or delete a photo. Once the record is locked
 * (§6, Hard Rule #6) the form makes it read-only, the same way it freezes fields.
 */
export type AttachmentKind = "photo";

export interface Attachment {
  /** UUIDv7, generated on the client (Hard Rule #2). */
  id: string;
  record_id: string;
  /** The field/row this photo evidences (e.g. a photo row id, or `${row}:photo`). */
  field_id: string;
  kind: AttachmentKind;
  /** The captured image bytes. */
  image: Blob;
  /** Image MIME type, e.g. `image/jpeg`. */
  mime: string;
  caption: string;
  /** Capturing device (§6 path A evidence parity with signatures). */
  device_id: string;
  /** UTC ISO string (CLAUDE.md convention). */
  created_at: string;
}

/**
 * An attachment prepared for rendering: metadata plus a displayable object URL
 * created from the stored blob by the owner (which also revokes it). Screen and
 * print consume this, never the raw blob.
 */
export interface AttachmentView {
  id: string;
  field_id: string;
  caption: string;
  image_url: string;
}

/** Build a photo attachment. Pure — id, time, and device id are passed in. */
export function createAttachment(opts: {
  id: string;
  recordId: string;
  fieldId: string;
  image: Blob;
  mime?: string;
  caption?: string;
  deviceId: string;
  now: string;
}): Attachment {
  return {
    id: opts.id,
    record_id: opts.recordId,
    field_id: opts.fieldId,
    kind: "photo",
    image: opts.image,
    mime: opts.mime ?? opts.image.type ?? "image/jpeg",
    caption: opts.caption ?? "",
    device_id: opts.deviceId,
    created_at: opts.now,
  };
}
