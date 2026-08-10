import type { ChangeEvent, ReactNode } from "react";
import type { AttachmentView } from "../data/attachment";
import {
  PHOTO_APPENDIX_CAPTION,
  PHOTO_APPENDIX_FIELD,
} from "../lib/photo-appendix";

/**
 * On-screen "Photo Attachment" panel (SPEC §12), shown beneath the form on
 * every record. Photos added here are stored and synced like any other record
 * attachment — under the reserved appendix field id — and print as the opt-in
 * 3×2 photo pages when the print-step toggle is on. Captions are multi-line
 * (pre-filled Location/Date/Time) and editable per photo until the record
 * locks, matching the rest of the form.
 */
export function PhotoAppendixPanel(props: {
  photos: AttachmentView[];
  onAddPhoto: (fieldId: string, file: Blob, caption?: string) => void;
  onCaptionPhoto: (id: string, caption: string) => void;
  onRemovePhoto: (id: string) => void;
  locked: boolean;
}): ReactNode {
  const { photos, onAddPhoto, onCaptionPhoto, onRemovePhoto, locked } = props;

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? [])) {
      onAddPhoto(PHOTO_APPENDIX_FIELD, file, PHOTO_APPENDIX_CAPTION);
    }
    // Clear so re-picking the same file fires change again.
    e.target.value = "";
  };

  return (
    <section className="appendix-panel" aria-label="Photo attachment">
      <h2 className="appendix-panel-title">Photo Attachment</h2>
      <p className="appendix-panel-hint">
        Photos here print as separate photo pages (2 per row) when “Include
        photo attachment pages” is ticked at the print step. They save with the
        record like any other photo.
      </p>

      {photos.length > 0 && (
        <ul className="photo-list appendix-photo-list">
          {photos.map((photo, i) => (
            <li key={photo.id} className="photo-item appendix-photo-item">
              <img
                className="photo-thumb"
                src={photo.image_url}
                alt={`Attachment photo ${i + 1}`}
              />
              {locked ? (
                photo.caption && (
                  <span className="photo-caption appendix-caption-text">
                    {photo.caption}
                  </span>
                )
              ) : (
                <>
                  <textarea
                    className="appendix-caption-input"
                    rows={3}
                    aria-label={`Caption — attachment photo ${i + 1}`}
                    value={photo.caption}
                    onChange={(e) => onCaptionPhoto(photo.id, e.target.value)}
                  />
                  <button
                    type="button"
                    className="ghost-button photo-remove"
                    onClick={() => onRemovePhoto(photo.id)}
                  >
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <label className="photo-add">
          <span className="photo-add-label">
            {photos.length > 0 ? "Add another photo" : "Add photo"}
          </span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            aria-label="Add attachment photo"
            onChange={onPick}
          />
        </label>
      )}
      {locked && photos.length === 0 && (
        <span className="photo-empty">No attachment photos</span>
      )}
    </section>
  );
}
