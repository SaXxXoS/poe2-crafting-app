#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const sourceRoot = path.join(root, "generated", "poe2db");
const appRoot = path.join(sourceRoot, "app");
const index = read(path.join(sourceRoot, "index.json"));
const repoeMods = read(path.join(root, "generated", "repoe", "raw", "mods.min.json"));
const essences = read(path.join(sourceRoot, "crafting", "essences.json"));
const desecration = read(path.join(sourceRoot, "crafting", "desecration.json"));
const crafted = read(path.join(sourceRoot, "crafting", "crafted-modifiers.json"));

function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex").slice(0, 20); }
function fileHash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

const allClasses = index.classes.map(entry => entry.itemClass);
function category(itemClass) {
  if (/Amulet|Ring|Belt|Jewel/.test(itemClass)) return "Jewellery";
  if (/Body Armour|Helmet|Gloves|Boots|Shield|Buckler|Focus|Quiver/.test(itemClass)) return "Armour";
  return "Weapon";
}

function classesForAllowed(values) {
  const allowed = new Set(values ?? []);
  return allClasses.filter(itemClass =>
    allowed.has(itemClass)
    || allowed.has(category(itemClass))
    || (allowed.has("Jewellery") && /Amulet|Ring|Belt/.test(itemClass))
    || (allowed.has("Armour") && /Body Armour|Helmet|Gloves|Boots|Shield|Buckler|Focus/.test(itemClass))
  );
}

function statIds(technicalId) {
  return (repoeMods[technicalId]?.stats ?? []).map(stat => stat.id).sort();
}

function technicalGroups(technicalId, fallback = []) {
  return [...new Set([...(repoeMods[technicalId]?.groups ?? []), ...fallback])].sort();
}

function signature(entry) {
  const weights = rules => (rules ?? []).map(rule => `${rule.tag}:${rule.weight}`).join(">");
  return [entry.generationType, technicalGroups(entry.sourceKey, entry.groups).join("+"), statIds(entry.sourceKey).join("+"), weights(entry.spawnWeights), weights(entry.generationWeights)].join("|");
}

function valueSummary(text, values = []) {
  const source = String(text ?? "");
  const matches = source.match(/[+]?(?:\(?\d+(?:\.\d+)?[—–-]\d+(?:\.\d+)?\)?|\d+(?:\.\d+)?)(?:\s*%)?/g) ?? [];
  if (matches.length) return [...new Set(matches.map(value => value.replace(/[()]/g, "")))].join(" · ");
  if (values.length) return values.map(value => value.min === value.max ? String(value.min) : `${value.min}–${value.max}`).join(" · ");
  return "–";
}

function displayName(text) {
  let value = String(text ?? "")
    .split("\n")[0]
    .replace(/[+]?(?:\(?\d+(?:\.\d+)?[—–-]\d+(?:\.\d+)?\)?|\d+(?:\.\d+)?)(?:\s*%)?/g, "")
    .replace(/\s+/g, " ")
    .replace(/^zu\s+/i, "")
    .trim();
  if (!value) return null;
  return value.charAt(0).toLocaleUpperCase("de") + value.slice(1);
}

const entriesBySource = new Map();
for (const classEntry of index.classes) {
  const document = read(path.join(sourceRoot, classEntry.dataFile));
  for (const mod of [...document.prefixes, ...document.suffixes]) {
    let entry = entriesBySource.get(mod.sourceId);
    if (!entry) {
      entry = {
        sourceKey: mod.sourceId,
        appModId: mod.id,
        generationType: mod.generationType,
        tier: mod.tier,
        requiredLevel: mod.itemLevel,
        displayTextDe: mod.textDe,
        displayTextEn: mod.textEn,
        groups: mod.family ?? [],
        values: [],
        regularClasses: [],
        specialClasses: [],
        requiredBaseTagsAny: [],
        requiredBaseNamesEn: [],
        spawnWeights: mod.spawnWeights ?? [],
        generationWeights: mod.generationWeights ?? [],
        craftingSources: []
      };
      entriesBySource.set(mod.sourceId, entry);
    }
    if (!entry.regularClasses.includes(classEntry.itemClass)) entry.regularClasses.push(classEntry.itemClass);
  }
}

function sourceBadge(entry, type, sourceId) {
  if (!entry.craftingSources.some(source => source.type === type && source.sourceId === sourceId)) {
    entry.craftingSources.push({ type, sourceId });
  }
}

function ensureSpecial(row, sourceType, allowedClasses, options = {}) {
  let entry = entriesBySource.get(row.technicalModId);
  if (!entry) {
    entry = {
      sourceKey: row.technicalModId,
      appModId: null,
      generationType: row.generationType,
      tier: row.tier ?? null,
      requiredLevel: Number(row.requiredLevel ?? row.itemLevel ?? 0),
      displayTextDe: row.textDe ?? null,
      displayTextEn: row.textEn ?? null,
      groups: row.modGroups ?? [],
      values: row.values ?? [],
      regularClasses: [],
      specialClasses: [],
      requiredBaseTagsAny: options.requiredBaseTagsAny ?? [],
      requiredBaseNamesEn: options.requiredBaseNamesEn ?? [],
      spawnWeights: row.spawnWeights ?? [],
      generationWeights: row.generationWeights ?? [],
      craftingSources: []
    };
    entriesBySource.set(row.technicalModId, entry);
  }
  for (const itemClass of allowedClasses) if (!entry.specialClasses.includes(itemClass)) entry.specialClasses.push(itemClass);
  sourceBadge(entry, sourceType, options.sourceId ?? row.technicalModId);
}

for (const row of essences.guaranteedModifiers) {
  ensureSpecial(row, "Essenz", classesForAllowed(row.allowedItemClasses), { sourceId: row.essenceId });
}
for (const row of crafted.modifiers) {
  const jewelClass = /Ruby|Emerald|Sapphire/.test(row.itemClass) ? ["Jewel"] : classesForAllowed([row.itemClass]);
  ensureSpecial(row, "Crafted", jewelClass, { sourceId: row.sourceItemId, requiredBaseNamesEn: [row.itemClass] });
}
for (const row of desecration.modifiers) {
  const classes = allClasses.filter(itemClass => category(itemClass) !== "Jewellery" || /Amulet|Ring|Belt|Jewel/.test(itemClass));
  ensureSpecial(row, "Desecration", classes, { requiredBaseTagsAny: row.allowedCategories ?? [], sourceId: "desecration" });
}

const groupsBySignature = new Map();
for (const entry of entriesBySource.values()) {
  if (!entry.displayTextDe && !entry.displayTextEn) continue;
  if (!["prefix", "suffix"].includes(entry.generationType)) continue;
  const key = signature(entry);
  if (!groupsBySignature.has(key)) groupsBySignature.set(key, []);
  groupsBySignature.get(key).push(entry);
}

const groups = [...groupsBySignature.entries()].map(([technicalSignature, tiers]) => {
  const displayTiersBySource = new Map();
  for (const itemClass of allClasses) {
    const regularTiers = tiers
      .filter(tier => tier.regularClasses.includes(itemClass))
      .sort((a, b) => b.requiredLevel - a.requiredLevel || Number(a.tier ?? 999) - Number(b.tier ?? 999) || a.sourceKey.localeCompare(b.sourceKey));
    regularTiers.forEach((tier, index) => {
      if (!displayTiersBySource.has(tier.sourceKey)) displayTiersBySource.set(tier.sourceKey, {});
      displayTiersBySource.get(tier.sourceKey)[itemClass] = index + 1;
    });
  }
  tiers.sort((a, b) => Number(a.tier ?? 999) - Number(b.tier ?? 999) || b.requiredLevel - a.requiredLevel || a.sourceKey.localeCompare(b.sourceKey));
  const representative = tiers.find(tier => tier.displayTextDe) ?? tiers[0];
  return {
    familyId: `family:${hash(technicalSignature)}`,
    technicalSignature,
    displayName: displayName(representative.displayTextDe || representative.displayTextEn),
    generationType: representative.generationType,
    tiers: tiers.map(tier => ({
      modId: tier.appModId || `special:${tier.sourceKey}`,
      sourceKey: tier.sourceKey,
      tier: tier.tier,
      technicalTier: tier.tier,
      displayTiers: displayTiersBySource.get(tier.sourceKey) ?? {},
      displayText: tier.displayTextDe || tier.displayTextEn,
      displayTextDe: tier.displayTextDe,
      displayTextEn: tier.displayTextEn,
      requiredLevel: tier.requiredLevel,
      valueSummary: valueSummary(tier.displayTextDe || tier.displayTextEn, tier.values),
      craftingSources: tier.craftingSources,
      regularClasses: tier.regularClasses,
      specialClasses: tier.specialClasses,
      requiredBaseTagsAny: tier.requiredBaseTagsAny,
      requiredBaseNamesEn: tier.requiredBaseNamesEn,
      spawnWeights: tier.spawnWeights,
      generationWeights: tier.generationWeights
    }))
  };
}).sort((a, b) => String(a.generationType).localeCompare(String(b.generationType)) || String(a.displayName).localeCompare(String(b.displayName), "de"));

const output = { schemaVersion: 1, generatedAt: new Date().toISOString(), groups };
write(path.join(appRoot, "affix-groups.json"), output);

const appIndexPath = path.join(appRoot, "index.json");
const appIndex = read(appIndexPath);
if (appIndex.affixGroupsFile !== "affix-groups.json") {
  throw new Error("App-Index deklariert affix-groups.json nicht; zuerst build-poe2db-app-adapter.mjs ausführen");
}
const manifestPath = path.join(appRoot, "manifest.json");
const manifest = read(manifestPath);
manifest.files["affix-groups.json"] = { sha256: fileHash(path.join(appRoot, "affix-groups.json")) };
manifest.counts.affixGroups = groups.length;
manifest.counts.affixGroupTiers = groups.reduce((sum, group) => sum + group.tiers.length, 0);
write(manifestPath, manifest);
console.log(JSON.stringify({ groups: groups.length, tiers: groups.reduce((sum, group) => sum + group.tiers.length, 0) }));
