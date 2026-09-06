import type { RecordStatus } from "../data/record";
import type { SignatureView } from "../data/signature";

/**
 * Whether printed output carries the diagonal `DRAFT` watermark (SPEC §7).
 *
 * A record is a draft on paper until someone puts their name to it: the
 * watermark prints while the record is unsigned and not yet `accepted`, and
 * drops off as soon as any signature slot is filled. A single captured
 * signature is enough — site teams issue a contractor-signed record for
 * inspection long before the consultant accepts it, and that sheet must not go
 * out stamped DRAFT.
 *
 * One rule, one place: every printed surface (record pages, RFI cover, photo
 * appendix) asks this rather than testing status itself.
 */
export function showsDraftWatermark(
  status: RecordStatus,
  signatures?: ReadonlyMap<string, SignatureView>,
): boolean {
  if (status === "accepted") return false;
  return (signatures?.size ?? 0) === 0;
}
