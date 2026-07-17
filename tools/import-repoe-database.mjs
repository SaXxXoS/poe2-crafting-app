#!/usr/bin/env node

// ExileForge RePoE database importer

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const outputRoot = path.join(root, "generated", "repoe");
const appRoot = path.join(root, "generated", "app-v2");

const SOURCE_ROOT = "https://repoe-fork.github.io/poe2";
const FILES = {
  baseItems: "base_items.min.json",
  mods: "mods.min.json",
  modsByBase: "mods_by_base.min.json",
  itemClasses: "item_classes.min.json",
  tags: "tags.min.json"
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function downloadJson(filename) {
  const url = `${SOURCE_ROOT}/${filename}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ExileForge/1.0 GitHub-Actions"
    }
  });

  if (!response.ok) {
    throw new Error(`Download fehlgeschlagen (${response.status}): ${url}`);
  }

  const text = await response.text();

  try {
    return {
      url,
      text,
      json: JSON.parse(text)
    };
  } catch (error) {
    throw new Error(`Ungültiges JSON von ${url}: ${error.message}`);
  }
}

function entries(value) {
  if (Array.isArray(value)) {
    return value.map((row, index) => [String(row?.id ?? row?.Id ?? index), row]);
  }

  if (value && typeof value === "object") {
    return Object.entries(value);
  }

  return [];
}

function first(object, keys, fallback = null) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map(entry => {
      if (typeof entry === "string") return entry;
      return entry?.id ?? entry?.Id ?? entry?.tag ?? entry?.name ?? "";
    })
    .filter(Boolean);
}

function normalizeBase(id, row) {
  const itemClass = first(row, [
    "item_class",
    "itemClass",
    "item_class_id",
    "itemClassId",
    "class",
    "class_id"
  ], "");

  const tags = stringArray(first(row, ["tags", "tag_ids", "tagIds"], []));

  const requirements = first(row, [
    "requirements",
    "requirements_base",
    "requirementsBase",
    "req"
  ], {});

  const properties = first(row, [
    "properties",
    "property_values",
    "propertyValues"
  ], {});

  const implicits = first(row, [
    "implicits",
    "implicit_mods",
    "implicitMods"
  ], []);

  return {
    id,
    nameEn: first(row, ["name", "name_en", "display_name", "displayName"], id),
    itemClass,
    tags,
    dropLevel: Number(first(row, ["drop_level", "dropLevel", "level"], 0)) || 0,
    requirements,
    properties,
    implicits,
    width: Number(first(row, ["width"], 0)) || 0,
    height: Number(first(row, ["height"], 0)) || 0,
    raw: row
  };
}

function normalizeMod(id, row) {
  const generationType = first(row, [
    "generation_type",
    "generationType",
    "type"
  ], "");

  const requiredLevel = Number(first(row, [
    "required_level",
    "requiredLevel",
    "level"
  ], 0)) || 0;

  return {
    id,
    generationType,
    requiredLevel,
    domain: first(row, ["domain", "domain_id", "domainId"], null),
    group: first(row, ["group", "group_id", "groupId", "family"], ""),
    stats: first(row, ["stats", "stat_values", "statValues"], []),
    spawnWeights: first(row, [
      "spawn_weights",
      "spawnWeights",
      "spawn_weight"
    ], []),
    generationWeights: first(row, [
      "generation_weights",
      "generationWeights",
      "generation_weight"
    ], []),
    tags: stringArray(first(row, ["tags", "tag_ids", "tagIds"], [])),
    raw: row
  };
}

function normalizePool(baseId, value) {
  if (Array.isArray(value)) {
    return {
      baseId,
      prefixes: [],
      suffixes: [],
      all: value
    };
  }

  if (!value || typeof value !== "object") {
    return {
      baseId,
      prefixes: [],
      suffixes: [],
      all: []
    };
  }

  const prefixes = first(value, ["prefixes", "prefix", "prefix_mods"], []);
  const suffixes = first(value, ["suffixes", "suffix", "suffix_mods"], []);

  const all = first(value, ["mods", "all", "mod_ids"], [
    ...stringArray(prefixes),
    ...stringArray(suffixes)
  ]);

  return {
    baseId,
    prefixes,
    suffixes,
    all,
    raw: value
  };
}

function topKeys(value) {
  const firstEntry = entries(value)[0]?.[1];
  return firstEntry && typeof firstEntry === "object"
    ? Object.keys(firstEntry).sort()
    : [];
}

async function main() {
  ensureDir(outputRoot);
  ensureDir(appRoot);

  const downloaded = {};

  for (const [key, filename] of Object.entries(FILES)) {
    console.log(`Lade ${filename} ...`);
    downloaded[key] = await downloadJson(filename);

    const rawPath = path.join(outputRoot, "raw", filename);
    ensureDir(path.dirname(rawPath));
    fs.writeFileSync(rawPath, downloaded[key].text, "utf8");
  }

  const bases = entries(downloaded.baseItems.json)
    .map(([id, row]) => normalizeBase(id, row));

  const mods = entries(downloaded.mods.json)
    .map(([id, row]) => normalizeMod(id, row));

  const pools = entries(downloaded.modsByBase.json)
    .map(([baseId, value]) => normalizePool(baseId, value));

  const baseIds = new Set(bases.map(base => base.id));
  const modIds = new Set(mods.map(mod => mod.id));

  let poolBaseMatches = 0;
  let poolModReferences = 0;
  let missingPoolModReferences = 0;

  for (const pool of pools) {
    if (baseIds.has(pool.baseId)) poolBaseMatches += 1;

    const referenced = new Set([
      ...stringArray(pool.prefixes),
      ...stringArray(pool.suffixes),
      ...stringArray(pool.all)
    ]);

    for (const modId of referenced) {
      poolModReferences += 1;
      if (!modIds.has(modId)) missingPoolModReferences += 1;
    }
  }

  writeJson(path.join(appRoot, "bases.json"), {
    schemaVersion: 1,
    source: SOURCE_ROOT,
    generatedAt: new Date().toISOString(),
    count: bases.length,
    bases
  });

  writeJson(path.join(appRoot, "mods.json"), {
    schemaVersion: 1,
    source: SOURCE_ROOT,
    generatedAt: new Date().toISOString(),
    count: mods.length,
    mods
  });

  writeJson(path.join(appRoot, "mods-by-base.json"), {
    schemaVersion: 1,
    source: SOURCE_ROOT,
    generatedAt: new Date().toISOString(),
    count: pools.length,
    pools
  });

  writeJson(path.join(appRoot, "item-classes.json"),
    downloaded.itemClasses.json
  );

  writeJson(path.join(appRoot, "tags.json"),
    downloaded.tags.json
  );

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      root: SOURCE_ROOT,
      files: Object.fromEntries(
        Object.entries(downloaded).map(([key, value]) => [
          key,
          {
            url: value.url,
            bytes: Buffer.byteLength(value.text),
            sha256: sha256(value.text)
          }
        ])
      )
    },
    counts: {
      bases: bases.length,
      mods: mods.length,
      modPools: pools.length,
      poolBaseMatches,
      poolModReferences,
      missingPoolModReferences
    },
    detectedSchemaKeys: {
      baseItems: topKeys(downloaded.baseItems.json),
      mods: topKeys(downloaded.mods.json),
      modsByBase: topKeys(downloaded.modsByBase.json)
    }
  };

  writeJson(path.join(outputRoot, "manifest.json"), manifest);

  if (bases.length === 0) {
    throw new Error("RePoE lieferte keine Basen.");
  }

  if (mods.length === 0) {
    throw new Error("RePoE lieferte keine Mods.");
  }

  if (pools.length === 0) {
    throw new Error("RePoE lieferte keine basisgenauen Mod-Pools.");
  }

  console.log("");
  console.log("RePoE-Datenbank erfolgreich erstellt.");
  console.log(`Basen: ${bases.length}`);
  console.log(`Mods: ${mods.length}`);
  console.log(`Basis-Mod-Pools: ${pools.length}`);
  console.log(`Pools mit passender Basis-ID: ${poolBaseMatches}`);
  console.log(`Fehlende Mod-Referenzen: ${missingPoolModReferences}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
