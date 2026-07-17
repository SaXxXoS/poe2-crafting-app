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
  { key: "sceptres", itemClass: "Sceptre", tag: "sceptre", page: "Sceptres" }
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

async function download(config, language, url) {
  const filePath = path.join(rawRoot, `${language}-${config.key}.html`);

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
  const end = html.indexOf("new ModsView(", start);
  if (start < 0 || end < 0) throw new Error("Speer-Basisabschnitt fehlt.");
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
        weaponRange: Number(properties.find(value => /Weapon Range|Waffenreichweite/i.test(value))?.match(/([\d.]+)\s*$/)?.[1] ?? 0)
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
  const isSpecial = tags.includes("runeforged") || /Verisium/i.test(base.id);
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
  return [
    row.ModGenerationTypeID,
    row.Level,
    row.DropChance,
    ...(row.ModFamilyList ?? []),
    `spawn:${(row.spawn_no ?? []).join(",")}`,
    `fossil:${(row.fossil_no ?? []).join(",")}`,
    `adds:${(row.adds_no ?? []).join(",")}`
  ].join("|");
}

function classMods(document, classTag) {
  return (document.normal ?? []).filter(row =>
    ["1", "2"].includes(String(row.ModGenerationTypeID))
    && Array.isArray(row.spawn_no)
    && row.spawn_no.includes(classTag)
    && Number(row.DropChance) > 0
  );
}

function localizeMods(englishDocument, germanDocument, classTag) {
  const english = classMods(englishDocument, classTag);
  const german = classMods(germanDocument, classTag);
  for (const [language, rows] of [["english", english], ["german", german]]) {
    const keys = rows.map(modStructuralKey);
    const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
    if (duplicate) throw new Error(`Mehrdeutige ${language} Mod-Zuordnung: ${duplicate}`);
  }
  const germanOccurrences = new Map();
  const germanByKey = new Map(german.map(row => [modJoinKey(row, germanOccurrences), row]));
  const englishOccurrences = new Map();

  const joined = english.map(row => {
    const key = modJoinKey(row, englishOccurrences);
    const translated = germanByKey.get(key);
    return { row, translated, key };
  });

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
    generationType: String(row.ModGenerationTypeID) === "1" ? "prefix" : "suffix"
  }));
}

function attachWeightRules(mods, repoeMods, classTag, bases) {
  return mods.map(mod => {
    const candidates = Object.entries(repoeMods).filter(([, row]) =>
      row.domain === "item"
      && row.is_essence_only !== true
      && row.name === mod.nameEn
      && Number(row.required_level) === mod.itemLevel
      && row.generation_type === mod.generationType
      && mod.family.every(family => (row.groups ?? []).includes(family))
      && row.spawn_weights?.some(weight => weight.tag === classTag && Number(weight.weight) > 0)
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
  const snapshots = new Map(await Promise.all(
    CLASS_CONFIGS.flatMap(config => ["english", "german"].map(async language => {
      const locale = language === "english" ? "us" : "de";
      const url = `https://poe2db.tw/${locale}/${config.page}`;
      return [`${config.key}:${language}`, await download(config, language, url)];
    }))
  ));

  for (const config of CLASS_CONFIGS) {
    const pages = {
      english: `https://poe2db.tw/us/${config.page}`,
      german: `https://poe2db.tw/de/${config.page}`
    };
    const englishHtml = snapshots.get(`${config.key}:english`);
    const germanHtml = snapshots.get(`${config.key}:german`);
    const englishMods = parseModsView(englishHtml);
    const germanMods = parseModsView(germanHtml);
    const bases = localizedBases(
      parseBasePage(englishHtml, config),
      parseBasePage(germanHtml, config)
    ).map(base => {
      const raw = repoeBases[base.id];
      if (!raw) throw new Error(`Interne Basisdaten fehlen: ${base.id}`);
      return classifyBase(base, raw);
    });
    const mods = attachWeightRules(
      localizeMods(englishMods, germanMods, config.tag),
      repoeMods,
      config.tag,
      bases
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
        pages,
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
    rawFiles[`english-${config.key}.html`] = {
      url: pages.english,
      bytes: Buffer.byteLength(englishHtml),
      sha256: sha256(englishHtml)
    };
    rawFiles[`german-${config.key}.html`] = {
      url: pages.german,
      bytes: Buffer.byteLength(germanHtml),
      sha256: sha256(germanHtml)
    };
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
    status: "validated-normal-weapon-classes",
    supportedClassTarget: "All requested normal ExileForge weapon classes.",
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
