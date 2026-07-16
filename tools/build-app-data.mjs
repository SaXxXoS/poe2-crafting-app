#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const englishDir = path.join(root, "generated", "raw", "english");
const germanDir = path.join(root, "generated", "raw", "german");
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
  return value.Id ?? value.id ?? "";
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_/.-]+/g, " ")
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
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return fallback;
}

function numericValue(object, keys, fallback = null) {
  const value = firstValue(object, keys, fallback);
  if (value === null || value === undefined || value === "") return fallback;

  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/*
 * WICHTIG:
 * Spezifische Begriffe stehen vor allgemeinen Begriffen.
 * Dadurch wird "Crossbow" nicht mehr als "Bow" erkannt.
 */
const CLASS_DEFINITIONS = [
  {
    name: "Armbrust",
    category: "weapon",
    aliases: ["armbrust", "crossbow"],
    tokens: ["crossbow"]
  },
  {
    name: "Kampfstab",
    category: "weapon",
    aliases: ["kampfstab", "quarterstaff"],
    tokens: ["quarterstaff"]
  },
  {
    name: "Zauberstab",
    category: "weapon",
    aliases: ["zauberstab", "wand"],
    tokens: ["wand"]
  },
  {
    name: "Zepter",
    category: "weapon",
    aliases: ["zepter", "sceptre", "scepter"],
    tokens: ["sceptre", "scepter"]
  },
  {
    name: "Stab",
    category: "weapon",
    aliases: ["stab", "staff"],
    tokens: ["staff"]
  },
  {
    name: "Speer",
    category: "weapon",
    aliases: ["speer", "spear"],
    tokens: ["spear"]
  },
  {
    name: "Bogen",
    category: "weapon",
    aliases: ["bogen", "bow"],
    tokens: ["bow"]
  },
  {
    name: "Streitkolben",
    category: "weapon",
    aliases: ["streitkolben", "mace"],
    tokens: ["mace"]
  },
  {
    name: "Schwert",
    category: "weapon",
    aliases: ["schwert", "sword"],
    tokens: ["sword"]
  },
  {
    name: "Axt",
    category: "weapon",
    aliases: ["axt", "axe"],
    tokens: ["axe"]
  },
  {
    name: "Dolch",
    category: "weapon",
    aliases: ["dolch", "dagger"],
    tokens: ["dagger"]
  },
  {
    name: "Flegel",
    category: "weapon",
    aliases: ["flegel", "flail"],
    tokens: ["flail"]
  },
  {
    name: "Klaue",
    category: "weapon",
    aliases: ["klaue", "claw"],
    tokens: ["claw"]
  },
  {
    name: "Helm",
    category: "armour",
    aliases: ["helm", "helmet"],
    tokens: ["helmet"]
  },
  {
    name: "Körperrüstung",
    category: "armour",
    aliases: ["körperrüstung", "korperrustung", "body armour", "body armor"],
    tokens: ["body armour", "body armor"]
  },
  {
    name: "Handschuhe",
    category: "armour",
    aliases: ["handschuhe", "gloves"],
    tokens: ["gloves"]
  },
  {
    name: "Stiefel",
    category: "armour",
    aliases: ["stiefel", "boots"],
    tokens: ["boots"]
  },
  {
    name: "Schild",
    category: "armour",
    aliases: ["schild", "shield"],
    tokens: ["shield"]
  },
  {
    name: "Fokus",
    category: "armour",
    aliases: ["fokus", "focus"],
    tokens: ["focus"]
  },
  {
    name: "Köcher",
    category: "armour",
    aliases: ["köcher", "kocher", "quiver"],
    tokens: ["quiver"]
  },
  {
    name: "Ring",
    category: "jewellery",
    aliases: ["ring"],
    tokens: ["ring"]
  },
  {
    name: "Amulett",
    category: "jewellery",
    aliases: ["amulett", "amulet"],
    tokens: ["amulet"]
  },
  {
    name: "Gürtel",
    category: "jewellery",
    aliases: ["gürtel", "gurtel", "belt"],
    tokens: ["belt"]
  }
];

function definitionForClassId(classId) {
  const normalized = ` ${normalize(classId)} `;

  for (const definition of CLASS_DEFINITIONS) {
    for (const token of definition.tokens) {
      const normalizedToken = ` ${normalize(token)} `;
      if (normalized.includes(normalizedToken)) {
        return definition;
      }
    }
  }

  return null;
}

function localizedMap(rows) {
  return new Map(rows.map(row => [row.Id, row]));
}

function baseReferenceIds(row) {
  const ids = new Set();

  for (const [key, value] of Object.entries(row ?? {})) {
    const lower = key.toLowerCase();

    if (
      lower.includes("baseitem") ||
      lower.includes("base_item") ||
      lower === "baseitemtypeskey"
    ) {
      const id = refId(value);
      if (id) ids.add(id);
    }
  }

  return [...ids];
}

function createEquipmentIndex(rows) {
  const index = new Map();

  for (const row of rows) {
    for (const baseId of baseReferenceIds(row)) {
      if (!index.has(baseId)) index.set(baseId, row);
    }
  }

  return index;
}

const baseEnglish = readJson(path.join(englishDir, "baseitemtypes.json"));
const baseGerman = readJson(path.join(germanDir, "baseitemtypes.json"), false);
const modsEnglish = readJson(path.join(englishDir, "mods.json"));
const modsGerman = readJson(path.join(germanDir, "mods.json"), false);
const statsEnglish = readJson(path.join(englishDir, "stats.json"), false);
const statsGerman = readJson(path.join(germanDir, "stats.json"), false);
const weaponTypes = readJson(path.join(englishDir, "weapontypes.json"), false);
const armourTypes = readJson(path.join(englishDir, "armourtypes.json"), false);
const shieldTypes = readJson(path.join(englishDir, "shieldtypes.json"), false);
const beltTypes = readJson(path.join(englishDir, "belttypes.json"), false);
const currencyEnglish = readJson(path.join(englishDir, "currencyitems.json"), false);
const currencyGerman = readJson(path.join(germanDir, "currencyitems.json"), false);

const germanBaseById = localizedMap(baseGerman);
const germanModById = localizedMap(modsGerman);
const germanStatById = localizedMap(statsGerman);
const englishStatById = localizedMap(statsEnglish);
const germanCurrencyById = localizedMap(currencyGerman);

const weaponByBaseId = createEquipmentIndex(weaponTypes);
const armourByBaseId = createEquipmentIndex(armourTypes);
const shieldByBaseId = createEquipmentIndex(shieldTypes);
const beltByBaseId = createEquipmentIndex(beltTypes);

const report = {
  generatedAt: new Date().toISOString(),
  importedBases: 0,
  importedMods: 0,
  classes: {},
  skippedBaseClasses: {},
  basesWithoutDetails: [],
  notes: [
    "Nicht zugeordnete Klassen werden in skippedBaseClasses aufgelistet.",
    "Fehlende Grundwerte werden in basesWithoutDetails aufgelistet."
  ]
};

const classOptions = {
  weapon: CLASS_DEFINITIONS.filter(row => row.category === "weapon").map(row => row.name),
  armour: CLASS_DEFINITIONS.filter(row => row.category === "armour").map(row => row.name),
  jewellery: CLASS_DEFINITIONS.filter(row => row.category === "jewellery").map(row => row.name)
};

const baseItems = Object.fromEntries(CLASS_DEFINITIONS.map(row => [row.name, []]));
const baseTagsByClass = new Map(CLASS_DEFINITIONS.map(row => [row.name, new Set()]));

function equipmentDetails(baseId) {
  return (
    weaponByBaseId.get(baseId) ??
    armourByBaseId.get(baseId) ??
    shieldByBaseId.get(baseId) ??
    beltByBaseId.get(baseId) ??
    null
  );
}

function formatRange(min, max) {
  if (min === null && max === null) return "–";
  if (min === null) return String(max);
  if (max === null || min === max) return String(min);
  return `${min}–${max}`;
}

function formatPercent(value) {
  if (value === null) return "–";
  const normalized = value > 0 && value < 1 ? value * 100 : value;
  return `${normalized.toLocaleString("de-DE", {
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

function requirementsText(base, details) {
  const strength = numericValue(details, [
    "StrengthRequirement",
    "ReqStr",
    "Strength",
    "RequiredStrength"
  ], numericValue(base, ["ReqStr", "RequiredStrength"], 0));

  const dexterity = numericValue(details, [
    "DexterityRequirement",
    "ReqDex",
    "Dexterity",
    "RequiredDexterity"
  ], numericValue(base, ["ReqDex", "RequiredDexterity"], 0));

  const intelligence = numericValue(details, [
    "IntelligenceRequirement",
    "ReqInt",
    "Intelligence",
    "RequiredIntelligence"
  ], numericValue(base, ["ReqInt", "RequiredIntelligence"], 0));

  const parts = [];
  if (strength > 0) parts.push(`${strength} Str`);
  if (dexterity > 0) parts.push(`${dexterity} Ges`);
  if (intelligence > 0) parts.push(`${intelligence} Int`);

  return parts.join(" · ");
}

function baseStats(base, details) {
  const physicalMin = numericValue(details, [
    "DamageMin",
    "PhysicalDamageMin",
    "MinDamage",
    "DamageMin1",
    "PhysicalMin"
  ]);

  const physicalMax = numericValue(details, [
    "DamageMax",
    "PhysicalDamageMax",
    "MaxDamage",
    "DamageMax1",
    "PhysicalMax"
  ]);

  const attackTime = numericValue(details, [
    "AttackTime",
    "AttackTimeMilliseconds",
    "BaseAttackTime"
  ]);

  const attacksPerSecond = numericValue(details, [
    "AttacksPerSecond",
    "APS",
    "AttackRate"
  ], attackTime ? 1000 / attackTime : null);

  const criticalChance = numericValue(details, [
    "CriticalChance",
    "CritChance",
    "BaseCriticalChance"
  ]);

  return {
    requirements: requirementsText(base, details),
    physical: formatRange(physicalMin, physicalMax),
    crit: formatPercent(criticalChance),
    aps: formatNumber(attacksPerSecond)
  };
}

for (const row of baseEnglish) {
  const classId = refId(row.ItemClassesKey);
  const definition = definitionForClassId(classId);

  if (!definition) {
    const key = classId || "Unbekannt";
    report.skippedBaseClasses[key] = (report.skippedBaseClasses[key] ?? 0) + 1;
    continue;
  }

  if (!row.Name || row.SiteVisibility === 0) continue;

  const localized = germanBaseById.get(row.Id) ?? row;
  const tags = asArray(row.TagsKeys).map(refId).filter(Boolean);

  for (const tag of tags) {
    baseTagsByClass.get(definition.name).add(tag);
  }

  const details = equipmentDetails(row.Id);
  const stats = baseStats(row, details);

  if (!details) {
    report.basesWithoutDetails.push({
      id: row.Id,
      name: localized.Name ?? row.Name,
      classId,
      mappedClass: definition.name
    });
  }

  const implicitIds = asArray(row.Implicit_ModsKeys).map(refId).filter(Boolean);

  baseItems[definition.name].push({
    id: slug(row.Id),
    sourceId: row.Id,
    name: localized.Name ?? row.Name,
    requiredLevel: Number(row.DropLevel ?? 0),
    requirements: stats.requirements,
    physical: stats.physical,
    crit: stats.crit,
    aps: stats.aps,
    implicits: implicitIds.map(id => {
      const mod = germanModById.get(id) ?? modsEnglish.find(entry => entry.Id === id);
      return {
        name: mod?.Name ?? id,
        kind: "Basis-Implizit"
      };
    })
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

function statLabel(statId) {
  const localized = germanStatById.get(statId);
  const english = englishStatById.get(statId);
  const row = localized ?? english;

  return firstValue(
    row,
    ["Text", "Name", "Id"],
    statId.replaceAll("_", " ")
  );
}

function modType(row) {
  const generation = Number(row.GenerationType);
  if (generation === 1) return "prefix";
  if (generation === 2) return "suffix";
  return null;
}

function modTags(row) {
  return new Set([
    ...asArray(row.TagsKeys).map(refId),
    ...asArray(row.SpawnWeight_TagsKeys).map(refId)
  ].filter(Boolean));
}

function appliesToClass(row, className) {
  const classTags = baseTagsByClass.get(className) ?? new Set();
  const tags = modTags(row);

  if (tags.size === 0 || classTags.size === 0) return false;

  for (const tag of tags) {
    if (classTags.has(tag)) return true;
  }

  return false;
}

function statParts(row) {
  const parts = [];

  for (let index = 1; index <= 6; index += 1) {
    const statId = refId(row[`StatsKey${index}`]);
    if (!statId) continue;

    const min = Number(row[`Stat${index}Min`] ?? 0);
    const max = Number(row[`Stat${index}Max`] ?? min);

    parts.push({
      id: statId,
      label: statLabel(statId),
      value: min === max ? `${min}` : `${min}–${max}`
    });
  }

  return parts;
}

function readableModName(row, localized, parts) {
  if (parts.length === 1) return parts[0].label;
  if (parts.length > 1) return parts.map(part => part.label).join(" / ");
  return localized?.Name ?? row.Name ?? row.Id;
}

const mods = Object.fromEntries(
  CLASS_DEFINITIONS.map(row => [row.name, { prefix: [], suffix: [] }])
);

for (const row of modsEnglish) {
  const type = modType(row);
  if (!type) continue;
  if (Number(row.Level ?? 0) < 1) continue;
  if (row.IsEssenceOnlyModifier === true) continue;

  const localized = germanModById.get(row.Id) ?? row;
  const parts = statParts(row);
  const familyIds = asArray(row.Families).map(refId).filter(Boolean);
  const group = familyIds[0] || row.ModTypeKey?.RowIndex || row.Id;

  for (const definition of CLASS_DEFINITIONS) {
    if (!appliesToClass(row, definition.name)) continue;

    mods[definition.name][type].push({
      id: slug(row.Id),
      sourceId: row.Id,
      name: readableModName(row, localized, parts),
      group: String(group),
      lvl: Number(row.Level ?? 1),
      tier: "",
      range: parts.length ? parts.map(part => part.value).join(" / ") : "–"
    });

    report.importedMods += 1;
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
      a.lvl - b.lvl
    );
  }
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

const priceItems = [...preferredCurrencyNames, ...currencyNames]
  .filter((value, index, array) => array.indexOf(value) === index);

const recognition = {
  classAliases: Object.fromEntries(
    CLASS_DEFINITIONS.map(row => [row.name, row.aliases])
  ),
  categoryByClass: Object.fromEntries(
    CLASS_DEFINITIONS.map(row => [row.name, row.category])
  )
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
fs.writeFileSync(
  reportFile,
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

console.log(`data.js erzeugt: ${report.importedBases} Basen, ${report.importedMods} Affix-Zuordnungen.`);
console.log(`Bericht: ${path.relative(root, reportFile)}`);
