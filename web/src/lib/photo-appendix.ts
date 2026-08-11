import type { AttachmentView } from "../data/attachment";

/**
 * Photo attachment pages (SPEC §12): an opt-in appendix of photo pages printed
 * after any record's normal output — 3 rows × 2 photos per A4 portrait page,
 * replicating the standalone `Photo_Print_3x2.html` sheet the site team already
 * uses. Photos are filled on the record itself (a "Photo Attachment" panel on
 * the form), stored and synced as ordinary attachments under one reserved
 * field id, so they are record evidence like any other photo — they survive a
 * device change and reprint identically anywhere.
 *
 * Available on every template; nothing here reads template-specific markup
 * (Hard Rule #4).
 */

/**
 * Reserved attachment `field_id` for appendix photos. Template row ids come
 * from JSON authored in `/spec/templates`; the `#` prefix keeps this id out of
 * that namespace so it can never collide with (or render inside) a section.
 */
export const PHOTO_APPENDIX_FIELD = "#photo_appendix";

/** Caption each new appendix photo starts with (user-chosen wording, 2026-08-07). */
export const PHOTO_APPENDIX_CAPTION = "Location:\nDate:\nTime:";

/** Photos per printed page: 3 rows × 2 columns. */
export const PHOTOS_PER_PAGE = 6;
export const PHOTOS_PER_ROW = 2;

/** The record's appendix photos, in capture order. */
export function appendixPhotos(
  attachments: Map<string, AttachmentView[]>,
): AttachmentView[] {
  return attachments.get(PHOTO_APPENDIX_FIELD) ?? [];
}

/** Chunk photos into printed pages of six (3 rows × 2). */
export function paginatePhotos(
  photos: AttachmentView[],
  perPage: number = PHOTOS_PER_PAGE,
): AttachmentView[][] {
  const pages: AttachmentView[][] = [];
  for (let i = 0; i < photos.length; i += perPage) {
    pages.push(photos.slice(i, i + perPage));
  }
  return pages;
}

/** Chunk one page's photos into rows of two for the grid. */
export function photoRows(
  page: AttachmentView[],
  perRow: number = PHOTOS_PER_ROW,
): AttachmentView[][] {
  const rows: AttachmentView[][] = [];
  for (let i = 0; i < page.length; i += perRow) {
    rows.push(page.slice(i, i + perRow));
  }
  return rows;
}
