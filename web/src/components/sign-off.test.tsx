import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import type { SignatureView } from "../data/signature";
import { emptyValues } from "../lib/values";
import { FormProvider } from "./form-context";
import { SignOff } from "./sign-off";

const template = parseTemplate(rawTemplate);

function renderSignOff(
  signatures: Map<string, SignatureView>,
  onSign = vi.fn(),
) {
  render(
    <FormProvider
      template={template}
      values={emptyValues(template)}
      onChange={() => {}}
      signatures={signatures}
      onSign={onSign}
    >
      <SignOff />
    </FormProvider>,
  );
  return { onSign };
}

describe("SignatureSlot", () => {
  it("shows a Sign button per unsigned slot and passes the slot to onSign", async () => {
    const user = userEvent.setup();
    const { onSign } = renderSignOff(new Map());

    const buttons = screen.getAllByRole("button", { name: "Sign" });
    expect(buttons).toHaveLength(template.footer!.signatures.length);

    await user.click(buttons[0]!);
    expect(onSign).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sig_tested" }),
    );
  });

  it("renders a captured signature with image, name, company, and timestamp", () => {
    const signed: SignatureView = {
      slot_id: "sig_tested",
      role: "Inspection / Tested by",
      name: "A. Engineer",
      company: "Kenyon Pte Ltd",
      method: "on_device",
      signed_at: "2026-08-02T02:00:00.000Z",
      image_url: "blob:signature-1",
    };
    renderSignOff(new Map([["sig_tested", signed]]));

    const image = screen.getByAltText("Inspection / Tested by signature");
    expect(image).toHaveAttribute("src", "blob:signature-1");
    expect(screen.getByText("A. Engineer")).toBeInTheDocument();
    expect(screen.getByText("Kenyon Pte Ltd")).toBeInTheDocument();
    expect(screen.getByText("02/08/2026 10:00")).toBeInTheDocument();

    // The signed slot offers no Sign button; only the other slot still does.
    expect(screen.getAllByRole("button", { name: "Sign" })).toHaveLength(
      template.footer!.signatures.length - 1,
    );
  });
});
