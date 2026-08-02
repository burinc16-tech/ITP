/**
 * Convert a `data:` URL (as produced by canvas.toDataURL) into a Blob for
 * storage. Signature images are kept as blobs in IndexedDB (SPEC §8, the same
 * shape as photos) rather than as base64 on the record row, so the frequently
 * autosaved record stays small and the future R2 upload has a blob to send.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1) {
    throw new Error("not a data URL");
  }
  const header = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  const isBase64 = /;base64$/i.test(header);
  const mime = header.replace(/;base64$/i, "") || "application/octet-stream";

  const binary = isBase64 ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
