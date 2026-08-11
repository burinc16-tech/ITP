import { describe, it, expect } from "vitest";
import type { AttachmentView } from "../data/attachment";
import {
  appendixPhotos,
  paginatePhotos,
  PHOTO_APPENDIX_CAPTION,
  PHOTO_APPENDIX_FIELD,
  photoRows,
} from "./photo-appendix";

const photo = (id: string): AttachmentView => ({
  id,
  field_id: PHOTO_APPENDIX_FIELD,
  caption: "Location:\nDate:\nTime:",
  image_url: `blob:${id}`,
});

const photos = (n: number): AttachmentView[] =>
  Array.from({ length: n }, (_, i) => photo(`p${i + 1}`));

describe("photo-appendix", () => {
  it("reserves a field id outside the template row namespace", () => {
    // Template row ids are authored JSON identifiers; the `#` prefix guarantees
    // an appendix photo can never collide with (or render inside) a section.
    expect(PHOTO_APPENDIX_FIELD.startsWith("#")).toBe(true);
  });

  it("pre-fills captions with the agreed Location/Date/Time lines", () => {
    expect(PHOTO_APPENDIX_CAPTION).toBe("Location:\nDate:\nTime:");
  });

  it("reads only appendix photos from the attachments map", () => {
    const map = new Map<string, AttachmentView[]>([
      ["ph_01", [photo("row-photo")]],
      [PHOTO_APPENDIX_FIELD, photos(2)],
    ]);
    expect(appendixPhotos(map).map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(appendixPhotos(new Map())).toEqual([]);
  });

  it("paginates six photos per page, 3 rows of 2", () => {
    expect(paginatePhotos(photos(0))).toEqual([]);
    expect(paginatePhotos(photos(6))).toHaveLength(1);
    expect(paginatePhotos(photos(7))).toHaveLength(2);
    expect(paginatePhotos(photos(13)).map((p) => p.length)).toEqual([6, 6, 1]);
  });

  it("keeps capture order across page boundaries", () => {
    const pages = paginatePhotos(photos(8));
    expect(pages[0]!.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(pages[1]!.map((p) => p.id)).toEqual(["p7", "p8"]);
  });

  it("chunks a page into rows of two, last row possibly single", () => {
    expect(photoRows(photos(6)).map((r) => r.length)).toEqual([2, 2, 2]);
    expect(photoRows(photos(5)).map((r) => r.length)).toEqual([2, 2, 1]);
    expect(photoRows(photos(1)).map((r) => r.length)).toEqual([1]);
  });
});
