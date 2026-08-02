import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import { createDraft } from "../data/record";
import { SignLinkPage } from "./sign-link-page";

const heatLoad = parseTemplate(heatLoadRaw);

const record = {
  ...createDraft(heatLoad, { id: "r1", now: "2026-08-02T00:00:00.000Z", createdBy: "u" }),
  status: "completed" as const,
};
const view = {
  record,
  slot: { slot_id: "sig_witness", role: "Witness" },
  recipient: { name: "Sam", email: "sam@c.example" },
  expires_at: "2026-08-09T00:00:00.000Z",
  status: "opened",
};

const R = (status: number, body: unknown = {}): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("SignLinkPage", () => {
  it("renders the record and a signing panel with the recipient prefilled", async () => {
    const f = vi.fn().mockResolvedValue(R(200, view));
    render(<SignLinkPage token="tok" baseUrl="http://api" templates={[heatLoad]} fetchImpl={f} />);

    expect(await screen.findByText(/Signature requested/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Sign as Witness/ })).toBeInTheDocument();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Sam");
    // The read-only document is rendered (heat-load section title).
    expect(f).toHaveBeenCalledWith("http://api/api/sign/tok");
  });

  it("rejects with a reason and confirms", async () => {
    const user = userEvent.setup();
    const f = vi
      .fn()
      .mockResolvedValueOnce(R(200, view)) // GET open
      .mockResolvedValueOnce(R(200, { ok: true })); // POST reject
    render(<SignLinkPage token="tok" baseUrl="http://api" templates={[heatLoad]} fetchImpl={f} />);

    await screen.findByText(/Signature requested/);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.type(screen.getByLabelText("Reason for rejection"), "Wrong panel");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

    expect(await screen.findByText(/Rejection recorded/)).toBeInTheDocument();
    expect(f).toHaveBeenLastCalledWith(
      "http://api/api/sign/tok/reject",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows a clear message for an expired link", async () => {
    const f = vi.fn().mockResolvedValue(R(410, { error: "expired" }));
    render(<SignLinkPage token="tok" baseUrl="http://api" templates={[heatLoad]} fetchImpl={f} />);
    expect(await screen.findByText(/has expired/)).toBeInTheDocument();
  });
});
