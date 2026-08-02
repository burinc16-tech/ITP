/**
 * Generates the static print output: a single, self-contained A4-landscape HTML
 * file with no interactivity and no inputs. It server-renders the same
 * `PrintView` the app uses (so the static output can never drift from it) against
 * a validated template and a filled-values fixture, then inlines the print CSS
 * and the (already embedded) logo.
 *
 * Run with vite-node so JSX, the `@schema` alias, and the CSS import resolve:
 *   npm run print:build
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { parseTemplate } from "@schema";
import rawTemplate from "../../spec/templates/heat-load-test.json";
import { PrintView } from "../src/components/print-view";
import type { RecordStatus } from "../src/data/record";
import { heatLoadTestFixture } from "../src/print-fixtures/heat-load-test.fixture";

// Rendered as an accepted record so there is no DRAFT watermark over the body —
// the cleanest comparison against the original PDF. Any other status prints the
// watermark (see PrintView / print-view.test).
const STATUS: RecordStatus = "accepted";
const SERIAL = "AMK3-HLT-0007";

const template = parseTemplate(rawTemplate);
const values = heatLoadTestFixture(template);

const body = renderToStaticMarkup(
  <PrintView
    template={template}
    values={values}
    status={STATUS}
    serialNo={SERIAL}
  />,
);

const css = readFileSync(
  fileURLToPath(new URL("../src/print.css", import.meta.url)),
  "utf8",
);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${template.title} — static print (${template.page.orientation})</title>
<style>
${css}
/* Static viewer: the app hides .print-doc until print; here we show it on screen too. */
html, body { margin: 0; }
body { background: #9aa3ad; }
.print-doc { display: block; padding: 8mm; }
.print-page { margin: 0 auto 8mm; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
</style>
</head>
<body>
${body}
</body>
</html>
`;

const outDir = fileURLToPath(new URL("../../dist", import.meta.url));
mkdirSync(outDir, { recursive: true });
const outFile = `${outDir}/heat-load-test.print.html`;
writeFileSync(outFile, html, "utf8");

const kb = (html.length / 1024).toFixed(0);
// eslint-disable-next-line no-console
console.log(
  `Wrote ${outFile}\n  ${kb} KB · ${template.page.orientation} · status=${STATUS} · serial=${SERIAL}`,
);
