import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import { SignoffClient } from "../data/signoff-api";
import { RequestSignature } from "./request-signature";

const heatLoad = parseTemplate(heatLoadRaw);

const R = (status: number, body: unknown = {}): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("RequestSignature", () => {
  it("issues a link for a slot and shows it to copy", async () => {
    const user = userEvent.setup();
    const issued = { id: "req1", token: "tk", url: "http://web/sign/tk", expires_at: "t", emailed: true };
    const f = vi.fn().mockResolvedValue(R(201, issued));
    const client = new SignoffClient("http://api", "secret", f);

    const { container } = render(
      <RequestSignature client={client} recordId="r1" template={heatLoad} />,
    );
    // Expand the disclosure so the form is interactive.
    (container.querySelector("details") as HTMLDetailsElement).open = true;

    await user.type(screen.getByLabelText("Recipient email"), "sam@c.example");
    await user.click(screen.getByRole("button", { name: "Issue signing link" }));

    expect(await screen.findByDisplayValue("http://web/sign/tk")).toBeInTheDocument();
    expect(screen.getByText(/emailed to sam@c.example/i)).toBeInTheDocument();
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.recipient_email).toBe("sam@c.example");
    expect(body.slot_id).toBeTruthy();
    expect(body.role).toBeTruthy();
  });

  it("keeps the issue button disabled until the email is valid", async () => {
    const user = userEvent.setup();
    const client = new SignoffClient("http://api", "secret", vi.fn());
    const { container } = render(
      <RequestSignature client={client} recordId="r1" template={heatLoad} />,
    );
    (container.querySelector("details") as HTMLDetailsElement).open = true;

    const button = screen.getByRole("button", { name: "Issue signing link" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Recipient email"), "not-an-email");
    expect(button).toBeDisabled();
  });
});
