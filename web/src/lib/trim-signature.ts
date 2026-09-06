/**
 * Trim the blank margin off a captured signature (SPEC §7 print fidelity).
 *
 * The signature pad exports the WHOLE canvas as a white-backed PNG, and most
 * people sign in a small patch of it. Fitted into the printed pad by aspect
 * ratio, that PNG reproduces the ink small — the box is mostly the pad's empty
 * margin. Cropping to the ink's bounding box first lets the same box show the
 * signature at the size the print CSS asks for (70% of the pad), whatever
 * fraction of the pad the signer used.
 *
 * Applied when a stored signature is turned into a displayable image, never to
 * the stored blob: the captured PNG is evidence and stays byte-identical
 * (Hard Rule #6). Best-effort and non-throwing, like `downscaleImage` — when the
 * runtime can't decode or redraw (no canvas in jsdom, a decode failure), the
 * original blob is returned and the image simply shows untrimmed.
 */

export interface InkBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Bounding box of the ink in RGBA pixel data. A pixel is ink when it is
 * reasonably opaque and darker than near-white, so faint anti-aliasing fringe
 * and the white backing are ignored. Null when the image is blank.
 */
export function inkBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: { minAlpha?: number; maxLuma?: number } = {},
): InkBounds | null {
  const minAlpha = opts.minAlpha ?? 40;
  const maxLuma = opts.maxLuma ?? 200;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const a = data[i + 3]!;
      if (a < minAlpha) continue;
      const luma = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      if (luma > maxLuma) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Crop a white-backed signature PNG to its ink plus a small padding (a fraction
 * of the ink's longer side). Returns the source blob unchanged when it is blank,
 * already tight, or cannot be processed in this runtime.
 */
export async function trimSignature(
  source: Blob,
  opts: { padding?: number } = {},
): Promise<Blob> {
  const padding = opts.padding ?? 0.06;
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
      return source;
    }
    const bitmap = await createImageBitmap(source);
    const { width, height } = bitmap;
    const full = document.createElement("canvas");
    full.width = width;
    full.height = height;
    const fctx = full.getContext("2d");
    if (!fctx) {
      bitmap.close?.();
      return source;
    }
    fctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const bounds = inkBounds(fctx.getImageData(0, 0, width, height).data, width, height);
    if (!bounds) return source;
    // Already filling the pad on both axes — nothing to gain from re-encoding.
    if (bounds.width >= width * 0.9 && bounds.height >= height * 0.9) return source;

    const pad = Math.max(2, Math.round(Math.max(bounds.width, bounds.height) * padding));
    const sx = Math.max(0, bounds.x - pad);
    const sy = Math.max(0, bounds.y - pad);
    const sw = Math.min(width - sx, bounds.width + pad * 2);
    const sh = Math.min(height - sy, bounds.height + pad * 2);
    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    const octx = out.getContext("2d");
    if (!octx) return source;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, sw, sh);
    octx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
    return blob ?? source;
  } catch {
    return source;
  }
}
