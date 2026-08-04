import { parseTemplate, type Template } from "@schema";
import heatLoadRaw from "../../spec/templates/heat-load-test.json";
import powerTurnOnRaw from "../../spec/templates/power-turn-on.json";
import idfHandoverRaw from "../../spec/templates/idf-handover.json";
import wallClosureRaw from "../../spec/templates/wall-closure.json";

/**
 * The bundled templates, validated once at load — the single source of truth for
 * both the main app and the public sign-off link page. Kept in its own module so
 * the account-less link page can resolve a record's template without importing
 * `app.tsx` (and its Dexie construction).
 */
export const TEMPLATES: Template[] = [
  parseTemplate(heatLoadRaw),
  parseTemplate(powerTurnOnRaw),
  parseTemplate(idfHandoverRaw),
  parseTemplate(wallClosureRaw),
];
