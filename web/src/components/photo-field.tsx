import { useRef, type ChangeEvent, type ReactNode } from "react";
import { useForm } from "./form-context";

/**
 * Photo capture for one record field (SPEC §8). Backed by the attachments store
 * via FormContext: picking or shooting a photo hands the blob to `onAddPhoto`,
 * which persists it locally and refreshes the thumbnails here. On a tablet the
 * file input opens the camera (`capture`), and on a laptop the file picker — same
 * control either way. Read-only once the record is locked, like every field.
 */
export function PhotoField(props: { fieldId: string; label: string }): ReactNode {
  const { fieldId, label } = props;
  const { attachments, onAddPhoto, onCaptionPhoto, onRemovePhoto, locked } = useForm();
  const inputRef = useRef<HTMLInputElement>(null);
  const photos = attachments.get(fieldId) ?? [];

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? [])) onAddPhoto(fieldId, file);
    // Clear so re-picking the same file fires change again.
    e.target.value = "";
  };

  return (
    <div className="photo-field">
      {photos.length > 0 && (
        <ul className="photo-list">
          {photos.map((photo) => (
            <li key={photo.id} className="photo-item">
              <img className="photo-thumb" src={photo.image_url} alt={photo.caption || label} />
              {locked ? (
                photo.caption && <span className="photo-caption">{photo.caption}</span>
              ) : (
                <>
                  <input
                    type="text"
                    className="photo-caption-input"
                    placeholder="Caption"
                    aria-label={`Caption — ${label}`}
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
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            aria-label={label}
            onChange={onPick}
          />
        </label>
      )}
      {locked && photos.length === 0 && <span className="photo-empty">No photos</span>}
    </div>
  );
}
