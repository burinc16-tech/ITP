import { parseTemplate, type Template } from "@schema";
import heatLoadRaw from "../../spec/templates/heat-load-test.json";
import powerTurnOnRaw from "../../spec/templates/power-turn-on.json";
import idfHandoverRaw from "../../spec/templates/idf-handover.json";
import wallClosureRaw from "../../spec/templates/wall-closure.json";
import vavAirBalancingRaw from "../../spec/templates/vav-air-balancing.json";
import chwfcuAirBalancingRaw from "../../spec/templates/chwfcu-air-balancing.json";
import dxfcuAirBalancingRaw from "../../spec/templates/dxfcu-air-balancing.json";
import sanitaryFloodTestRaw from "../../spec/templates/sanitary-pipe-flood-test.json";
import plumbingPressureTestRaw from "../../spec/templates/plumbing-pressure-test.json";
import boltTorqueTestRaw from "../../spec/templates/bolt-torque-test.json";
import ductworkAirLeakageTestRaw from "../../spec/templates/ductwork-air-leakage-test.json";
import chwfcuFunctionTestRaw from "../../spec/templates/chwfcu-function-test.json";
import dxfcuFunctionTestRaw from "../../spec/templates/dxfcu-function-test.json";
import fcuLcpChecklistRaw from "../../spec/templates/fcu-lcp-checklist.json";
import vrvCuFcuTestRaw from "../../spec/templates/vrv-cu-fcu-test.json";
import acmvPipePressureTestRaw from "../../spec/templates/acmv-pipe-pressure-test.json";
import ahuActualSiteComparisonRaw from "../../spec/templates/ahu-actual-site-comparison.json";
import chemicalFlushChecklistRaw from "../../spec/templates/chemical-flush-checklist.json";
import ahuSupplyFreshAirRaw from "../../spec/templates/ahu-supply-fresh-air-measurement.json";

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
  parseTemplate(vavAirBalancingRaw),
  parseTemplate(chwfcuAirBalancingRaw),
  parseTemplate(dxfcuAirBalancingRaw),
  parseTemplate(sanitaryFloodTestRaw),
  parseTemplate(plumbingPressureTestRaw),
  parseTemplate(boltTorqueTestRaw),
  parseTemplate(ductworkAirLeakageTestRaw),
  parseTemplate(chwfcuFunctionTestRaw),
  parseTemplate(dxfcuFunctionTestRaw),
  parseTemplate(fcuLcpChecklistRaw),
  parseTemplate(vrvCuFcuTestRaw),
  parseTemplate(acmvPipePressureTestRaw),
  parseTemplate(ahuActualSiteComparisonRaw),
  parseTemplate(chemicalFlushChecklistRaw),
  parseTemplate(ahuSupplyFreshAirRaw),
];
