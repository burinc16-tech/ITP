import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import type { AttachmentView } from "../data/attachment";
import { emptyValues } from "../lib/values";
import { FormProvider } from "./form-context";
import { PhotoField } from "./photo-field";

const template = parseTemplate(heatLoadRaw);

const onePhoto = (): Map<string, AttachmentView[]> =>
  new Map([["f1", [{ id: "a1", field_id: "f1", caption: "north face", image_url: "blob:x" }]]]);

function renderField(opts: {
  attachments?: Map<string, AttachmentView[]>;
  locked?: boolean;
  onAddPhoto?: (fieldId: string, file: Blob) => void;
  onCaptionPhoto?: (id: string, caption: string) => void;
  onRemovePhoto?: (id: string) => void;
}) {
  render(
    <FormProvider
      template={template}
      values={emptyValues(template)}
      onChange={() => {}}
      attachments={opts.attachments}
      onAddPhoto={opts.onAddPhoto}
      onCaptionPhoto={opts.onCaptionPhoto}
      onRemovePhoto={opts.onRemovePhoto}
      locked={opts.locked}
    >
      <PhotoField fieldId="f1" label="Photos — 1" />
    </FormProvider>,
  );
}

describe("PhotoField", () => {
  it("captures a picked file against its field", async () => {
    const onAddPhoto = vi.fn();
    renderField({ onAddPhoto });
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("Photos — 1"), file);
    expect(onAddPhoto).toHaveBeenCalledOnce();
    expect(onAddPhoto.mock.calls[0]![0]).toBe("f1");
    expect((onAddPhoto.mock.calls[0]![1] as File).name).toBe("photo.jpg");
  });

  it("renders a thumbnail and recaptions and removes it", async () => {
    const onCaptionPhoto = vi.fn();
    const onRemovePhoto = vi.fn();
    renderField({ attachments: onePhoto(), onCaptionPhoto, onRemovePhoto });

    expect(screen.getByRole("img")).toHaveAttribute("src", "blob:x");
    const caption = screen.getByLabelText("Caption — Photos — 1");
    expect(caption).toHaveValue("north face");

    await userEvent.type(caption, "!");
    expect(onCaptionPhoto).toHaveBeenCalledWith("a1", "north face!");

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemovePhoto).toHaveBeenCalledWith("a1");
  });

  it("is read-only when the record is locked", () => {
    renderField({ attachments: onePhoto(), locked: true });
    expect(screen.getByText("north face")).toBeInTheDocument(); // caption shown as text
    expect(screen.queryByLabelText("Caption — Photos — 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByText(/Add photo/)).toBeNull();
  });
});
