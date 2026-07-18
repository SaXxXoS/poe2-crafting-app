#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const outputRoot = path.join(root, "generated", "poe2db");
const rawRoot = path.join(outputRoot, "raw");
const offline = process.argv.includes("--offline");
const repoeBasePath = path.join(root, "generated", "repoe", "raw", "base_items.min.json");
const repoeModPath = path.join(root, "generated", "repoe", "raw", "mods.min.json");

const CLASS_CONFIGS = [
  {
    key: "spears",
    itemClass: "Spear",
    tag: "spear",
    page: "Spears",
    headings: ["Spears Item", "Speere Gegenstand"],
    baseCssClass: "Spear"
  },
  {
    key: "bows",
    itemClass: "Bow",
    tag: "bow",
    page: "Bows",
    baseCssClass: "Bow"
  },
  { key: "crossbows", itemClass: "Crossbow", tag: "crossbow", page: "Crossbows" },
  { key: "wands", itemClass: "Wand", tag: "wand", page: "Wands" },
  { key: "staves", itemClass: "Staff", tag: "staff", page: "Staves" },
  { key: "warstaves", itemClass: "Warstaff", tag: "warstaff", page: "Quarterstaves" },
  { key: "one-hand-swords", itemClass: "One Hand Sword", tag: "sword", page: "One_Hand_Swords" },
  { key: "two-hand-swords", itemClass: "Two Hand Sword", tag: "sword", page: "Two_Hand_Swords" },
  { key: "one-hand-axes", itemClass: "One Hand Axe", tag: "axe", page: "One_Hand_Axes" },
  { key: "two-hand-axes", itemClass: "Two Hand Axe", tag: "axe", page: "Two_Hand_Axes" },
  { key: "one-hand-maces", itemClass: "One Hand Mace", tag: "mace", page: "One_Hand_Maces" },
  { key: "two-hand-maces", itemClass: "Two Hand Mace", tag: "mace", page: "Two_Hand_Maces" },
  { key: "daggers", itemClass: "Dagger", tag: "dagger", page: "Daggers" },
  { key: "claws", itemClass: "Claw", tag: "claw", page: "Claws" },
  { key: "flails", itemClass: "Flail", tag: "flail", page: "Flails" },
  { key: "sceptres", itemClass: "Sceptre", tag: "sceptre", page: "Sceptres" },
  {
    key: "body-armours", itemClass: "Body Armour", tag: "body_armour", page: "Body_Armours",
    modPages: ["str", "dex", "int", "str_dex", "str_int", "dex_int", "str_dex_int"]
      .map(type => ({ page: `Body_Armours_${type}`, selectorTags: ["body_armour", `${type}_armour`] }))
  },
  {
    key: "helmets", itemClass: "Helmet", tag: "helmet", page: "Helmets",
    modPages: ["str", "dex", "int", "str_dex", "str_int", "dex_int"]
      .map(type => ({ page: `Helmets_${type}`, selectorTags: ["helmet", `${type}_armour`] }))
  },
  {
    key: "gloves", itemClass: "Gloves", tag: "gloves", page: "Gloves",
    modPages: ["str", "dex", "int", "str_dex", "str_int", "dex_int"]
      .map(type => ({ page: `Gloves_${type}`, selectorTags: ["gloves", `${type}_armour`] }))
  },
  {
    key: "boots", itemClass: "Boots", tag: "boots", page: "Boots",
    modPages: ["str", "dex", "int", "str_dex", "str_int", "dex_int"]
      .map(type => ({ page: `Boots_${type}`, selectorTags: ["boots", `${type}_armour`] }))
  },
  {
    key: "shields", itemClass: "Shield", tag: "shield", page: "Shields",
    modPages: ["str", "str_dex", "str_int"]
      .map(type => ({ page: `Shields_${type}`, selectorTags: ["shield", `${type}_armour`] }))
  },
  { key: "bucklers", itemClass: "Buckler", tag: "buckler", page: "Bucklers", selectorTags: ["buckler", "shield", "dex_armour", "dex_shield"] },
  { key: "focuses", itemClass: "Focus", tag: "focus", page: "Foci", selectorTags: ["focus", "int_armour"] },
  { key: "quivers", itemClass: "Quiver", tag: "quiver", page: "Quivers" },
  { key: "amulets", itemClass: "Amulet", tag: "amulet", page: "Amulets" },
  { key: "rings", itemClass: "Ring", tag: "ring", page: "Rings" },
  { key: "belts", itemClass: "Belt", tag: "belt", page: "Belts" },
  {
    key: "jewels", itemClass: "Jewel", tag: "jewel", page: "Jewels",
    modPages: [
      { page: "Ruby", selectorTags: ["strjewel"] },
      { page: "Emerald", selectorTags: ["dexjewel"] },
      { page: "Sapphire", selectorTags: ["intjewel"] },
      { page: "Time-Lost_Ruby", selectorTags: ["strjewel"] },
      { page: "Time-Lost_Emerald", selectorTags: ["dexjewel"] },
      { page: "Time-Lost_Sapphire", selectorTags: ["intjewel"] }
    ]
  }
];

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Ergänzende Rohdaten fehlen: ${path.relative(root, filePath)}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;|&#8211;|&#x2013;/gi, "–")
    .replace(/&mdash;|&#8212;|&#x2014;/gi, "—")
    .replace(/&amp;/g, "&")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function download(config, language, url, snapshotKey = config.key) {
  const filePath = path.join(rawRoot, `${language}-${snapshotKey}.html`);

  if (offline) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Offline-Rohdatei fehlt: ${path.relative(root, filePath)}`);
    }
    return fs.readFileSync(filePath, "utf8");
  }

  const response = await fetch(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "User-Agent": "ExileForge-PoE2DB-Importer/0.1 (+https://github.com/)"
    }
  });

  if (!response.ok) {
    throw new Error(`Download fehlgeschlagen (${response.status}): ${url}`);
  }

  const html = await response.text();
  ensureDir(rawRoot);
  fs.writeFileSync(filePath, html, "utf8");
  return html;
}

function extractBalancedObject(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Eingebettete Daten fehlen: ${marker}`);

  const start = source.indexOf("{", markerIndex + marker.length);
  if (start < 0) throw new Error("Start des eingebetteten JSON fehlt.");

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"') {
      quote = char;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error("Eingebettetes ModsView-JSON ist unvollständig.");
}

function parseModsView(html) {
  const json = extractBalancedObject(html, "new ModsView(");
  return JSON.parse(json);
}

function baseSection(html, config) {
  const heading = html.match(/<h5 class="card-header">[^<]*(?:Item|Gegenstand)\s*\/\s*\d+/i);
  const start = heading?.index ?? -1;
  const modsStart = html.indexOf("new ModsView(", start);
  const end = modsStart < 0 ? html.length : modsStart;
  if (start < 0) throw new Error(`Basisabschnitt fehlt: ${config.itemClass}`);
  return html.slice(start, end);
}

function parseRequirement(text) {
  const result = { level: 1, strength: 0, dexterity: 0, intelligence: 0 };
  const patterns = [
    ["level", /(?:Level|Stufe)\s+(\d+)/i],
    ["strength", /(\d+)\s+(?:Str|Stä)/i],
    ["dexterity", /(\d+)\s+(?:Dex|Ges)/i],
    ["intelligence", /(\d+)\s+Int/i]
  ];
  for (const [key, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) result[key] = Number(match[1]);
  }
  return result;
}

function parseBasePage(html, config) {
  const chunks = baseSection(html, config).split('<div class="col">').slice(1);
  const bases = [];

  for (const chunk of chunks) {
    const cssMatch = chunk.match(/class="whiteitem ([^"]+)" data-hover="\?s=Data%5CBaseItemTypes/i);
    if (!cssMatch) continue;

    const metadataMatch = chunk.match(/data-hover="\?s=Data%5CBaseItemTypes%2F([^"]+)"/i);
    const cssClass = cssMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const linkPattern = new RegExp(`<a class="whiteitem ${cssClass}"[^>]*>([\\s\\S]*?)<\\/a>`, "gi");
    const links = [...chunk.matchAll(linkPattern)]
      .map(match => decodeHtml(match[1]))
      .filter(Boolean);
    if (!metadataMatch || links.length === 0) continue;

    const properties = [...chunk.matchAll(/<div class="property">([\s\S]*?)<\/div>/gi)]
      .map(match => decodeHtml(match[1]));
    const requirementMatch = chunk.match(/<div class="requirements">([\s\S]*?)<\/div>/i);
    const implicits = [...chunk.matchAll(/<div class="implicitMod">([\s\S]*?)<\/div>/gi)]
      .map(match => decodeHtml(match[1]));
    const physical = properties.find(value => /Physical.*Damage|Physischer Schaden/i.test(value));

    bases.push({
      id: decodeURIComponent(metadataMatch[1]).replaceAll("%5C", "/").replaceAll("\\", "/"),
      name: links.at(-1),
      values: {
        properties,
        physicalDamage: physical?.match(/(\d+)\s*[-–]\s*(\d+)/)?.slice(1).map(Number) ?? null,
        criticalHitChance: Number(properties.find(value => /Critical Hit|Kritische Treffer/i.test(value))?.match(/([\d.]+)%/)?.[1] ?? 0),
        attacksPerSecond: Number(properties.find(value => /Attacks per Second|Angriffe pro Sekunde/i.test(value))?.match(/([\d.]+)\s*$/)?.[1] ?? 0),
        weaponRange: Number(properties.find(value => /Weapon Range|Waffenreichweite/i.test(value))?.match(/([\d.]+)\s*$/)?.[1] ?? 0),
        armour: Number(properties.find(value => /^Armour:/i.test(value))?.match(/([\d.]+)\s*$/)?.[1] ?? 0),
        evasion: Number(properties.find(value => /^Evasion Rating:/i.test(value))?.match(/([\d.]+)\s*$/)?.[1] ?? 0),
        energyShield: Number(properties.find(value => /^Energy Shield:/i.test(value))?.match(/([\d.]+)\s*$/)?.[1] ?? 0),
        blockChance: Number(properties.find(value => /Block Chance:/i.test(value))?.match(/([\d.]+)%/)?.[1] ?? 0),
        movementSpeedModifier: Number(properties.find(value => /Movement Speed:/i.test(value))?.match(/([-+\d.]+)%/)?.[1] ?? 0)
      },
      requirements: parseRequirement(decodeHtml(requirementMatch?.[1] ?? "")),
      implicits
    });
  }

  return bases;
}

function localizedBases(english, german) {
  for (const [language, rows] of [["english", english], ["german", german]]) {
    const ids = rows.map(base => base.id);
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    if (duplicate) throw new Error(`Mehrdeutige ${language} Basis-ID: ${duplicate}`);
  }
  const germanById = new Map(german.map(base => [base.id, base]));
  return english.map(base => {
    const translated = germanById.get(base.id);
    return {
      id: base.id,
      nameEn: base.name,
      nameDe: translated?.name ?? null,
      values: base.values,
      requirements: base.requirements,
      implicits: base.implicits.map((textEn, index) => ({
        textEn,
        textDe: translated?.implicits[index] ?? null
      }))
    };
  });
}

function classifyBase(base, raw) {
  const tags = raw.tags ?? [];
  const isSpecial = tags.some(tag => [
    "runeforged", "experimental_base", "desecrated", "grasping_mail"
  ].includes(tag)) || /Verisium|Experimented|Heist|Lake|Grasping|Abyss|Breach|Ritual|Delirium/i.test(base.id);
  const released = raw.release_state === "released";
  const droppable = released && Number(raw.drop_level) > 0;
  let classification = "regular";
  let reason = "Released equipment base with a positive drop level.";

  if (!released) {
    classification = raw.release_state === "unreleased" ? "future" : "experimental";
    reason = `Release state is ${raw.release_state ?? "unknown"}.`;
  } else if (!droppable) {
    classification = "hidden";
    reason = "No positive drop level is present.";
  } else if (isSpecial) {
    classification = "special-variant";
    reason = "Runeforged/Verisium variant with its own internal base tag.";
  }

  return {
    ...base,
    dropLevel: Number(raw.drop_level ?? 0),
    tags,
    internal: {
      metadataId: base.id,
      inheritsFrom: raw.inherits_from ?? null,
      domain: raw.domain ?? null,
      releaseState: raw.release_state ?? "unknown"
    },
    availability: {
      droppable,
      classification,
      regularUsable: classification === "regular",
      reason
    }
  };
}

function modJoinKey(row, occurrences) {
  const base = modStructuralKey(row);
  const occurrence = occurrences.get(base) ?? 0;
  occurrences.set(base, occurrence + 1);
  return `${base}|${occurrence}`;
}

function modStructuralKey(row) {
  const keywordIds = [...String(row.str ?? "").matchAll(/data-keyword=\\?"([^"\\]+)\\?"/g)]
    .map(match => match[1]);
  return [
    row.ModGenerationTypeID,
    row.Level,
    row.DropChance,
    ...(row.ModFamilyList ?? []),
    `spawn:${(row.spawn_no ?? []).join(",")}`,
    `fossil:${(row.fossil_no ?? []).join(",")}`,
    `adds:${(row.adds_no ?? []).join(",")}`,
    `keywords:${keywordIds.join(",")}`
  ].join("|");
}

function classMods(document, selectorTags) {
  const selected = new Set(selectorTags);
  const rows = (document.normal ?? []).filter(row =>
    ["1", "2"].includes(String(row.ModGenerationTypeID))
    && Array.isArray(row.spawn_no)
    && row.spawn_no.some(tag => selected.has(tag))
    && Number(row.DropChance) > 0
  );
  const seen = new Set();
  return rows.filter(row => {
    const key = `${modStructuralKey(row)}|text:${decodeHtml(row.str)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function localizeMods(englishDocument, germanDocument, selectorTags) {
  const english = classMods(englishDocument, selectorTags);
  const german = classMods(germanDocument, selectorTags);
  const germanGroups = Map.groupBy(german, modStructuralKey);
  const joined = [];
  for (const [baseKey, englishRows] of Map.groupBy(english, modStructuralKey)) {
    const germanRows = germanGroups.get(baseKey) ?? [];
    if (englishRows.length === 1) {
      joined.push({ row: englishRows[0], translated: germanRows[0] ?? null, key: baseKey });
      continue;
    }

    const technicalId = row => decodeURIComponent(String(row.hover ?? ""))
      .match(/[\\/]Mods[\\/]([^?&#]+)/)?.[1] ?? null;
    const remainingGerman = new Set(germanRows);
    const pairs = englishRows.map(row => {
      const id = technicalId(row);
      const matches = id ? [...remainingGerman].filter(candidate => technicalId(candidate) === id) : [];
      if (matches.length > 1) throw new Error(`Mehrdeutige deutsche Mod-Zuordnung: ${baseKey} (${id})`);
      const translated = matches[0] ?? null;
      if (translated) remainingGerman.delete(translated);
      return { row, translated, id };
    });
    const unresolved = pairs.filter(pair => !pair.translated);
    if (unresolved.length === 1 && remainingGerman.size === 1) {
      unresolved[0].translated = [...remainingGerman][0];
      remainingGerman.clear();
    }
    if (pairs.some(pair => !pair.translated) && germanRows.length > 0) {
      throw new Error(`Mehrdeutige englisch/deutsche Mod-Zuordnung: ${baseKey}`);
    }
    for (const pair of pairs) {
      joined.push({
        row: pair.row,
        translated: pair.translated,
        key: `${baseKey}|technical:${pair.id ?? technicalId(pair.translated) ?? "untranslated"}`
      });
    }
  }

  const familyGroups = new Map();
  for (const entry of joined) {
    const family = `${entry.row.ModGenerationTypeID}|${(entry.row.ModFamilyList ?? []).join("+")}`;
    if (!familyGroups.has(family)) familyGroups.set(family, []);
    familyGroups.get(family).push(entry);
  }

  const tiers = new Map();
  for (const entries of familyGroups.values()) {
    entries
      .slice()
      .sort((a, b) => Number(b.row.Level) - Number(a.row.Level))
      .forEach((entry, index) => tiers.set(entry.key, index + 1));
  }

  return joined.map(({ row, translated, key }) => ({
    id: `poe2db:${sha256(key).slice(0, 20)}`,
    nameEn: decodeHtml(row.Name),
    nameDe: translated ? decodeHtml(translated.Name) : null,
    textEn: decodeHtml(row.str),
    textDe: translated ? decodeHtml(translated.str) : null,
    itemLevel: Number(row.Level),
    tier: tiers.get(key),
    spawnWeight: Number(row.DropChance),
    family: row.ModFamilyList ?? [],
    poe2dbSpawnTags: row.spawn_no ?? [],
    poe2dbFossilTags: row.fossil_no ?? [],
    generationType: String(row.ModGenerationTypeID) === "1" ? "prefix" : "suffix"
  }));
}

function mergeLocalizedMods(groups) {
  const byId = new Map();
  for (const mod of groups.flat()) {
    const existing = byId.get(mod.id);
    if (existing && (
      existing.textEn !== mod.textEn
      || existing.textDe !== mod.textDe
      || existing.generationType !== mod.generationType
    )) {
      throw new Error(`Mehrdeutiger Mod über mehrere PoE2DB-Unterseiten: ${mod.id}`);
    }
    if (!existing) byId.set(mod.id, mod);
  }
  return [...byId.values()];
}

function attachWeightRules(mods, repoeMods, bases, domain = "item") {
  return mods.map(mod => {
    const candidates = Object.entries(repoeMods).filter(([, row]) =>
      row.domain === domain
      && row.is_essence_only !== true
      && row.name === mod.nameEn
      && Number(row.required_level) === mod.itemLevel
      && row.generation_type === mod.generationType
      && mod.family.every(family => (row.groups ?? []).includes(family))
      && row.spawn_weights?.some(weight =>
        Number(weight.weight) > 0 && mod.poe2dbSpawnTags.includes(weight.tag)
      )
      && bases.some(base => firstMatchingWeight(row.spawn_weights, base.tags).weight > 0)
    );

    if (candidates.length !== 1) {
      throw new Error(`Gewichtsregel für ${mod.nameEn} (iLvl ${mod.itemLevel}) ist nicht eindeutig: ${candidates.length}`);
    }

    const [sourceId, row] = candidates[0];
    return {
      ...mod,
      sourceId,
      spawnWeights: row.spawn_weights ?? [],
      generationWeights: row.generation_weights ?? []
    };
  });
}

function firstMatchingWeight(rows, tags) {
  for (const row of rows ?? []) {
    if (tags.includes(row.tag)) {
      return { matchedTag: row.tag, weight: Number(row.weight ?? 0) };
    }
  }
  return { matchedTag: null, weight: 0 };
}

function buildPools(bases, prefixes, suffixes) {
  return bases.map(base => {
    const evaluate = mod => {
      const spawn = firstMatchingWeight(mod.spawnWeights, base.tags);
      const generation = mod.generationWeights.length
        ? firstMatchingWeight(mod.generationWeights, base.tags)
        : { matchedTag: null, weight: 1 };
      const allowed = spawn.weight > 0 && generation.weight > 0;
      return {
        modId: mod.id,
        allowed,
        spawnWeight: spawn.weight,
        spawnMatchedTag: spawn.matchedTag,
        generationWeight: generation.weight,
        generationMatchedTag: generation.matchedTag,
        poe2dbDropChance: mod.spawnWeight
      };
    };

    const prefixEvaluations = prefixes.map(evaluate);
    const suffixEvaluations = suffixes.map(evaluate);
    return {
      baseId: base.id,
      checkedTags: base.tags,
      evaluatedPrefixRules: prefixEvaluations.length,
      evaluatedSuffixRules: suffixEvaluations.length,
      prefixes: prefixEvaluations.filter(row => row.allowed),
      suffixes: suffixEvaluations.filter(row => row.allowed),
      rejectedPrefixes: prefixEvaluations.filter(row => !row.allowed),
      rejectedSuffixes: suffixEvaluations.filter(row => !row.allowed)
    };
  });
}

function poolSignature(pool, type) {
  return pool[type].map(row => row.modId).sort().join("|");
}

function buildQualityReport(config, bases, prefixes, suffixes, pools) {
  const regular = bases.filter(base => base.availability.regularUsable);
  const excluded = bases.filter(base => !base.availability.regularUsable);
  const prefixPools = new Set(pools.map(pool => poolSignature(pool, "prefixes")));
  const suffixPools = new Set(pools.map(pool => poolSignature(pool, "suffixes")));
  const allMods = [...prefixes, ...suffixes];
  const restricted = allMods
    .map(mod => ({
      modId: mod.id,
      nameEn: mod.nameEn,
      textDe: mod.textDe,
      allowedBaseCount: pools.filter(pool =>
        [...pool.prefixes, ...pool.suffixes].some(row => row.modId === mod.id)
      ).length
    }))
    .filter(mod => mod.allowedBaseCount < bases.length)
    .slice(0, 5);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: {
      baseMetadata: "RePoE base_items raw data, joined by the PoE2DB Metadata ID.",
      modifierSelection: `PoE2DB embedded ModsView JSON for ${config.itemClass}.`,
      weightEvaluation: "Ordered first matching spawn/generation weight from RePoE raw mod data; PoE2DB DropChance retained separately.",
      importantFinding: `PoE2DB embeds only the already selected ${config.itemClass} DropChance and tag names, not complete per-tag numeric weights.`
    },
    counts: {
      importedBases: bases.length,
      regularUsableBases: regular.length,
      excludedBases: excluded.length,
      distinctPrefixPools: prefixPools.size,
      distinctSuffixPools: suffixPools.size
    },
    localization: {
      missingGermanBaseNames: bases
        .filter(base => !base.nameDe)
        .map(base => ({ id: base.id, nameEn: base.nameEn })),
      missingGermanImplicits: bases.flatMap(base => base.implicits
        .filter(implicit => !implicit.textDe)
        .map(implicit => ({ baseId: base.id, baseNameEn: base.nameEn, textEn: implicit.textEn }))),
      missingGermanModifierTexts: allMods
        .filter(mod => !mod.textDe)
        .map(mod => ({ id: mod.id, nameEn: mod.nameEn, textEn: mod.textEn })),
      ambiguousTranslations: []
    },
    excludedBases: excluded.map(base => ({
      id: base.id,
      nameEn: base.nameEn,
      classification: base.availability.classification,
      reason: base.availability.reason
    })),
    restrictedModExamples: restricted,
    restrictedModFinding: restricted.length
      ? `At least one imported modifier is not available to every imported ${config.itemClass} base.`
      : `No such examples exist: every imported normal ${config.itemClass} modifier matches the shared '${config.tag}' tag before any zero-weight fallback. Extra base tags do not occur in these modifiers' weight rules.`,
    bases: bases.map(base => ({
      id: base.id,
      nameEn: base.nameEn,
      nameDe: base.nameDe,
      dropLevel: base.dropLevel,
      requirements: base.requirements,
      tags: base.tags,
      internal: base.internal,
      availability: base.availability
    }))
  };
}

function validate(result) {
  const errors = [];
  if (result.bases.length === 0) errors.push(`Keine Basen gefunden: ${result.scope}`);
  if (result.prefixes.length === 0) errors.push(`Keine Präfixe gefunden: ${result.scope}`);
  if (result.suffixes.length === 0) errors.push(`Keine Suffixe gefunden: ${result.scope}`);
  if (!result.bases.some(base => base.nameDe)) errors.push("Keine deutschen Basisnamen gefunden.");
  if (![...result.prefixes, ...result.suffixes].some(mod => mod.textDe)) errors.push("Keine deutschen Modtexte gefunden.");
  if (result.pools.length !== result.bases.length) errors.push("Nicht jede Basis besitzt einen berechneten Pool.");
  for (const pool of result.pools) {
    if (pool.evaluatedPrefixRules !== result.prefixes.length || pool.evaluatedSuffixRules !== result.suffixes.length) {
      errors.push(`Gewichtsregeln wurden nicht vollständig geprüft: ${pool.baseId}`);
    }
    if ([...pool.prefixes, ...pool.suffixes].some(row => row.spawnWeight <= 0 || row.generationWeight <= 0)) {
      errors.push(`Pool enthält eine Nullgewichts-Mod: ${pool.baseId}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

async function main() {
  const repoeBases = readJson(repoeBasePath);
  const repoeMods = readJson(repoeModPath);
  const generatedAt = new Date().toISOString();
  ensureDir(outputRoot);
  const indexClasses = [];
  const rawFiles = {};

  for (const config of CLASS_CONFIGS) {
    const sourcePages = [...new Set([config.page, ...(config.modPages ?? []).map(entry => entry.page)])];
    const sourceEntries = sourcePages.flatMap(page => ["english", "german"].map(language => {
      const locale = language === "english" ? "us" : "de";
      const snapshotKey = page === config.page
        ? config.key
        : `${config.key}--${page.toLowerCase().replaceAll("_", "-")}`;
      return { page, language, snapshotKey, url: `https://poe2db.tw/${locale}/${page}` };
    }));
    const snapshotRows = await Promise.all(sourceEntries.map(async entry => ({
      ...entry,
      html: await download(config, entry.language, entry.url, entry.snapshotKey)
    })));
    const snapshots = new Map();
    for (const row of snapshotRows) {
      snapshots.set(`${row.page}:${row.language}`, row.html);
      rawFiles[`${row.language}-${row.snapshotKey}.html`] = {
        url: row.url,
        bytes: Buffer.byteLength(row.html),
        sha256: sha256(row.html)
      };
    }
    const basePages = {
      english: `https://poe2db.tw/us/${config.page}`,
      german: `https://poe2db.tw/de/${config.page}`
    };
    const modPages = config.modPages ?? [{ page: config.page, selectorTags: config.selectorTags ?? [config.tag] }];
    const englishHtml = snapshots.get(`${config.page}:english`);
    const germanHtml = snapshots.get(`${config.page}:german`);
    const bases = localizedBases(
      parseBasePage(englishHtml, config),
      parseBasePage(germanHtml, config)
    ).map(base => {
      const raw = repoeBases[base.id];
      if (!raw) throw new Error(`Interne Basisdaten fehlen: ${base.id}`);
      return classifyBase(base, raw);
    });
    const localizedGroups = modPages.map(modPage => localizeMods(
      parseModsView(snapshots.get(`${modPage.page}:english`)),
      parseModsView(snapshots.get(`${modPage.page}:german`)),
      modPage.selectorTags
    ));
    const mods = attachWeightRules(
      mergeLocalizedMods(localizedGroups),
      repoeMods,
      bases,
      config.itemClass === "Jewel" ? "misc" : "item"
    );
    const prefixes = mods.filter(mod => mod.generationType === "prefix");
    const suffixes = mods.filter(mod => mod.generationType === "suffix");
    const pools = buildPools(bases, prefixes, suffixes);
    const result = {
      schemaVersion: 2,
      generatedAt,
      scope: config.itemClass,
      source: {
        site: "PoE2DB",
        pages: {
          bases: basePages,
          modifiers: modPages.map(modPage => ({
            page: modPage.page,
            selectorTags: modPage.selectorTags,
            english: `https://poe2db.tw/us/${modPage.page}`,
            german: `https://poe2db.tw/de/${modPage.page}`
          }))
        },
        strategy: {
          bases: `HTML cards on ${config.page}`,
          modifiers: "embedded JSON passed to new ModsView(...)",
          technicalWeightsAndIds: "RePoE raw data"
        }
      },
      counts: { bases: bases.length, prefixes: prefixes.length, suffixes: suffixes.length },
      bases,
      prefixes,
      suffixes,
      pools
    };
    validate(result);
    const qualityReport = buildQualityReport(config, bases, prefixes, suffixes, pools);
    writeJson(path.join(outputRoot, `${config.key}.json`), result);
    writeJson(path.join(outputRoot, `${config.key}-quality-report.json`), qualityReport);
    indexClasses.push({
      key: config.key,
      itemClass: config.itemClass,
      dataFile: `${config.key}.json`,
      qualityReportFile: `${config.key}-quality-report.json`,
      counts: result.counts,
      poolCounts: {
        prefixes: qualityReport.counts.distinctPrefixPools,
        suffixes: qualityReport.counts.distinctSuffixPools
      }
    });
    console.log(`${config.itemClass}: Basen ${bases.length}, Präfixe ${prefixes.length}, Suffixe ${suffixes.length}`);
  }

  writeJson(path.join(outputRoot, "index.json"), {
    schemaVersion: 2,
    generatedAt,
    classes: indexClasses
  });
  const manifest = {
    schemaVersion: 2,
    generatedAt,
    status: "validated-craftable-equipment-classes",
    supportedClassTarget: "All requested normal weapon, armour, off-hand, jewellery, and jewel classes.",
    sources: {
      primary: "PoE2DB English and German pages",
      technicalSupplement: "RePoE only for IDs and complete ordered weight rules"
    },
    classes: indexClasses,
    files: rawFiles
  };
  writeJson(path.join(outputRoot, "manifest.json"), manifest);
  writeJson(path.join(rawRoot, "manifest.json"), {
    schemaVersion: 1,
    generatedAt,
    discovery: {
      separateJsonOrXhrFound: false,
      embeddedStructuredDataFound: true,
      note: "Affix data is embedded as JSON; HTML is used only for base item cards."
    },
    files: rawFiles
  });
  console.log(`Index: ${path.relative(root, path.join(outputRoot, "index.json"))}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
