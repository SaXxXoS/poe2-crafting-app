#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rawRoot = path.join(root, "generated", "raw");
const englishDir = path.join(rawRoot, "english");
const germanDir = path.join(rawRoot, "german");
const outputFile = path.join(root, "data.js");
const reportFile = path.join(root, "generated", "app-data-report.json");

function readJson(filePath, required = true) {
  if (!fs.existsSync(filePath)) {
    if (required) {
      throw new Error(`Datei fehlt: ${path.relative(root, filePath)}`);
    }
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function refId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return "";
  return value.Id ?? value.id ?? "";
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_/.\-]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function firstValue(object, keys, fallback = null) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function numericValue(object, keys, fallback = null) {
  const value = firstValue(object, keys, fallback);
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function collectRefs(value, refs = []) {
  if (!value) return refs;

  if (typeof value === "string") {
    if (value.startsWith("Metadata/")) refs.push(value);
    return refs;
  }

  if (Array.isArray(value)) {
    for (const entry of value) collectRefs(entry, refs);
    return refs;
  }

  if (typeof value === "object") {
    const id = refId(value);
    if (id) refs.push(id);

    for (const nested of Object.values(value)) {
      collectRefs(nested, refs);
    }
  }

  return refs;
}

const CLASS_DEFINITIONS = [
  { name: "Armbrust", category: "weapon", aliases: ["armbrust", "crossbow"], tokens: ["crossbow"] },
  { name: "Kampfstab", category: "weapon", aliases: ["kampfstab", "quarterstaff"], tokens: ["quarterstaff"] },
  { name: "Kriegsstab", category: "weapon", aliases: ["kriegsstab", "warstaff"], tokens: ["warstaff"] },
  { name: "Zauberstab", category: "weapon", aliases: ["zauberstab", "wand"], tokens: ["wand"] },
  { name: "Zepter", category: "weapon", aliases: ["zepter", "sceptre", "scepter"], tokens: ["sceptre", "scepter"] },
  { name: "Stab", category: "weapon", aliases: ["stab", "staff"], tokens: ["staff"] },
  { name: "Speer", category: "weapon", aliases: ["speer", "spear"], tokens: ["spear"] },
  { name: "Bogen", category: "weapon", aliases: ["bogen", "bow"], tokens: ["bow"] },
  { name: "Streitkolben", category: "weapon", aliases: ["streitkolben", "mace"], tokens: ["mace"] },
  { name: "Schwert", category: "weapon", aliases: ["schwert", "sword"], tokens: ["sword"] },
  { name: "Axt", category: "weapon", aliases: ["axt", "axe"], tokens: ["axe"] },
  { name: "Dolch", category: "weapon", aliases: ["dolch", "dagger"], tokens: ["dagger"] },
  { name: "Flegel", category: "weapon", aliases: ["flegel", "flail"], tokens: ["flail"] },
  { name: "Klaue", category: "weapon", aliases: ["klaue", "claw"], tokens: ["claw"] },

  { name: "Helm", category: "armour", aliases: ["helm", "helmet"], tokens: ["helmet"] },
  { name: "Körperrüstung", category: "armour", aliases: ["körperrüstung", "body armour", "body armor"], tokens: ["body armour", "body armor"] },
  { name: "Handschuhe", category: "armour", aliases: ["handschuhe", "gloves"], tokens: ["gloves"] },
  { name: "Stiefel", category: "armour", aliases: ["stiefel", "boots"], tokens: ["boots"] },
  { name: "Schild", category: "armour", aliases: ["schild", "shield"], tokens: ["shield"] },
  { name: "Fokus", category: "armour", aliases: ["fokus", "focus"], tokens: ["focus"] },
  { name: "Köcher", category: "armour", aliases: ["köcher", "quiver"], tokens: ["quiver"] },

  { name: "Ring", category: "jewellery", aliases: ["ring"], tokens: ["ring"] },
  { name: "Amulett", category: "jewellery", aliases: ["amulett", "amulet"], tokens: ["amulet"] },
  { name: "Gürtel", category: "jewellery", aliases: ["gürtel", "belt"], tokens: ["belt"] }
];

function definitionForClassId(classId) {
  const normalized = ` ${normalize(classId)} `;

  for (const definition of CLASS_DEFINITIONS) {
    for (const token of definition.tokens) {
      if (normalized.includes(` ${normalize(token)} `)) return definition;
    }
  }

  return null;
}

function localizedMap(rows) {
  return new Map(rows.map(row => [row.Id, row]));
}

const baseEnglish = readJson(path.join(englishDir, "baseitemtypes.json"));
const baseGerman = readJson(path.join(germanDir, "baseitemtypes.json"), false);
const modsEnglish = readJson(path.join(englishDir, "mods.json"));
const modsGerman = readJson(path.join(germanDir, "mods.json"), false);
const statsEnglish = readJson(path.join(englishDir, "stats.json"), false);
const statsGerman = readJson(path.join(germanDir, "stats.json"), false);
const currencyEnglish = readJson(path.join(englishDir, "currencyitems.json"), false);
const currencyGerman = readJson(path.join(germanDir, "currencyitems.json"), false);

const detailFileNames = [
  "weapontypes.json",
  "armourtypes.json",
  "shieldtypes.json",
  "belttypes.json",
  "focustypes.json",
  "quivers.json",
  "ringtypes.json",
  "amuletTypes.json"
];

const detailRows = [];
for (const fileName of detailFileNames) {
  const rows = readJson(path.join(englishDir, fileName), false);
  for (const row of rows) detailRows.push({ ...row, __sourceFile: fileName });
}

const germanBaseById = localizedMap(baseGerman);
const germanModById = localizedMap(modsGerman);
const germanStatById = localizedMap(statsGerman);
const englishStatById = localizedMap(statsEnglish);
const germanCurrencyById = localizedMap(currencyGerman);
const englishModById = localizedMap(modsEnglish);

function extractBaseReferences(row) {
  const refs = [];

  for (const [key, value] of Object.entries(row ?? {})) {
    const normalizedKey = normalize(key);

    if (
      normalizedKey.includes("base item") ||
      normalizedKey.includes("baseitem") ||
      normalizedKey.includes("base type") ||
      normalizedKey.includes("basetype")
    ) {
      collectRefs(value, refs);
    }
  }

  return unique(refs);
}

function buildDetailIndex(rows) {
  const index = new Map();

  for (const row of rows) {
    const refs = extractBaseReferences(row);

    for (const baseId of refs) {
      if (!index.has(baseId)) index.set(baseId, []);
      index.get(baseId).push(row);
    }
  }

  return index;
}

const detailsByBaseId = buildDetailIndex(detailRows);

function chooseDetails(base) {
  const direct = detailsByBaseId.get(base.Id);
  if (direct?.length) return direct[0];

  const baseIdNormalized = normalize(base.Id);
  const baseNameNormalized = normalize(base.Name);

  for (const row of detailRows) {
    const searchable = normalize(JSON.stringify(row));

    if (
      (baseIdNormalized && searchable.includes(baseIdNormalized)) ||
      (baseNameNormalized && searchable.includes(baseNameNormalized))
    ) {
      return row;
    }
  }

  return null;
}

function formatRange(min, max) {
  if (min === null && max === null) return "–";
  if (min === null) return String(max);
  if (max === null || min === max) return String(min);
  return `${min}–${max}`;
}

function formatPercent(value) {
  if (value === null) return "–";
  let result = value;
  if (result > 0 && result <= 1) result *= 100;

  return `${result.toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })} %`;
}

function formatNumber(value) {
  if (value === null) return "–";
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function findNumericByPatterns(object, includePatterns, excludePatterns = []) {
  for (const [key, value] of Object.entries(object ?? {})) {
    const normalizedKey = normalize(key);

    if (!includePatterns.some(pattern => normalizedKey.includes(pattern))) continue;
    if (excludePatterns.some(pattern => normalizedKey.includes(pattern))) continue;

    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }

  return null;
}

function requirementsText(base, details) {
  const combined = { ...base, ...(details ?? {}) };

  const strength = findNumericByPatterns(combined, ["strength requirement", "required strength", "req str"]);
  const dexterity = findNumericByPatterns(combined, ["dexterity requirement", "required dexterity", "req dex"]);
  const intelligence = findNumericByPatterns(combined, ["intelligence requirement", "required intelligence", "req int"]);

  const parts = [];
  if (strength > 0) parts.push(`${strength} Str`);
  if (dexterity > 0) parts.push(`${dexterity} Ges`);
  if (intelligence > 0) parts.push(`${intelligence} Int`);

  return parts.join(" · ");
}

function baseStats(base, details) {
  const combined = { ...base, ...(details ?? {}) };

  const physicalMin = findNumericByPatterns(
    combined,
    ["physical damage min", "damage min", "min damage"],
    ["elemental", "fire", "cold", "lightning", "chaos"]
  );

  const physicalMax = findNumericByPatterns(
    combined,
    ["physical damage max", "damage max", "max damage"],
    ["elemental", "fire", "cold", "lightning", "chaos"]
  );

  const directAps = findNumericByPatterns(combined, ["attacks per second", "attack rate", "aps"]);
  const attackTime = findNumericByPatterns(combined, ["attack time"], ["cast"]);

  let aps = directAps;
  if (aps === null && attackTime) {
    aps = attackTime > 20 ? 1000 / attackTime : 1 / attackTime;
  }

  const criticalChance = findNumericByPatterns(combined, ["critical chance", "crit chance"]);

  return {
    requirements: requirementsText(base, details),
    physical: formatRange(physicalMin, physicalMax),
    crit: formatPercent(criticalChance),
    aps: formatNumber(aps)
  };
}

function statLabel(statId) {
  const row = germanStatById.get(statId) ?? englishStatById.get(statId);

  return firstValue(
    row,
    ["Text", "Name", "Id"],
    statId.replaceAll("_", " ")
  );
}

function statParts(mod) {
  const parts = [];

  for (let index = 1; index <= 6; index += 1) {
    const statId = refId(mod[`StatsKey${index}`]);
    if (!statId) continue;

    const min = Number(mod[`Stat${index}Min`] ?? 0);
    const max = Number(mod[`Stat${index}Max`] ?? min);

    parts.push({
      id: statId,
      label: statLabel(statId),
      min,
      max,
      value: min === max ? `${min}` : `${min}–${max}`
    });
  }

  return parts;
}

function readableMod(mod) {
  const localized = germanModById.get(mod.Id) ?? mod;
  const parts = statParts(mod);

  let name;
  if (parts.length === 1) {
    name = parts[0].label;
  } else if (parts.length > 1) {
    name = parts.map(part => part.label).join(" / ");
  } else {
    name = localized.Name ?? mod.Name ?? mod.Id;
  }

  return {
    name,
    range: parts.length ? parts.map(part => part.value).join(" / ") : "–",
    parts
  };
}

function readableImplicit(modId) {
  const mod = englishModById.get(modId);
  if (!mod) {
    return { name: modId, kind: "Basis-Implizit", range: "–" };
  }

  const readable = readableMod(mod);

  return {
    name: readable.name,
    kind: "Basis-Implizit",
    range: readable.range
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  importedBases: 0,
  importedModAssignments: 0,
  classes: {},
  affixesByClass: {},
  skippedBaseClasses: {},
  basesWithoutDetails: [],
  detailSources: {},
  globalFallbackMods: 0
};

const classOptions = {
  weapon: CLASS_DEFINITIONS.filter(row => row.category === "weapon").map(row => row.name),
  armour: CLASS_DEFINITIONS.filter(row => row.category === "armour").map(row => row.name),
  jewellery: CLASS_DEFINITIONS.filter(row => row.category === "jewellery").map(row => row.name)
};

const baseItems = Object.fromEntries(CLASS_DEFINITIONS.map(row => [row.name, []]));
const baseTagsByClass = new Map(CLASS_DEFINITIONS.map(row => [row.name, new Set()]));
const classIdsByDefinition = new Map(CLASS_DEFINITIONS.map(row => [row.name, new Set()]));

for (const row of baseEnglish) {
  const classId = refId(row.ItemClassesKey);
  const definition = definitionForClassId(classId);

  if (!definition) {
    const key = classId || "Unbekannt";
    report.skippedBaseClasses[key] = (report.skippedBaseClasses[key] ?? 0) + 1;
    continue;
  }

  if (!row.Name || row.SiteVisibility === 0) continue;

  classIdsByDefinition.get(definition.name).add(classId);

  const tags = asArray(row.TagsKeys).map(refId).filter(Boolean);
  for (const tag of tags) baseTagsByClass.get(definition.name).add(tag);

  const details = chooseDetails(row);
  const localized = germanBaseById.get(row.Id) ?? row;
  const stats = baseStats(row, details);
  const implicitIds = asArray(row.Implicit_ModsKeys).map(refId).filter(Boolean);

  if (!details) {
    report.basesWithoutDetails.push({
      id: row.Id,
      name: localized.Name ?? row.Name,
      classId,
      mappedClass: definition.name
    });
  } else {
    report.detailSources[details.__sourceFile] = (report.detailSources[details.__sourceFile] ?? 0) + 1;
  }

  baseItems[definition.name].push({
    id: slug(row.Id),
    sourceId: row.Id,
    name: localized.Name ?? row.Name,
    requiredLevel: Number(row.DropLevel ?? 0),
    requirements: stats.requirements,
    physical: stats.physical,
    crit: stats.crit,
    aps: stats.aps,
    implicits: implicitIds.map(readableImplicit)
  });

  report.importedBases += 1;
  report.classes[definition.name] = (report.classes[definition.name] ?? 0) + 1;
}

for (const list of Object.values(baseItems)) {
  list.sort((a, b) =>
    a.requiredLevel - b.requiredLevel ||
    a.name.localeCompare(b.name, "de")
  );
}

function generationType(mod) {
  const value = Number(mod.GenerationType);
  if (value === 1) return "prefix";
  if (value === 2) return "suffix";
  return null;
}

function weightedTags(mod) {
  const output = new Set();

  const tagFields = [
    ["SpawnWeight_TagsKeys", "SpawnWeight_Values"],
    ["GenerationWeight_TagsKeys", "GenerationWeight_Values"]
  ];

  for (const [tagsKey, valuesKey] of tagFields) {
    const tags = asArray(mod[tagsKey]).map(refId);
    const values = asArray(mod[valuesKey]);

    tags.forEach((tag, index) => {
      const weight = Number(values[index] ?? 1);
      if (tag && weight > 0) output.add(tag);
    });
  }

  for (const tag of asArray(mod.TagsKeys).map(refId)) {
    if (tag) output.add(tag);
  }

  return output;
}

function restrictionRefs(mod) {
  const refs = [];

  for (const value of asArray(mod.CraftingItemClassRestrictions)) {
    const id = refId(value);
    if (id) refs.push(id);
    collectRefs(value, refs);
  }

  return unique(refs);
}

function restrictionMatches(mod, definition) {
  const restrictions = restrictionRefs(mod);
  if (!restrictions.length) return false;

  const knownClassIds = classIdsByDefinition.get(definition.name) ?? new Set();

  return restrictions.some(restriction => {
    if (knownClassIds.has(restriction)) return true;

    const normalizedRestriction = normalize(restriction);
    return definition.tokens.some(token =>
      normalizedRestriction.includes(normalize(token))
    );
  });
}

function genericTagMatches(tag, definition) {
  const normalizedTag = normalize(tag);

  if (definition.category === "weapon" && normalizedTag.includes("weapon")) return true;
  if (definition.category === "armour" && (normalizedTag.includes("armour") || normalizedTag.includes("armor"))) return true;
  if (definition.category === "jewellery" && (normalizedTag.includes("jewel") || normalizedTag.includes("ring") || normalizedTag.includes("amulet") || normalizedTag.includes("belt"))) return true;

  return definition.tokens.some(token =>
    normalizedTag.includes(normalize(token))
  );
}

function appliesToClass(mod, definition) {
  if (restrictionMatches(mod, definition)) return true;

  const modTags = weightedTags(mod);
  const classTags = baseTagsByClass.get(definition.name) ?? new Set();

  for (const tag of modTags) {
    if (classTags.has(tag) || genericTagMatches(tag, definition)) return true;
  }

  /*
   * Viele PoE2-Itemmods haben keine exportierten Spawnweights.
   * Item-Domain (1) ohne Tags/Restriktionen wird deshalb als globales
   * Ausrüstungsaffix behandelt, statt vollständig zu verschwinden.
   */
  const domain = Number(mod.Domain ?? mod.ModDomain ?? -1);
  if (domain === 1 && modTags.size === 0 && restrictionRefs(mod).length === 0) {
    report.globalFallbackMods += 1;
    return true;
  }

  return false;
}

const mods = Object.fromEntries(
  CLASS_DEFINITIONS.map(row => [row.name, { prefix: [], suffix: [] }])
);

for (const mod of modsEnglish) {
  const type = generationType(mod);
  if (!type) continue;
  if (Number(mod.Level ?? 0) < 1) continue;
  if (mod.IsEssenceOnlyModifier === true) continue;

  const readable = readableMod(mod);
  const familyIds = asArray(mod.Families).map(refId).filter(Boolean);
  const group = familyIds[0] || refId(mod.ModTypeKey) || String(mod.ModTypeKey?.RowIndex ?? mod.Id);

  for (const definition of CLASS_DEFINITIONS) {
    if (!appliesToClass(mod, definition)) continue;

    mods[definition.name][type].push({
      id: slug(mod.Id),
      sourceId: mod.Id,
      name: readable.name,
      group,
      lvl: Number(mod.Level ?? 1),
      tier: "",
      range: readable.range
    });

    report.importedModAssignments += 1;
  }
}

for (const definition of CLASS_DEFINITIONS) {
  for (const type of ["prefix", "suffix"]) {
    const list = mods[definition.name][type];
    const grouped = new Map();

    for (const mod of list) {
      if (!grouped.has(mod.group)) grouped.set(mod.group, []);
      grouped.get(mod.group).push(mod);
    }

    for (const groupMods of grouped.values()) {
      groupMods.sort((a, b) => b.lvl - a.lvl || a.name.localeCompare(b.name, "de"));
      groupMods.forEach((mod, index) => {
        mod.tier = `T${index + 1}`;
      });
    }

    list.sort((a, b) =>
      a.name.localeCompare(b.name, "de") ||
      b.lvl - a.lvl
    );
  }

  report.affixesByClass[definition.name] = {
    prefix: mods[definition.name].prefix.length,
    suffix: mods[definition.name].suffix.length
  };
}

const currencyNames = currencyEnglish
  .map(row => germanCurrencyById.get(row.Id)?.Name ?? row.Name)
  .filter(Boolean);

const preferredCurrencyNames = [
  "Divine Orb",
  "Exalted Orb",
  "Regal Orb",
  "Orb of Annulment",
  "Chaos Orb"
];

const priceItems = unique([...preferredCurrencyNames, ...currencyNames]);

const recognition = {
  classAliases: Object.fromEntries(CLASS_DEFINITIONS.map(row => [row.name, row.aliases])),
  categoryByClass: Object.fromEntries(CLASS_DEFINITIONS.map(row => [row.name, row.category]))
};

const data = {
  generatedAt: new Date().toISOString(),
  classOptions,
  baseItems,
  mods,
  priceItems,
  recognition
};

fs.writeFileSync(
  outputFile,
  `window.EXILEFORGE_DATA = ${JSON.stringify(data, null, 2)};\n`,
  "utf8"
);

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log(`data.js erzeugt: ${report.importedBases} Basen.`);
console.log(`Affix-Zuordnungen: ${report.importedModAssignments}.`);
console.log(`Diagnose: ${path.relative(root, reportFile)}`);
