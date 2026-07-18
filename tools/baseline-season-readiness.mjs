#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertBaselineAllowed, baselineFromSnapshot, buildReport, buildSnapshot } from "./lib/season-readiness.mjs";

const root = process.cwd();
const appRoot = path.join(root, "generated", "poe2db", "app");
const baselineFile = path.join(appRoot, "baseline", "season-readiness-baseline.json");
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
for (const script of ["validate-poe2db-app.mjs", "audit-poe2db-app.mjs", "validate-poe2db-audit.mjs", "audit-poe2db-affix-groups.mjs", "audit-poe2db-affix-tier-parity.mjs"]) {
  const result = spawnSync(process.execPath, [path.join(root, "tools", script)], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Required validation failed: tools/${script}`);
}
const current = buildSnapshot(root);
const existing = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, "utf8")) : null;
const seasonStatus = existing ? buildReport(existing, current).status : "green";
const coverageReport = read("generated/poe2db/app/audit/audit-summary.json");
const parity = read("generated/poe2db/app/audit/affix-tier-parity.json");
const groupAudit = read("generated/poe2db/app/audit/affix-group-ui.json");
assertBaselineAllowed({ coverage: { visibleEligibleMods: coverageReport.totals.visibleEligibleMods, poe2dbMods: coverageReport.totals.poe2dbMods, missing: coverageReport.missing }, parity, groupAudit, seasonStatus });
const baseline = baselineFromSnapshot(current);
fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
fs.writeFileSync(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ baseline: baseline.id, sourceSnapshot: baseline.sourceSnapshot, replaced: Boolean(existing) }));
