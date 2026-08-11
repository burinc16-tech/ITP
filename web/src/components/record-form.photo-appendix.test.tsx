import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { AttachmentsRepo } from "../data/attachments-repo";
import { AuditRepo } from "../data/audit-repo";
import { ChecklistDb } from "../data/db";
import { createDraft } from "../data/record";
import { RecordsRepo } from "../data/records-repo";
import { RegistryRepo } from "../data/registry-repo";
import { SignaturesRepo } from "../data/signatures-repo";
import { PassthroughSync } from "../data/sync";
import { uuidv7 } from "../data/uuidv7";
import {
  PHOTO_APPENDIX_CAPTION,
  PHOTO_APPENDIX_FIELD,
} from "../lib/photo-appendix";
import { RecordForm } from "./record-form";

const template = parseTemplate(rawTemplate);

async function setup() {
  const db = new ChecklistDb(`test-${uuidv7()}`);
  const repo = new RecordsRepo(db);
  const attachmentsRepo = new AttachmentsRepo(db);
  const id = uuidv7();
  await repo.upsert(
    createDraft(template, { id, now: "2026-08-07T00:00:00.000Z", createdBy: "u" }),
  );
  render(
    <RecordForm
      template={template}
      recordId={id}
      repo={repo}
      signaturesRepo={new SignaturesRepo(db)}
      auditRepo={new AuditRepo(db)}
      registryRepo={new RegistryRepo(db)}
      attachmentsRepo={attachmentsRepo}
      role="site_engineer"
      sync={new PassthroughSync()}
      autosaveMs={5000}
    />,
  );
  return { id, attachmentsRepo };
}

describe("RecordForm — photo attachment pages (SPEC §12)", () => {
  it("stores an appendix photo under the reserved field id with the caption prefill", async () => {
    const user = userEvent.setup();
    const { id, attachmentsRepo } = await setup();

    const input = await screen.findByLabelText("Add attachment photo");
    const file = new File([new Uint8Array([1, 2, 3])], "site.jpg", { type: "image/jpeg" });
    await user.upload(input, file);

    await waitFor(async () => {
      const rows = await attachmentsRepo.listByRecord(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.field_id).toBe(PHOTO_APPENDIX_FIELD);
      expect(rows[0]!.caption).toBe(PHOTO_APPENDIX_CAPTION);
    });
  });

  it("prints the photo pages only when the print-step toggle is on", async () => {
    const user = userEvent.setup();
    await setup();

    const input = await screen.findByLabelText("Add attachment photo");
    await user.upload(
      input,
      new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }),
    );
    await screen.findByAltText("Attachment photo 1");

    // Off by default: photos live on the record, but no appendix pages print.
    expect(document.querySelectorAll(".photo-appendix-page")).toHaveLength(0);

    const toggle = screen.getByRole("checkbox", {
      name: /include photo attachment pages/i,
    });
    await user.click(toggle);
    expect(document.querySelectorAll(".photo-appendix-page")).toHaveLength(1);

    await user.click(toggle);
    expect(document.querySelectorAll(".photo-appendix-page")).toHaveLength(0);
  });

  it("keeps appendix photos out of the record's own printed sections", async () => {
    const user = userEvent.setup();
    await setup();

    const input = await screen.findByLabelText("Add attachment photo");
    await user.upload(
      input,
      new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }),
    );
    await screen.findByAltText("Attachment photo 1");

    // The reserved `#` field id can never match a template row, so the record's
    // print pages carry no photo sub-rows from the appendix.
    expect(document.querySelectorAll(".print-photo-row")).toHaveLength(0);
  });
});
