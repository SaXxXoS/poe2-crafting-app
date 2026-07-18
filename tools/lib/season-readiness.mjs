import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const BASELINE_SCHEMA_VERSION = 1;
export const BEHAVIOR_FIELD = /(?:action|target|restrict|rule|weight|domain|generation|modifier|prefix|suffix|rarity|consume|affect|select|remove|add|replace|craft)/i;

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function withoutVolatile(value) {
  if (Array.isArray(value)) return value.map(withoutVolatile);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "generatedAt").map(([key, child]) => [key, withoutVolatile(child)]));
}
export function canonical(value) { return JSON.stringify(stable(withoutVolatile(value))); }
export function hash(value) { return crypto.createHash("sha256").update(canonical(value)).digest("hex"); }
export function sorted(values) { return [...new Set(values.filter(value => value !== null && value !== undefined).map(String))].sort(); }
export function mapBy(rows, key) {
  return Object.fromEntries(rows.map(row => {
    const technicalKey = key(row);
    return [technicalKey === null || technicalKey === undefined || technicalKey === "" ? `anonymous:${hash(row).slice(0, 20)}` : String(technicalKey), stable(row)];
  }).sort(([a], [b]) => a.localeCompare(b)));
}

function read(root, relative) { return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8")); }
function fieldPaths(value, prefix = "") {
  const result = [];
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) result.push(...fieldPaths(item, `${prefix}[]`));
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    result.push(next);
    result.push(...fieldPaths(child, next));
  }
  return result;
}

function compactMod(mod) {
  return stable({
    id: mod.sourceKey || mod.sourceId || mod.modId || mod.id,
    appId: mod.modId || mod.id,
    name: mod.displayText || mod.textDe || mod.textEn || mod.nameEn || null,
    generationType: mod.generationType,
    requiredLevel: Number(mod.requiredLevel ?? mod.itemLevel ?? 0),
    values: mod.technicalStats || mod.values || mod.displayText || mod.textEn || null,
    spawnWeights: mod.spawnWeights || [],
    generationWeights: mod.generationWeights || [],
    stats: (mod.technicalStats || []).map(stat => stat.id).sort(),
    groups: mod.groups || mod.modGroups || (mod.group ? [mod.group] : []),
    domain: mod.domain ?? null,
    itemDomain: mod.itemDomain ?? null,
    flags: mod.flags ?? []
  });
}

export function buildSnapshot(root) {
  const appRoot = path.join(root, "generated", "poe2db", "app");
  const appIndex = read(appRoot, "index.json");
  const basesDoc = read(appRoot, "bases.json");
  const modsDoc = read(appRoot, "mods.json");
  const groupsDoc = read(appRoot, appIndex.affixGroupsFile || "affix-groups.json");
  const crafting = {};
  for (const [key, relative] of Object.entries(appIndex.craftingFiles || {}).sort()) crafting[key] = read(appRoot, relative);

  const mods = modsDoc.mods.map(compactMod);
  const regularTiers = [];
  for (const family of groupsDoc.groups) for (const tier of family.tiers) for (const itemClass of tier.regularClasses || []) {
    regularTiers.push(stable({
      id: `${itemClass}|${tier.sourceKey}`,
      family: family.technicalSignature,
      itemClass,
      modId: tier.sourceKey,
      tier: tier.displayTiers?.[itemClass] ?? null,
      requiredLevel: tier.requiredLevel,
      value: tier.displayText,
      generationType: family.generationType,
      spawnWeights: tier.spawnWeights || [],
      generationWeights: tier.generationWeights || []
    }));
  }
  const essenceRows = crafting.essences?.essences || [];
  const essenceEffects = crafting.essences?.guaranteedModifiers || [];
  const omenRows = crafting.omens?.omens || [];
  const currencyRows = crafting.currencies?.currencies || [];
  const craftedRows = crafting.craftedModifiers?.modifiers || [];
  const desecratedRows = crafting.desecration?.modifiers || [];
  const sourceTypes = groupsDoc.groups.flatMap(group => group.tiers.flatMap(tier => (tier.craftingSources || []).map(source => source.type)));
  const allCraftingDocuments = Object.entries(crafting).flatMap(([key, document]) => fieldPaths(document).map(field => `${key}.${field}`));
  const craftingActions = omenRows.flatMap(row => row.affects || []).concat((crafting.methods?.methods || []).map(row => row.id));

  const content = stable({
    itemClasses: mapBy(appIndex.classes || [], row => row.id),
    bases: mapBy(basesDoc.bases || [], row => row.id),
    affixFamilies: mapBy(groupsDoc.groups.map(group => ({ id: group.technicalSignature, generationType: group.generationType, name: group.displayName })), row => row.id),
    modifiers: mapBy(mods, row => row.id),
    regularTiers: mapBy(regularTiers, row => row.id),
    vocabularies: {
      statIds: sorted(mods.flatMap(mod => mod.stats)),
      modGroups: sorted(mods.flatMap(mod => mod.groups)),
      spawnTags: sorted((basesDoc.bases || []).flatMap(base => base.tags || []).concat(mods.flatMap(mod => mod.spawnWeights.map(rule => rule.tag)))),
      generationTypes: sorted(mods.map(mod => mod.generationType).concat(groupsDoc.groups.map(group => group.generationType))),
      modDomains: sorted(mods.map(mod => mod.domain)),
      itemDomains: sorted(mods.map(mod => mod.itemDomain)),
      modifierFlags: sorted(mods.flatMap(mod => Array.isArray(mod.flags) ? mod.flags : Object.keys(mod.flags || {}))),
      craftingActions: sorted(craftingActions),
      craftingSources: sorted(sourceTypes),
      craftingCategories: sorted(Object.keys(crafting)),
      equipmentFields: sorted(fieldPaths({ bases: basesDoc.bases, mods: modsDoc.mods, groups: groupsDoc.groups })),
      craftingFields: sorted(allCraftingDocuments)
    },
    crafting: {
      essences: mapBy(essenceRows, row => row.id),
      essenceEffects: mapBy(essenceEffects, row => `${row.essenceId}|${row.technicalModId}|${(row.allowedItemClasses || []).join(",")}`),
      omens: mapBy(omenRows, row => row.id),
      currencies: mapBy(currencyRows, row => row.id),
      craftedModifiers: mapBy(craftedRows, row => `${row.sourceItemId}|${row.technicalModId}|${row.itemClass}`),
      desecratedModifiers: mapBy(desecratedRows, row => row.technicalModId),
      methods: mapBy(crafting.methods?.methods || [], row => row.id)
    }
  });
  const manifestFiles = Object.fromEntries(Object.entries(read(appRoot, "manifest.json").files || {}).filter(([file]) => !file.startsWith("audit/")).sort(([a], [b]) => a.localeCompare(b)));
  const sourceSnapshot = hash({ appManifest: manifestFiles, content });
  return { schemaVersion: BASELINE_SCHEMA_VERSION, sourceSnapshot, content };
}

function change(type, id, currentValue, previousValue, severity, reason, component, affectedClasses = []) {
  const value = currentValue ?? previousValue;
  return stable({ type, id, name: value?.name || value?.nameEn || value?.displayText || null, previousValue: previousValue ?? null, currentValue: currentValue ?? null, affectedClasses: sorted(affectedClasses), reason, recommendedComponent: component, severity });
}
function add(changeSets, row) { changeSets[row.severity === "red" ? "breaking" : row.severity === "yellow" ? "engineReview" : "dataOnly"].push(row); }
function diffMap(before, after, handlers) {
  for (const id of Object.keys(after).filter(id => !before[id]).sort()) handlers.added(id, after[id]);
  for (const id of Object.keys(before).filter(id => !after[id]).sort()) handlers.removed(id, before[id]);
  for (const id of Object.keys(after).filter(id => before[id]).sort()) handlers.changed?.(id, before[id], after[id]);
}
function valuesAdded(before = [], after = []) { const old = new Set(before); return after.filter(value => !old.has(value)).sort(); }

export function compareSnapshots(baseline, current) {
  const before = baseline.content;
  const after = current.content;
  const changes = { dataOnly: [], engineReview: [], breaking: [] };
  const summary = {
    newBaseTypes: 0, removedBaseTypes: 0, newItemClasses: 0, removedItemClasses: 0, newAffixFamilies: 0, removedAffixFamilies: 0,
    newModifiers: 0, removedModifiers: 0, newRegularTiers: 0, removedRegularTiers: 0, changedModifierValues: 0,
    changedRequiredLevels: 0, changedSpawnWeights: 0, changedGenerationWeights: 0, newStatIds: 0, newModGroups: 0, newSpawnTags: 0,
    newEssences: 0, removedEssences: 0, newEssenceEffects: 0, newOmens: 0, removedOmens: 0, newCraftedModifiers: 0,
    newDesecratedModifiers: 0, newCraftingCurrencies: 0, newCraftingSources: 0, newCraftingCategories: 0,
    newGenerationTypes: 0, newModDomains: 0, newItemDomains: 0, newModifierFlags: 0, newCraftingActions: 0, newRuleFields: 0
  };
  const dataMap = (key, newType, removedType, newCounter, removedCounter, removedSeverity = "green") => diffMap(before[key], after[key], {
    added: (id, value) => { summary[newCounter]++; add(changes, change(newType, id, value, null, "green", "Known data object added.", "tools/import-poe2db.mjs", value.regularClasses || [])); },
    removed: (id, value) => { summary[removedCounter]++; add(changes, change(removedType, id, null, value, removedSeverity, "Previously compatible data object removed.", "tools/import-poe2db.mjs", value.regularClasses || [])); }
  });
  dataMap("itemClasses", "new-item-class", "removed-item-class", "newItemClasses", "removedItemClasses", "yellow");
  dataMap("bases", "new-base-type", "removed-base-type", "newBaseTypes", "removedBaseTypes");
  dataMap("affixFamilies", "new-affix-family", "removed-affix-family", "newAffixFamilies", "removedAffixFamilies");
  diffMap(before.modifiers, after.modifiers, {
    added: (id, value) => { summary.newModifiers++; add(changes, change("new-modifier", id, value, null, "green", "Regular modifier added with known structure.", "tools/build-poe2db-app-adapter.mjs")); },
    removed: (id, value) => { summary.removedModifiers++; add(changes, change("removed-modifier", id, null, value, "yellow", "A previously supported modifier disappeared.", "tools/build-poe2db-app-adapter.mjs")); },
    changed: (id, oldValue, newValue) => {
      for (const [field, counter, type] of [["values", "changedModifierValues", "changed-modifier-values"], ["requiredLevel", "changedRequiredLevels", "changed-required-level"], ["spawnWeights", "changedSpawnWeights", "changed-spawn-weights"], ["generationWeights", "changedGenerationWeights", "changed-generation-weights"]]) if (canonical(oldValue[field]) !== canonical(newValue[field])) { summary[counter]++; add(changes, change(type, id, newValue[field], oldValue[field], "green", "Known modifier data changed without a schema change.", "tools/build-poe2db-app-adapter.mjs")); }
    }
  });
  diffMap(before.regularTiers, after.regularTiers, {
    added: (id, value) => { summary.newRegularTiers++; add(changes, change("new-regular-tier", id, value, null, "green", "Regular family tier added.", "tools/build-poe2db-affix-groups.mjs", [value.itemClass])); },
    removed: (id, value) => { summary.removedRegularTiers++; add(changes, change("removed-regular-tier", id, null, value, "green", "Regular family tier removed.", "tools/build-poe2db-affix-groups.mjs", [value.itemClass])); }
  });
  for (const [field, counter, type] of [["statIds", "newStatIds", "new-stat-id"], ["modGroups", "newModGroups", "new-mod-group"], ["spawnTags", "newSpawnTags", "new-spawn-tag"]]) for (const id of valuesAdded(before.vocabularies[field], after.vocabularies[field])) { summary[counter]++; add(changes, change(type, id, id, null, "green", "Known data vocabulary expanded.", "tools/import-poe2db.mjs")); }

  const craftingMap = (key, type, counter, removedType = null, removedCounter = null) => diffMap(before.crafting[key], after.crafting[key], {
    added: (id, value) => { summary[counter]++; add(changes, change(type, id, value, null, "yellow", "New crafting object requires explicit engine coverage review.", "src/crafting-engine/actions/")); },
    removed: (id, value) => { if (removedCounter) summary[removedCounter]++; add(changes, change(removedType || `removed-${type}`, id, null, value, "yellow", "Crafting object removed; engine mappings must be reviewed.", "src/crafting-engine/actions/")); },
    changed: (id, oldValue, newValue) => { if (canonical(oldValue) !== canonical(newValue)) add(changes, change(`changed-${type}`, id, newValue, oldValue, "yellow", "Known crafting object changed and requires semantic review.", "src/crafting-engine/actions/")); }
  });
  craftingMap("essences", "new-essence", "newEssences", "removed-essence", "removedEssences");
  craftingMap("essenceEffects", "new-essence-effect", "newEssenceEffects");
  craftingMap("omens", "new-omen", "newOmens", "removed-omen", "removedOmens");
  craftingMap("currencies", "new-crafting-currency", "newCraftingCurrencies");
  craftingMap("craftedModifiers", "new-crafted-modifier", "newCraftedModifiers");
  craftingMap("desecratedModifiers", "new-desecrated-modifier", "newDesecratedModifiers");

  for (const [field, counter, type] of [["craftingSources", "newCraftingSources", "new-crafting-source"], ["craftingCategories", "newCraftingCategories", "new-crafting-category"]]) for (const id of valuesAdded(before.vocabularies[field], after.vocabularies[field])) { summary[counter]++; add(changes, change(type, id, id, null, "yellow", "Crafting vocabulary expanded and requires engine review.", "src/crafting-engine/")); }
  for (const [field, counter, type] of [["generationTypes", "newGenerationTypes", "new-generation-type"], ["modDomains", "newModDomains", "new-mod-domain"], ["itemDomains", "newItemDomains", "new-item-domain"], ["modifierFlags", "newModifierFlags", "new-modifier-flag"], ["craftingActions", "newCraftingActions", "unknown-crafting-action"]]) for (const id of valuesAdded(before.vocabularies[field], after.vocabularies[field])) { summary[counter]++; add(changes, change(type, id, id, null, "red", "Unknown engine vocabulary may change crafting behavior.", "src/crafting-engine/")); }
  for (const field of valuesAdded(before.vocabularies.craftingFields, after.vocabularies.craftingFields)) {
    summary.newRuleFields++;
    const severity = BEHAVIOR_FIELD.test(field) ? "red" : "yellow";
    add(changes, change("new-crafting-field", field, field, null, severity, severity === "red" ? "Unknown behavioral or rule field may require new engine semantics." : "Unknown descriptive crafting field requires review.", "src/crafting-engine/schema/"));
  }
  for (const field of valuesAdded(before.vocabularies.equipmentFields, after.vocabularies.equipmentFields).filter(field => BEHAVIOR_FIELD.test(field))) {
    summary.newRuleFields++;
    add(changes, change("new-equipment-rule-field", field, field, null, "red", "Unknown equipment rule field may affect modifier eligibility.", "src/crafting-engine/schema/"));
  }
  for (const list of Object.values(changes)) list.sort((a, b) => `${a.type}|${a.id}`.localeCompare(`${b.type}|${b.id}`));
  const status = changes.breaking.length ? "red" : changes.engineReview.length ? "yellow" : "green";
  const flags = status === "green" ? { compatible: true, requiresEngineReview: false, blocksRelease: false } : status === "yellow" ? { compatible: false, requiresEngineReview: true, blocksRelease: false } : { compatible: false, requiresEngineReview: true, blocksRelease: true };
  const recommendations = status === "green" ? ["No engine change is required; review and commit the data update."] : status === "yellow" ? ["Review new or removed crafting objects before declaring the season compatible."] : ["Block release until all unknown engine rules and vocabularies are implemented or explicitly accepted."];
  return { status, ...flags, summary: stable(summary), changes, recommendations, audit: { errors: [], warnings: changes.engineReview.map(row => `${row.type}: ${row.id}`) } };
}

export function buildReport(baseline, current, generatedAt = new Date().toISOString()) {
  const result = compareSnapshots(baseline.snapshot, current);
  return stable({ schemaVersion: 1, generatedAt, baseline: { id: baseline.id, generatedAt: baseline.generatedAt, sourceSnapshot: baseline.sourceSnapshot }, current: { sourceSnapshot: current.sourceSnapshot }, ...result });
}

export function baselineFromSnapshot(snapshot, generatedAt = new Date().toISOString()) {
  return stable({ schemaVersion: 1, id: `season-baseline-${snapshot.sourceSnapshot.slice(0, 12)}`, generatedAt, sourceSnapshot: snapshot.sourceSnapshot, snapshot });
}

export function assertBaselineAllowed({ coverage, parity, groupAudit, seasonStatus }) {
  const failures = [];
  if (!coverage || coverage.visibleEligibleMods !== coverage.poe2dbMods || Object.values(coverage.missing || {}).some(Boolean)) failures.push("Coverage audit is incomplete.");
  if (!parity?.passed) failures.push("Tier parity audit failed.");
  if (!groupAudit?.passed) failures.push("Affix group audit failed.");
  if (seasonStatus === "red") failures.push("Season readiness status is RED.");
  if (failures.length) throw new Error(failures.join(" "));
}

export function renderMarkdown(report) {
  const icon = report.status === "green" ? "🟢" : report.status === "yellow" ? "🟡" : "🔴";
  const label = report.status === "green" ? "Kompatibel" : report.status === "yellow" ? "Engine prüfen" : "Release blockiert";
  const lines = ["# Season Readiness Report", "", `Status: ${icon} ${label}`, "", "## Zusammenfassung", ""];
  for (const [key, value] of Object.entries(report.summary)) lines.push(`- ${key}: ${value}`);
  lines.push("", "## Engine-Prüfung erforderlich", "");
  if (!report.changes.engineReview.length && !report.changes.breaking.length) lines.push("Keine engine-relevanten Änderungen erkannt.");
  for (const row of [...report.changes.breaking, ...report.changes.engineReview]) {
    lines.push("", `### ${row.type}`, "", `- Name: ${row.name || "Nicht verfügbar"}`, `- ID: ${row.id}`, `- Empfohlene Komponente: ${row.recommendedComponent}`);
    if (row.type === "new-crafting-currency") lines.push("- Die Wirkung kann aus den strukturierten Daten nicht sicher bestimmt werden.");
  }
  lines.push("", "## Datenänderungen", "");
  if (!report.changes.dataOnly.length) lines.push("Keine reinen Datenänderungen erkannt.");
  for (const row of report.changes.dataOnly) lines.push(`- ${row.type}: ${row.id}`);
  lines.push("", "## Release-Status", "", report.status === "green" ? "Der Release wird durch diesen Audit nicht blockiert." : report.status === "yellow" ? "Der Release wird nicht blockiert, benötigt aber eine manuelle Engine-Prüfung." : "Der Release wird blockiert, bis die unbekannten Engine-Regeln geprüft wurden.", "");
  return lines.join("\n");
}
