/**
 * Save text to the user's device as a file download. A blob URL and a synthetic
 * anchor click — the same thing the source HTML forms do, and the only route
 * that works offline (the app must not need the server to hand a file back).
 */
export function downloadText(
  filename: string,
  text: string,
  type = "application/json",
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked late: Safari reads the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Read a file the engineer picked, as text. `FileReader` rather than
 * `Blob.text()`: the tool runs on site tablets, and iPadOS Safari before 14 has
 * no `Blob.text` — the failure there would be an unreadable "text is not a
 * function" on the one screen that restores lost data.
 */
export function readTextFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(new Error("That file could not be read from this device."));
    reader.readAsText(file);
  });
}
