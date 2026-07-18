#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "generated", "poe2db");
const appRoot = path.join(sourceRoot, "app");
const auditRoot = path.join(appRoot, "audit");
const index = read("index.json", sourceRoot);
const appIndex = read("index.json", appRoot);
const appMods = read("mods.json", appRoot).mods;
const appModById = new Map(appMods.map(mod => [mod.modId, mod]));
const requiredBrowserClasses = ["Bow", "Two Hand Sword", "One Hand Axe", "Wand", "Body Armour", "Gloves", "Ring", "Amulet", "Jewel"];

function read(file, directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
}

function firstMatchingWeight(rows, tags, fallback = 0) {
  for (const row of rows ?? []) if (tags.includes(row.tag)) return Number(row.weight ?? 0);
  return fallback;
}

function fail(message) {
  throw new Error(message);
}

const counts = read("class-counts.json", auditRoot).classes;
const missingImport = read("missing-from-import.json", auditRoot).classes;
const missingPools = read("missing-from-pools.json", auditRoot).classes;
const missingUi = read("missing-from-ui.json", auditRoot).classes;
const extras = read("unexpected-extra-mods.json", auditRoot).classes;
const families = read("mod-family-coverage.json", auditRoot).classes;
const summary = read("audit-summary.json", auditRoot);

if (missingImport.length) fail(`Mods fehlen aus dem Import: ${missingImport.map(row => row.itemClass).join(", ")}`);
if (missingPools.length) fail(`Mods fehlen aus Pools: ${missingPools.map(row => row.itemClass).join(", ")}`);
if (missingUi.length) fail(`Mods fehlen aus UI-Daten: ${missingUi.map(row => row.itemClass).join(", ")}`);
if (extras.length) fail(`Unerwartete Extra-Mods: ${extras.map(row => row.itemClass).join(", ")}`);
if (summary.affectedClasses.length) fail(`Audit betrifft noch Klassen: ${summary.affectedClasses.join(", ")}`);

for (const classEntry of index.classes) {
  const document = read(classEntry.dataFile, sourceRoot);
  const allMods = [...document.prefixes, ...document.suffixes];
  const sourceIds = allMods.map(mod => mod.sourceId);
  if (new Set(sourceIds).size !== sourceIds.length) fail(`${classEntry.itemClass}: technische Mod-ID wurde doppelt importiert`);
  if (allMods.some(mod => !mod.sourceId || !mod.id || !mod.tier)) fail(`${classEntry.itemClass}: Mod-ID oder Tier fehlt`);

  const modById = new Map(allMods.map(mod => [mod.id, mod]));
  const bases = new Map(document.bases.map(base => [base.id, base]));
  for (const pool of document.pools) {
    const base = bases.get(pool.baseId);
    if (!base) fail(`${classEntry.itemClass}: Pool-Basis fehlt: ${pool.baseId}`);
    if (pool.evaluatedPrefixRules !== document.prefixes.length || pool.evaluatedSuffixRules !== document.suffixes.length) {
      fail(`${classEntry.itemClass}: nicht alle Modregeln für ${pool.baseId} geprüft`);
    }
    for (const entry of [...pool.prefixes, ...pool.suffixes]) {
      const mod = modById.get(entry.modId);
      if (!mod) fail(`${classEntry.itemClass}: unbekannte Pool-Mod ${entry.modId}`);
      const expectedSpawn = firstMatchingWeight(mod.spawnWeights, base.tags);
      const expectedGeneration = mod.generationWeights.length ? firstMatchingWeight(mod.generationWeights, base.tags) : 1;
      if (entry.spawnWeight !== expectedSpawn || entry.generationWeight !== expectedGeneration) {
        fail(`${classEntry.itemClass}: falsche geordnete Gewichtsauswertung ${pool.baseId}/${mod.sourceId}`);
      }
      if (entry.spawnWeight <= 0 || entry.generationWeight <= 0) fail(`${classEntry.itemClass}: Nullgewichts-Mod im Pool ${mod.sourceId}`);
    }
  }

  const appPools = Object.values(read(appIndex.poolFiles[classEntry.itemClass], appRoot).pools);
  for (const pool of appPools) for (const row of [...pool.p, ...pool.s]) {
    const appMod = appModById.get(row[0]);
    if (!appMod?.displayText) fail(`${classEntry.itemClass}: App-Pool enthält unsichtbare Mod ${row[0]}`);
  }

  const coverage = families.find(row => row.itemClass === classEntry.itemClass);
  for (const [family, ids] of Object.entries(coverage.sourceFamilies)) {
    const imported = new Set(coverage.importedFamilies[family] ?? []);
    const lost = ids.filter(id => !imported.has(id));
    if (lost.length) fail(`${classEntry.itemClass}: Modfamilie ${family} verlor IDs: ${lost.join(",")}`);
  }
}

for (const itemClass of requiredBrowserClasses) {
  if (!appIndex.poolFiles[itemClass]) fail(`Browser-Referenzklasse fehlt: ${itemClass}`);
}

console.log(JSON.stringify({
  classes: counts.length,
  sourceMods: summary.totals.poe2dbMods,
  importedMods: summary.totals.importedMods,
  poolMods: summary.totals.adapterPoolMods,
  uiEligibleMods: summary.totals.visibleEligibleMods,
  browserReferenceClasses: requiredBrowserClasses.length
}));
