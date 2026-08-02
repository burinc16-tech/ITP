import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthClient } from "../data/auth";
import { Login } from "./login";

const R = (status: number, body: unknown = {}): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("Login", () => {
  it("signs in and hands the session up", async () => {
    const user = userEvent.setup();
    const session = {
      token: "abc",
      expires_at: "t",
      user: { id: "u1", email: "jo@site.co", name: "Jo", role: "qa_qc" },
    };
    const client = new AuthClient("http://api", vi.fn().mockResolvedValue(R(200, session)));
    const onLogin = vi.fn();
    render(<Login client={client} onLogin={onLogin} />);

    await user.type(screen.getByLabelText("Email"), "jo@site.co");
    await user.type(screen.getByLabelText("Password"), "s3cret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onLogin).toHaveBeenCalledWith(session);
  });

  it("shows an error on bad credentials and does not sign in", async () => {
    const user = userEvent.setup();
    const client = new AuthClient("http://api", vi.fn().mockResolvedValue(R(401)));
    const onLogin = vi.fn();
    render(<Login client={client} onLogin={onLogin} />);

    await user.type(screen.getByLabelText("Email"), "jo@site.co");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Incorrect email or password/);
    expect(onLogin).not.toHaveBeenCalled();
  });
});
