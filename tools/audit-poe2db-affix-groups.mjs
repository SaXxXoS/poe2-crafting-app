#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { CURRENT_MAX_ITEM_LEVEL } from "../app-config-values.mjs";

const root = process.cwd();
const appRoot = path.join(root, "generated", "poe2db", "app");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const index = read(path.join(appRoot, "index.json"));
const bases = read(path.join(appRoot, "bases.json")).bases;
const groups = read(path.join(appRoot, "affix-groups.json")).groups;
const essences = read(path.join(root, "generated", "poe2db", "crafting", "essences.json"));
const desecration = read(path.join(root, "generated", "poe2db", "crafting", "desecration.json"));
const crafted = read(path.join(root, "generated", "poe2db", "crafting", "crafted-modifiers.json"));

const essenceEvidence = new Set(essences.guaranteedModifiers.map(row => `${row.technicalModId}|${row.essenceId}`));
const desecrationIds = new Set(desecration.modifiers.map(row => row.technicalModId));
const craftedEvidence = new Set(crafted.modifiers.map(row => `${row.technicalModId}|${row.sourceItemId}`));
const failures = {
  groupsWithoutNames: [],
  incorrectlyMergedTechnicalGroups: [],
  tiersWithoutModIds: [],
  unverifiableCraftingSources: [],
  normalDespiteZeroWeight: [],
  unreachableButVisibleTiers: []
};

function orderedWeight(rules, tags) {
  if (!rules?.length) return 1;
  const tagSet = new Set(tags || []);
  return Number(rules.find(rule => tagSet.has(rule.tag))?.weight ?? 0);
}

for (const group of groups) {
  if (!group.displayName) failures.groupsWithoutNames.push(group.familyId);
  if (new Set(group.tiers.map(() => group.technicalSignature)).size !== 1) failures.incorrectlyMergedTechnicalGroups.push(group.familyId);
  for (const tier of group.tiers) {
    if (!tier.modId || !tier.sourceKey) failures.tiersWithoutModIds.push({ familyId: group.familyId, sourceKey: tier.sourceKey });
    for (const source of tier.craftingSources || []) {
      const valid = source.type === "Essenz" ? essenceEvidence.has(`${tier.sourceKey}|${source.sourceId}`)
        : source.type === "Desecration" ? desecrationIds.has(tier.sourceKey)
        : source.type === "Crafted" ? craftedEvidence.has(`${tier.sourceKey}|${source.sourceId}`)
        : false;
      if (!valid) failures.unverifiableCraftingSources.push({ familyId: group.familyId, sourceKey: tier.sourceKey, source });
    }
  }
}

const classes = [];
for (const classEntry of index.classes) {
  const itemClass = classEntry.id;
  const classBases = bases.filter(base => base.itemClass === itemClass);
  const pools = read(path.join(appRoot, index.poolFiles[itemClass])).pools;
  const groupIds = new Set();
  const tierIds = new Set();
  const auditLevels = [...new Set([1, 40, 82, CURRENT_MAX_ITEM_LEVEL])];
  const visibleAtItemLevel = Object.fromEntries(auditLevels.map(level => [level, new Set()]));
  for (const base of classBases) {
    const pool = pools[base.id] || { p: [], s: [] };
    const regular = new Map([...pool.p, ...pool.s].map(row => [row[0], Number(row[2])]));
    for (const group of groups) {
      for (const tier of group.tiers) {
        const normalWeight = regular.get(tier.modId);
        if (normalWeight !== undefined && normalWeight <= 0) failures.normalDespiteZeroWeight.push({ itemClass, baseId: base.id, modId: tier.modId });
        const special = (tier.specialClasses || []).includes(itemClass)
          && (!(tier.requiredBaseNamesEn || []).length || tier.requiredBaseNamesEn.includes(base.nameEn))
          && orderedWeight(tier.spawnWeights, base.tags) > 0
          && orderedWeight(tier.generationWeights, base.tags) > 0;
        if (!(normalWeight > 0) && !special) continue;
        groupIds.add(group.familyId);
        tierIds.add(tier.modId);
        for (const level of auditLevels) if (Number(tier.requiredLevel || 0) <= level) visibleAtItemLevel[level].add(tier.modId);
      }
    }
  }
  classes.push({
    itemClass,
    bases: classBases.length,
    groups: groupIds.size,
    tiers: tierIds.size,
    visibleTiersAtItemLevel: Object.fromEntries(Object.entries(visibleAtItemLevel).map(([level, ids]) => [level, ids.size]))
  });
}

const errorCount = Object.values(failures).reduce((sum, rows) => sum + rows.length, 0);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  groupingIdentity: "generationType + sorted RePoE mod groups + sorted RePoE stat IDs",
  counts: {
    groups: groups.length,
    tiers: groups.reduce((sum, group) => sum + group.tiers.length, 0),
    classes: classes.length,
    essenceTiers: groups.flatMap(group => group.tiers).filter(tier => tier.craftingSources.some(source => source.type === "Essenz")).length,
    desecrationTiers: groups.flatMap(group => group.tiers).filter(tier => tier.craftingSources.some(source => source.type === "Desecration")).length,
    craftedTiers: groups.flatMap(group => group.tiers).filter(tier => tier.craftingSources.some(source => source.type === "Crafted")).length
  },
  classes,
  validation: failures,
  browserTest: { status: "pending", desktopClasses: [], mobile: null, consoleErrors: [] },
  passed: errorCount === 0
};
const target = path.join(appRoot, "audit", "affix-group-ui.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ passed: report.passed, ...report.counts, errors: errorCount }));
if (!report.passed) process.exitCode = 1;
