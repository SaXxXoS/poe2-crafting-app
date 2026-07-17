#!/usr/bin/env node

/**
 * ExileForge app data builder
 *
 * Input:
 *   generated/app-v2/bases.json
 *   generated/app-v2/mods.json
 *   generated/app-v2/mods-by-base.json
 *   generated/app-v2/item-classes.json
 *   generated/app-v2/tags.json
 *
 * Output:
 *   generated/app-data/manifest.json
 *   generated/app-data/index.json
 *   generated/app-data/bases.json
 *   generated/app-data/mods.json
 *   generated/app-data/pools.json
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const inputRoot = path.join(root, "generated", "app-v2");
const outputRoot = path.join(root, "generated", "app-data");

const INPUTS = {
  bases: path.join(inputRoot, "bases.json"),
  mods: path.join(inputRoot, "mods.json"),
  pools: path.join(inputRoot, "mods-by-base.json"),
  itemClasses: path.join(inputRoot, "item-classes.json"),
  tags: path.join(inputRoot, "tags.json")
};

const EQUIPMENT_CLASS_HINTS = [
  "armour", "body", "boots", "bow", "buckler", "claw", "crossbow",
  "dagger", "focus", "gloves", "helmet", "jewel", "mace", "martial",
  "quiver", "ring", "amulet", "belt", "sceptre", "shield", "spear",
  "staff", "sword", "wand", "weapon"
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Eingabedatei fehlt: ${path.relative(root, filePath)}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(value => typeof value === "string" && value))];
}

function extractId(value) {
  if (typeof value === "string") return value;

  if (value && typeof value === "object") {
    return value.id
      ?? value.Id
      ?? value.mod_id
      ?? value.modId
      ?? value.key
      ?? null;
  }

  return null;
}

function extractIds(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map(extractId));
  }

  if (value && typeof value === "object") {
    return uniqueStrings(Object.keys(value));
  }

  return [];
}

function normalizeGenerationType(value) {
  const type = String(value ?? "").toLowerCase();

  if (type.includes("prefix")) return "prefix";
  if (type.includes("suffix")) return "suffix";
  if (type.includes("implicit")) return "implicit";
  if (type.includes("corrupt")) return "corrupted";
  if (type.includes("enchant")) return "enchantment";

  return type || "unknown";
}

function normalizeWeightRows(value) {
  return asArray(value)
    .map(row => {
      if (Array.isArray(row)) {
        return {
          tag: String(row[0] ?? ""),
          weight: Number(row[1] ?? 0) || 0
        };
      }

      if (row && typeof row === "object") {
        return {
          tag: String(row.tag ?? row.id ?? row.name ?? ""),
          weight: Number(row.weight ?? row.value ?? 0) || 0
        };
      }

      return null;
    })
    .filter(Boolean)
    .filter(row => row.tag);
}

function normalizeStatRows(stats) {
  if (Array.isArray(stats)) {
    return stats.map((stat, index) => {
      if (stat && typeof stat === "object") {
        return {
          id: String(stat.id ?? stat.stat ?? stat.stat_id ?? index),
          min: Number(stat.min ?? stat.min_value ?? stat.value_min ?? 0),
          max: Number(stat.max ?? stat.max_value ?? stat.value_max ?? 0)
        };
      }

      return {
        id: String(stat ?? index),
        min: 0,
        max: 0
      };
    });
  }

  if (stats && typeof stats === "object") {
    return Object.entries(stats).map(([id, value]) => {
      if (value && typeof value === "object") {
        return {
          id,
          min: Number(value.min ?? value.min_value ?? 0),
          max: Number(value.max ?? value.max_value ?? 0)
        };
      }

      return {
        id,
        min: Number(value ?? 0),
        max: Number(value ?? 0)
      };
    });
  }

  return [];
}

function looksLikeEquipment(base) {
  const itemClass = String(base.itemClass ?? "").toLowerCase();
  const tags = asArray(base.tags).join(" ").toLowerCase();
  const id = String(base.id ?? "").toLowerCase();

  if (id.includes("/currency/") || id.includes("/gems/")) return false;
  if (itemClass.includes("currency") || itemClass.includes("gem")) return false;

  return EQUIPMENT_CLASS_HINTS.some(hint =>
    itemClass.includes(hint) || tags.includes(hint)
  );
}

function displayClassName(itemClassId, itemClasses) {
  const row = itemClasses?.[itemClassId];

  if (typeof row === "string") return row;

  if (row && typeof row === "object") {
    return row.name
      ?? row.display_name
      ?? row.displayName
      ?? row.id
      ?? itemClassId;
  }

  return itemClassId;
}

function normalizeBase(base, itemClasses) {
  const raw = base.raw && typeof base.raw === "object" ? base.raw : {};
  const properties = base.properties && typeof base.properties === "object"
    ? base.properties
    : {};

  return {
    id: String(base.id),
    name: asString(base.nameEn, String(base.id)),
    nameDe: null,
    itemClass: asString(base.itemClass),
    itemClassName: displayClassName(base.itemClass, itemClasses),
    dropLevel: Number(base.dropLevel ?? 0) || 0,
    tags: uniqueStrings(asArray(base.tags)),
    requirements: base.requirements ?? {},
    properties,
    implicits: asArray(base.implicits),
    width: Number(base.width ?? raw.inventory_width ?? 0) || 0,
    height: Number(base.height ?? raw.inventory_height ?? 0) || 0,
    releaseState: raw.release_state ?? null,
    inheritsFrom: raw.inherits_from ?? null,
    visualIdentity: raw.visual_identity ?? null
  };
}

function normalizeMod(mod) {
  const raw = mod.raw && typeof mod.raw === "object" ? mod.raw : {};

  return {
    id: String(mod.id),
    generationType: normalizeGenerationType(mod.generationType),
    requiredLevel: Number(mod.requiredLevel ?? 0) || 0,
    domain: mod.domain ?? null,
    group: asString(mod.group),
    stats: normalizeStatRows(mod.stats),
    spawnWeights: normalizeWeightRows(mod.spawnWeights),
    generationWeights: normalizeWeightRows(mod.generationWeights),
    tags: uniqueStrings(asArray(mod.tags)),
    name: raw.name ?? raw.display_name ?? raw.displayName ?? null,
    type: raw.type ?? raw.mod_type ?? raw.modType ?? null
  };
}

function normalizeSourcePool(pool) {
  const raw = pool.raw && typeof pool.raw === "object" ? pool.raw : {};
  const prefixIds = extractIds(pool.prefixes ?? raw.prefixes ?? raw.prefix_mods);
  const suffixIds = extractIds(pool.suffixes ?? raw.suffixes ?? raw.suffix_mods);
  const allIds = extractIds(pool.all ?? raw.mods ?? raw.mod_ids);

  return {
    key: String(pool.baseId),
    prefixIds,
    suffixIds,
    allIds: uniqueStrings([...allIds, ...prefixIds, ...suffixIds])
  };
}

function spawnWeightForBase(mod, base) {
  const rows = asArray(mod.spawnWeights);

  if (rows.length === 0) return 0;

  const tags = new Set([
    ...asArray(base.tags),
    base.itemClass,
    "default"
  ].filter(Boolean));

  for (const row of rows) {
    if (tags.has(row.tag)) return row.weight;
  }

  return 0;
}

function findDirectPool(base, sourcePoolsByKey) {
  const keys = uniqueStrings([
    base.id,
    base.itemClass,
    ...asArray(base.tags)
  ]);

  const matched = keys
    .map(key => sourcePoolsByKey.get(key))
    .filter(Boolean);

  if (matched.length === 0) return null;

  return {
    prefixIds: uniqueStrings(matched.flatMap(pool => pool.prefixIds)),
    suffixIds: uniqueStrings(matched.flatMap(pool => pool.suffixIds)),
    allIds: uniqueStrings(matched.flatMap(pool => pool.allIds))
  };
}

function buildPoolForBase(base, mods, sourcePoolsByKey) {
  const direct = findDirectPool(base, sourcePoolsByKey);

  const candidates = direct?.allIds?.length
    ? direct.allIds
        .map(id => mods.byId.get(id))
        .filter(Boolean)
    : mods.list.filter(mod => spawnWeightForBase(mod, base) > 0);

  const available = candidates
    .filter(mod => mod.requiredLevel <= 100)
    .map(mod => ({
      id: mod.id,
      level: mod.requiredLevel,
      group: mod.group,
      weight: spawnWeightForBase(mod, base)
    }));

  const prefixes = available.filter(row =>
    mods.byId.get(row.id)?.generationType === "prefix"
  );

  const suffixes = available.filter(row =>
    mods.byId.get(row.id)?.generationType === "suffix"
  );

  return {
    baseId: base.id,
    prefixes,
    suffixes,
    source: direct?.allIds?.length ? "mods-by-base" : "spawn-weights"
  };
}

function buildClassIndex(bases) {
  const groups = new Map();

  for (const base of bases) {
    const key = base.itemClass || "Unknown";

    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        name: base.itemClassName || key,
        baseIds: []
      });
    }

    groups.get(key).baseIds.push(base.id);
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      baseIds: group.baseIds.sort()
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function buildSearchIndex(bases, mods) {
  return {
    bases: bases.map(base => ({
      id: base.id,
      text: [
        base.name,
        base.nameDe,
        base.itemClass,
        base.itemClassName,
        ...base.tags
      ].filter(Boolean).join(" ").toLowerCase()
    })),
    mods: mods.map(mod => ({
      id: mod.id,
      text: [
        mod.id,
        mod.name,
        mod.group,
        mod.generationType,
        ...mod.stats.map(stat => stat.id),
        ...mod.tags
      ].filter(Boolean).join(" ").toLowerCase()
    }))
  };
}

function main() {
  ensureDir(outputRoot);

  const baseDocument = readJson(INPUTS.bases);
  const modDocument = readJson(INPUTS.mods);
  const poolDocument = readJson(INPUTS.pools);
  const itemClasses = readJson(INPUTS.itemClasses);
  readJson(INPUTS.tags);

  const allBases = asArray(baseDocument.bases)
    .map(base => normalizeBase(base, itemClasses));

  const bases = allBases
    .filter(looksLikeEquipment)
    .sort((a, b) =>
      a.itemClassName.localeCompare(b.itemClassName, "en")
      || a.dropLevel - b.dropLevel
      || a.name.localeCompare(b.name, "en")
    );

  const mods = asArray(modDocument.mods)
    .map(normalizeMod)
    .filter(mod => mod.generationType === "prefix" || mod.generationType === "suffix")
    .sort((a, b) =>
      a.generationType.localeCompare(b.generationType)
      || a.group.localeCompare(b.group)
      || a.requiredLevel - b.requiredLevel
      || a.id.localeCompare(b.id)
    );

  const modsById = new Map(mods.map(mod => [mod.id, mod]));

  const sourcePools = asArray(poolDocument.pools).map(normalizeSourcePool);
  const sourcePoolsByKey = new Map(sourcePools.map(pool => [pool.key, pool]));

  const pools = {};
  let directPoolCount = 0;
  let fallbackPoolCount = 0;
  let prefixReferenceCount = 0;
  let suffixReferenceCount = 0;

  for (const base of bases) {
    const pool = buildPoolForBase(
      base,
      { list: mods, byId: modsById },
      sourcePoolsByKey
    );

    pools[base.id] = pool;

    if (pool.source === "mods-by-base") directPoolCount += 1;
    else fallbackPoolCount += 1;

    prefixReferenceCount += pool.prefixes.length;
    suffixReferenceCount += pool.suffixes.length;
  }

  const classes = buildClassIndex(bases);
  const search = buildSearchIndex(bases, mods);
  const generatedAt = new Date().toISOString();

  writeJson(path.join(outputRoot, "bases.json"), {
    schemaVersion: 1,
    generatedAt,
    count: bases.length,
    bases
  });

  writeJson(path.join(outputRoot, "mods.json"), {
    schemaVersion: 1,
    generatedAt,
    count: mods.length,
    mods
  });

  writeJson(path.join(outputRoot, "pools.json"), {
    schemaVersion: 1,
    generatedAt,
    count: Object.keys(pools).length,
    pools
  });

  writeJson(path.join(outputRoot, "index.json"), {
    schemaVersion: 1,
    generatedAt,
    classes,
    search
  });

  const manifest = {
    schemaVersion: 1,
    generatedAt,
    status: "app-data-ready",
    localization: {
      englishBaseNames: true,
      germanBaseNames: false,
      renderedModifierText: false,
      note: "Deutsche Namen und lesbare Mod-Texte benötigen eine separate Übersetzungsquelle."
    },
    counts: {
      inputBases: allBases.length,
      equipmentBases: bases.length,
      affixMods: mods.length,
      itemClasses: classes.length,
      pools: Object.keys(pools).length,
      directPools: directPoolCount,
      fallbackPools: fallbackPoolCount,
      prefixReferences: prefixReferenceCount,
      suffixReferences: suffixReferenceCount
    },
    files: {}
  };

  for (const filename of ["bases.json", "mods.json", "pools.json", "index.json"]) {
    const filePath = path.join(outputRoot, filename);
    manifest.files[filename] = {
      bytes: fs.statSync(filePath).size,
      sha256: sha256File(filePath)
    };
  }

  writeJson(path.join(outputRoot, "manifest.json"), manifest);

  if (bases.length === 0) {
    throw new Error("Keine Ausrüstungsbasen erkannt.");
  }

  if (mods.length === 0) {
    throw new Error("Keine Prefix- oder Suffix-Modifikatoren erkannt.");
  }

  console.log("");
  console.log("ExileForge-App-Datenbank erfolgreich erstellt.");
  console.log(`Ausrüstungsbasen: ${bases.length}`);
  console.log(`Affix-Mods: ${mods.length}`);
  console.log(`Gegenstandsklassen: ${classes.length}`);
  console.log(`Direkte Mod-Pools: ${directPoolCount}`);
  console.log(`Fallback-Mod-Pools: ${fallbackPoolCount}`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
