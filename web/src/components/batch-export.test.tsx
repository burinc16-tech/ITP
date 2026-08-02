import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTemplate } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import powerTurnOnRaw from "../../../spec/templates/power-turn-on.json";
import { ChecklistDb } from "../data/db";
import { createDraft } from "../data/record";
import { RecordsRepo } from "../data/records-repo";
import { SignaturesRepo } from "../data/signatures-repo";
import { uuidv7 } from "../data/uuidv7";
import { BatchExport } from "./batch-export";

const heatLoad = parseTemplate(heatLoadRaw);
const powerTurnOn = parseTemplate(powerTurnOnRaw);

function store() {
  const db = new ChecklistDb(`test-${uuidv7()}`);
  return { repo: new RecordsRepo(db), signaturesRepo: new SignaturesRepo(db) };
}

describe("BatchExport", () => {
  it("renders a print view for each selected record of one orientation", async () => {
    const { repo, signaturesRepo } = store();
    const a = createDraft(heatLoad, { id: uuidv7(), now: "2026-08-02T00:00:00.000Z", createdBy: "u" });
    const b = createDraft(heatLoad, { id: uuidv7(), now: "2026-08-02T00:00:00.000Z", createdBy: "u" });
    a.values.header.doc_no = "ITR-A";
    b.values.header.doc_no = "ITR-B";
    await repo.upsert(a);
    await repo.upsert(b);

    render(
      <BatchExport
        repo={repo}
        signaturesRepo={signaturesRepo}
        templates={[heatLoad]}
        ids={[a.id, b.id]}
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByText(/2 records/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print/ })).toBeEnabled();
    expect(screen.getByText("ITR-A")).toBeInTheDocument();
    expect(screen.getByText("ITR-B")).toBeInTheDocument();
  });

  it("blocks a selection that mixes orientations", async () => {
    const { repo, signaturesRepo } = store();
    const land = createDraft(heatLoad, { id: uuidv7(), now: "2026-08-02T00:00:00.000Z", createdBy: "u" });
    const port = createDraft(powerTurnOn, { id: uuidv7(), now: "2026-08-02T00:00:00.000Z", createdBy: "u" });
    await repo.upsert(land);
    await repo.upsert(port);

    render(
      <BatchExport
        repo={repo}
        signaturesRepo={signaturesRepo}
        templates={[heatLoad, powerTurnOn]}
        ids={[land.id, port.id]}
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByText(/mixes landscape and portrait/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print/ })).toBeDisabled();
  });
});
