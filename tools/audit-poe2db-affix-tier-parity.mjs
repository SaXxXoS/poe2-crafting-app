#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "generated", "poe2db");
const appRoot = path.join(sourceRoot, "app");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const index = read(path.join(sourceRoot, "index.json"));
const appGroups = read(path.join(appRoot, "affix-groups.json")).groups;
const repoeMods = read(path.join(root, "generated", "repoe", "raw", "mods.min.json"));

function signature(mod) {
  const technical = repoeMods[mod.sourceId] ?? {};
  const groups = [...new Set([...(technical.groups ?? []), ...(mod.family ?? [])])].sort();
  const stats = (technical.stats ?? []).map(stat => stat.id).sort();
  const weights = rules => (rules ?? []).map(rule => `${rule.tag}:${rule.weight}`).join(">");
  return [mod.generationType, groups.join("+"), stats.join("+"), weights(mod.spawnWeights), weights(mod.generationWeights)].join("|");
}

const appBySource = new Map(appGroups.flatMap(group => group.tiers.map(tier => [tier.sourceKey, { group, tier }])));
const findings = {
  missingPoe2dbModIds: [], additionalAppModIds: [], wrongTierNumbers: [], tierGaps: [], duplicateTiers: [],
  differingValues: [], differingItemLevels: [], differingWeights: []
};
const legacyTechnicalTierMismatches = [];
const classes = [];
const importedSourceIds = new Set();

for (const classEntry of index.classes) {
  const document = read(path.join(sourceRoot, classEntry.dataFile));
  const mods = [...document.prefixes, ...document.suffixes];
  const families = new Map();
  for (const mod of mods) {
    importedSourceIds.add(mod.sourceId);
    const key = signature(mod);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(mod);
  }
  const familyRows = [];
  for (const [technicalSignature, familyMods] of families) {
    const ordered = familyMods.slice().sort((a, b) => b.itemLevel - a.itemLevel || Number(a.tier ?? 999) - Number(b.tier ?? 999) || a.sourceId.localeCompare(b.sourceId));
    const visibleTiers = [];
    ordered.forEach((mod, index) => {
      const expectedTier = index + 1;
      const app = appBySource.get(mod.sourceId);
      if (!app || !app.tier.regularClasses.includes(classEntry.itemClass)) {
        findings.missingPoe2dbModIds.push({ itemClass: classEntry.itemClass, family: technicalSignature, modId: mod.sourceId });
        return;
      }
      const displayedTier = app.tier.displayTiers?.[classEntry.itemClass] ?? null;
      visibleTiers.push(displayedTier);
      if (displayedTier !== expectedTier) findings.wrongTierNumbers.push({ itemClass: classEntry.itemClass, family: technicalSignature, modId: mod.sourceId, expectedTier, displayedTier });
      if (app.tier.technicalTier !== expectedTier) legacyTechnicalTierMismatches.push({ itemClass: classEntry.itemClass, family: technicalSignature, modId: mod.sourceId, technicalTier: app.tier.technicalTier, correctedTier: expectedTier });
      const expectedText = mod.textDe || mod.textEn;
      if (app.tier.displayText !== expectedText) findings.differingValues.push({ itemClass: classEntry.itemClass, modId: mod.sourceId, source: expectedText, app: app.tier.displayText });
      if (Number(app.tier.requiredLevel) !== Number(mod.itemLevel)) findings.differingItemLevels.push({ itemClass: classEntry.itemClass, modId: mod.sourceId, source: mod.itemLevel, app: app.tier.requiredLevel });
      if (JSON.stringify(app.tier.spawnWeights ?? []) !== JSON.stringify(mod.spawnWeights ?? []) || JSON.stringify(app.tier.generationWeights ?? []) !== JSON.stringify(mod.generationWeights ?? [])) findings.differingWeights.push({ itemClass: classEntry.itemClass, modId: mod.sourceId });
      if (app.group.generationType !== mod.generationType) findings.differingValues.push({ itemClass: classEntry.itemClass, modId: mod.sourceId, field: "generationType", source: mod.generationType, app: app.group.generationType });
    });
    const duplicates = visibleTiers.filter((tier, index) => tier !== null && visibleTiers.indexOf(tier) !== index);
    if (duplicates.length) findings.duplicateTiers.push({ itemClass: classEntry.itemClass, family: technicalSignature, tiers: [...new Set(duplicates)] });
    const expectedSequence = Array.from({ length: ordered.length }, (_, index) => index + 1);
    if (JSON.stringify(visibleTiers.slice().sort((a, b) => a - b)) !== JSON.stringify(expectedSequence)) findings.tierGaps.push({ itemClass: classEntry.itemClass, family: technicalSignature, expected: expectedSequence, actual: visibleTiers });
    familyRows.push({ technicalSignature, generationType: ordered[0]?.generationType, regularTiers: ordered.length, modIds: ordered.map(mod => mod.sourceId), displayedTiers: visibleTiers });
  }
  classes.push({ itemClass: classEntry.itemClass, poe2dbFamilies: families.size, importedFamilies: families.size, appFamilies: familyRows.length, families: familyRows });
}

for (const group of appGroups) for (const tier of group.tiers) {
  if (tier.regularClasses.length && !importedSourceIds.has(tier.sourceKey)) findings.additionalAppModIds.push({ modId: tier.sourceKey, classes: tier.regularClasses });
}
const affectedClasses = [...new Set(Object.values(findings).flatMap(rows => rows.map(row => row.itemClass).filter(Boolean)))].sort();
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  comparisonBasis: "Structured PoE2DB import rows, imported equipment documents, and generated app affix families",
  tierRule: "Regular tiers are ranked per item class and technical family by required item level descending; special crafting tiers do not participate.",
  totals: {
    classes: classes.length,
    poe2dbFamilies: classes.reduce((sum, row) => sum + row.poe2dbFamilies, 0),
    importedFamilies: classes.reduce((sum, row) => sum + row.importedFamilies, 0),
    appFamilies: classes.reduce((sum, row) => sum + row.appFamilies, 0),
    regularClassModAssignments: classes.reduce((sum, row) => sum + row.families.reduce((inner, family) => inner + family.regularTiers, 0), 0),
    correctedTierNumbers: legacyTechnicalTierMismatches.length,
    correctedUniqueModIds: new Set(legacyTechnicalTierMismatches.map(row => row.modId)).size
  },
  findings,
  legacyTechnicalTierMismatches,
  affectedClasses,
  classes,
  passed: Object.values(findings).every(rows => rows.length === 0)
};
const target = path.join(appRoot, "audit", "affix-tier-parity.json");
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ passed: report.passed, totals: report.totals, findingCounts: Object.fromEntries(Object.entries(findings).map(([key, rows]) => [key, rows.length])), affectedClasses }));
if (!report.passed) process.exitCode = 1;
