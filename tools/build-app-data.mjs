#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const generated = path.join(root, "generated", "raw");
const englishDir = path.join(generated, "english");
const germanDir = path.join(generated, "german");
const outputFile = path.join(root, "data.js");

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

function slug(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function firstDefined(object, keys, fallback = "") {
  for (const key of keys) {
    if (object?.[key] !== undefined && object[key] !== null && object[key] !== "") {
      return object[key];
    }
  }
  return fallback;
}

function keyName(value) {
  return String(refId(value))
    .replace(/^Metadata\/Items\//i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_/.-]+/g, " ")
    .trim()
    .toLowerCase();
}

const CLASS_DEFINITIONS = [
  {
    name: "Speer",
    category: "weapon",
    aliases: ["speer", "spear"],
    match: ["spear"]
  },
  {
    name: "Bogen",
    category: "weapon",
    aliases: ["bogen", "bow"],
    match: ["bow"]
  },
  {
    name: "Kampfstab",
    category: "weapon",
    aliases: ["kampfstab", "quarterstaff"],
    match: ["quarterstaff"]
  },
  {
    name: "Armbrust",
    category: "weapon",
    aliases: ["armbrust", "crossbow"],
    match: ["crossbow"]
  },
  {
    name: "Streitkolben",
    category: "weapon",
    aliases: ["streitkolben", "mace"],
    match: ["mace"]
  },
  {
    name: "Schwert",
    category: "weapon",
    aliases: ["schwert", "sword"],
    match: ["sword"]
  },
  {
    name: "Axt",
    category: "weapon",
    aliases: ["axt", "axe"],
    match: ["axe"]
  },
  {
    name: "Dolch",
    category: "weapon",
    aliases: ["dolch", "dagger"],
    match: ["dagger"]
  },
  {
    name: "Flegel",
    category: "weapon",
    aliases: ["flegel", "flail"],
    match: ["flail"]
  },
  {
    name: "Helm",
    category: "armour",
    aliases: ["helm", "helmet"],
    match: ["helmet"]
  },
  {
    name: "Körperrüstung",
    category: "armour",
    aliases: ["körperrüstung", "korperrustung", "body armour", "body armor"],
    match: ["body armour", "body armor"]
  },
  {
    name: "Handschuhe",
    category: "armour",
    aliases: ["handschuhe", "gloves"],
    match: ["gloves"]
  },
  {
    name: "Stiefel",
    category: "armour",
    aliases: ["stiefel", "boots"],
    match: ["boots"]
  },
  {
    name: "Schild",
    category: "armour",
    aliases: ["schild", "shield"],
    match: ["shield"]
  },
  {
    name: "Fokus",
    category: "armour",
    aliases: ["fokus", "focus"],
    match: ["focus"]
  },
  {
    name: "Ring",
    category: "jewellery",
    aliases: ["ring"],
    match: ["ring"]
  },
  {
    name: "Amulett",
    category: "jewellery",
    aliases: ["amulett", "amulet"],
    match: ["amulet"]
  },
  {
    name: "Gürtel",
    category: "jewellery",
    aliases: ["gürtel", "gurtel", "belt"],
    match: ["belt"]
  }
];

function definitionForClassId(classId) {
  const normalized = keyName(classId);
  return CLASS_DEFINITIONS.find(definition =>
    definition.match.some(token => normalized.includes(token))
  ) ?? null;
}

const baseEnglish = readJson(path.join(englishDir, "baseitemtypes.json"));
const baseGerman = readJson(path.join(germanDir, "baseitemtypes.json"), false);
const modsEnglish = readJson(path.join(englishDir, "mods.json"));
const modsGerman = readJson(path.join(germanDir, "mods.json"), false);
const statsEnglish = readJson(path.join(englishDir, "stats.json"), false);
const statsGerman = readJson(path.join(germanDir, "stats.json"), false);
const currencyEnglish = readJson(path.join(englishDir, "currencyitems.json"), false);
const currencyGerman = readJson(path.join(germanDir, "currencyitems.json"), false);

const germanBaseById = new Map(baseGerman.map(row => [row.Id, row]));
const germanModById = new Map(modsGerman.map(row => [row.Id, row]));
const germanStatById = new Map(statsGerman.map(row => [row.Id, row]));
const englishStatById = new Map(statsEnglish.map(row => [row.Id, row]));
const germanCurrencyById = new Map(currencyGerman.map(row => [row.Id, row]));

const classOptions = {
  weapon: CLASS_DEFINITIONS.filter(row => row.category === "weapon").map(row => row.name),
  armour: CLASS_DEFINITIONS.filter(row => row.category === "armour").map(row => row.name),
  jewellery: CLASS_DEFINITIONS.filter(row => row.category === "jewellery").map(row => row.name)
};

const baseItems = Object.fromEntries(CLASS_DEFINITIONS.map(row => [row.name, []]));
const baseTagsByClass = new Map(CLASS_DEFINITIONS.map(row => [row.name, new Set()]));

for (const row of baseEnglish) {
  const classId = refId(row.ItemClassesKey);
  const definition = definitionForClassId(classId);

  if (!definition) continue;
  if (!row.Name) continue;
  if (row.SiteVisibility === 0) continue;

  const localized = germanBaseById.get(row.Id) ?? row;
  const tags = asArray(row.TagsKeys).map(refId).filter(Boolean);

  for (const tag of tags) {
    baseTagsByClass.get(definition.name).add(tag);
  }

  const implicitIds = asArray(row.Implicit_ModsKeys).map(refId).filter(Boolean);

  baseItems[definition.name].push({
    id: slug(row.Id),
    sourceId: row.Id,
    name: localized.Name ?? row.Name,
    requiredLevel: Number(row.DropLevel ?? 0),
    requirements: "",
    physical: "–",
    crit: "–",
    aps: "–",
    implicits: implicitIds.map(id => {
      const mod = germanModById.get(id) ?? modsEnglish.find(entry => entry.Id === id);
      return {
        name: mod?.Name ?? id,
        kind: "Basis-Implizit"
      };
    })
  });
}

for (const list of Object.values(baseItems)) {
  list.sort((a, b) =>
    a.requiredLevel - b.requiredLevel ||
    a.name.localeCompare(b.name, "de")
  );
}

function statLabel(statId) {
  const german = germanStatById.get(statId);
  const english = englishStatById.get(statId);
  const row = german ?? english;

  return firstDefined(
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
  const direct = asArray(row.TagsKeys).map(refId);
  const spawn = asArray(row.SpawnWeight_TagsKeys).map(refId);
  return new Set([...direct, ...spawn].filter(Boolean));
}

function appliesToClass(row, className) {
  const classTags = baseTagsByClass.get(className) ?? new Set();
  const tags = modTags(row);

  if (tags.size === 0) {
    return false;
  }

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
    const value = min === max ? `${min}` : `${min}–${max}`;

    parts.push({
      id: statId,
      label: statLabel(statId),
      value
    });
  }

  return parts;
}

function readableModName(row, localized, parts) {
  const explicitName = localized?.Name ?? row.Name ?? "";

  if (parts.length === 1) {
    return parts[0].label || explicitName || row.Id;
  }

  if (parts.length > 1) {
    return parts.map(part => part.label).join(" / ");
  }

  return explicitName || row.Id;
}

function readableRange(parts) {
  if (!parts.length) return "–";
  return parts.map(part => part.value).join(" / ");
}

const mods = Object.fromEntries(
  CLASS_DEFINITIONS.map(row => [
    row.name,
    { prefix: [], suffix: [] }
  ])
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
      range: readableRange(parts)
    });
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
      a.tier.localeCompare(b.tier, "de")
    );
  }
}

const preferredCurrencyNames = [
  "Divine Orb",
  "Exalted Orb",
  "Regal Orb",
  "Orb of Annulment",
  "Chaos Orb"
];

const currencyNames = currencyEnglish
  .map(row => {
    const localized = germanCurrencyById.get(row.Id);
    return localized?.Name ?? row.Name;
  })
  .filter(Boolean);

const priceItems = [
  ...preferredCurrencyNames,
  ...currencyNames
].filter((value, index, array) => array.indexOf(value) === index);

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

const output =
  "window.EXILEFORGE_DATA = " +
  JSON.stringify(data, null, 2) +
  ";\n";

fs.writeFileSync(outputFile, output, "utf8");

const baseCount = Object.values(baseItems).reduce((sum, rows) => sum + rows.length, 0);
const modCount = Object.values(mods).reduce(
  (sum, group) => sum + group.prefix.length + group.suffix.length,
  0
);

console.log(`data.js erzeugt: ${baseCount} Basen, ${modCount} Affixe.`);
