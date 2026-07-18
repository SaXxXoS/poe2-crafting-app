#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { buildReport, buildSnapshot, canonical, renderMarkdown } from "./lib/season-readiness.mjs";

const root = process.cwd();
const appRoot = path.join(root, "generated", "poe2db", "app");
const baselineFile = path.join(appRoot, "baseline", "season-readiness-baseline.json");
const jsonFile = path.join(appRoot, "audit", "season-readiness.json");
const markdownFile = path.join(appRoot, "audit", "season-readiness.md");

if (!fs.existsSync(baselineFile)) throw new Error(`Season baseline missing: ${baselineFile}. Run npm run baseline:season-readiness explicitly.`);
const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
const current = buildSnapshot(root);
const report = buildReport(baseline, current);
if (fs.existsSync(jsonFile)) {
  const previousReport = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  if (canonical(previousReport) === canonical(report)) report.generatedAt = previousReport.generatedAt;
}
fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
fs.writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
fs.writeFileSync(markdownFile, renderMarkdown(report), "utf8");

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${renderMarkdown(report)}\n\nJSON: \`generated/poe2db/app/audit/season-readiness.json\`  \nMarkdown: \`generated/poe2db/app/audit/season-readiness.md\`\n`, "utf8");
  if (report.status === "yellow") console.log("::warning title=Season Readiness::New crafting objects or known mechanic variants require engine review.");
  if (report.status === "red") console.error("::error title=Season Readiness::Unknown engine rules detected; release is blocked.");
}
console.log(JSON.stringify({ status: report.status, compatible: report.compatible, requiresEngineReview: report.requiresEngineReview, blocksRelease: report.blocksRelease, summary: report.summary }));
if (report.status === "red") process.exitCode = 1;
