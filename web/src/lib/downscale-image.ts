/**
 * Downscale a captured photo before it is stored and uploaded (SPEC §8). A phone
 * photo is several megabytes; on a plant-room checklist with dozens of photos that
 * bloats IndexedDB and every R2 upload. We cap the longest edge and re-encode as
 * JPEG, which is plenty for inspection evidence.
 *
 * Best-effort and non-throwing: if the runtime can't decode/redraw the image
 * (no `createImageBitmap`, no canvas, a decode failure), the original blob is
 * returned unchanged — capture must never fail because downscaling couldn't run.
 * `createImageBitmap(..., { imageOrientation: "from-image" })` bakes in EXIF
 * orientation so a portrait photo isn't stored sideways.
 */
export async function downscaleImage(
  source: Blob,
  opts: { maxDim?: number; quality?: number } = {},
): Promise<Blob> {
  const maxDim = opts.maxDim ?? 1600;
  const quality = opts.quality ?? 0.82;
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
      return source;
    }
    const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close?.();
      return source; // already within bounds — don't re-encode
    }
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return source;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    return out ?? source;
  } catch {
    return source;
  }
}
