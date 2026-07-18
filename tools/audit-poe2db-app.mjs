#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const sourceRoot = path.join(root, "generated", "poe2db");
const appRoot = path.join(sourceRoot, "app");
const auditRoot = path.join(appRoot, "audit");
const index = readJson(path.join(sourceRoot, "index.json"));
const appIndex = readJson(path.join(appRoot, "index.json"));
const appMods = readJson(path.join(appRoot, "mods.json")).mods;
const repoeMods = readJson(path.join(root, "generated", "repoe", "raw", "mods.min.json"));
const rawManifest = readJson(path.join(sourceRoot, "raw", "manifest.json"));
const appModById = new Map(appMods.map(mod => [mod.modId, mod]));
const browserAuditPath = path.join(auditRoot, "browser-dom-results.json");
const browserAudit = fs.existsSync(browserAuditPath) ? readJson(browserAuditPath) : null;
const browserByClass = new Map((browserAudit?.classes ?? []).map(row => [row.itemClass, row]));
const baselineRef = process.argv.find(argument => argument.startsWith("--baseline-ref="))?.split("=")[1] ?? null;
const gitExecutable = process.env.GIT_EXECUTABLE || "git";
const previousAuditSummary = fs.existsSync(path.join(auditRoot, "audit-summary.json")) ? readJson(path.join(auditRoot, "audit-summary.json")) : null;
const previousMissingImport = fs.existsSync(path.join(auditRoot, "missing-from-import.json")) ? readJson(path.join(auditRoot, "missing-from-import.json")) : null;
const rawFileByUrl = new Map(Object.entries(rawManifest.files).map(([file, value]) => [value.url, file]));
const repoeByIdentity = new Map();
for (const [sourceId, row] of Object.entries(repoeMods)) {
  const key = `${row.domain}|${row.name}|${Number(row.required_level)}|${row.generation_type}`;
  if (!repoeByIdentity.has(key)) repoeByIdentity.set(key, []);
  repoeByIdentity.get(key).push([sourceId, row]);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readGitJson(relativeFile) {
  const content = execFileSync(gitExecutable, ["show", `${baselineRef}:${relativeFile.replaceAll("\\", "/")}`], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  return JSON.parse(content);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function extractBalancedObject(source, marker) {
  const markerIndex = source.indexOf(marker);
  const start = source.indexOf("{", markerIndex + marker.length);
  if (markerIndex < 0 || start < 0) throw new Error(`Eingebettete Daten fehlen: ${marker}`);
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
    if (char === '"') quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return JSON.parse(source.slice(start, index + 1));
  }
  throw new Error("Unvollständiges ModsView-JSON");
}

function structuralKey(row) {
  const keywordIds = [...String(row.str ?? "").matchAll(/data-keyword=\\?"([^"\\]+)\\?"/g)].map(match => match[1]);
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

function technicalId(row) {
  const candidate = [row.hover, row.data_hover, row.Name, row.str].find(value => /(?:%5C|[\\/])Mods(?:%2F|[\\/])/i.test(String(value ?? "")));
  const decoded = decodeURIComponent(String(candidate ?? "").replaceAll("%5C", "/").replaceAll("\\", "/"));
  return decoded.match(/(?:^|\/)Mods\/([^?&#"'<\s]+)/)?.[1] ?? null;
}

function sourceRows(document) {
  const eligible = (document.normal ?? []).filter(row =>
    ["1", "2"].includes(String(row.ModGenerationTypeID)) && Number(row.DropChance) > 0
  );
  const unique = [];
  const seen = new Set();
  for (const row of eligible) {
    const key = `${structuralKey(row)}|text:${decodeHtml(row.str)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(row);
    }
  }
  const result = [];
  for (const [baseKey, rows] of Map.groupBy(unique, structuralKey)) {
    for (const row of rows) {
      const key = rows.length === 1 ? baseKey : `${baseKey}|technical:${technicalId(row) ?? "untranslated"}`;
      result.push({
        modId: `poe2db:${sha256(`${key}|text:${decodeHtml(row.str)}`).slice(0, 20)}`,
        technicalId: technicalId(row),
        generationType: String(row.ModGenerationTypeID) === "1" ? "prefix" : "suffix",
        itemLevel: Number(row.Level),
        dropChance: Number(row.DropChance),
        nameEn: decodeHtml(row.Name),
        textEn: decodeHtml(row.str),
        families: row.ModFamilyList ?? [],
        spawnTags: row.spawn_no ?? []
      });
    }
  }
  return result;
}

function mergeSourcePages(document) {
  const byId = new Map();
  for (const page of document.source.pages.modifiers) {
    const rawFile = rawFileByUrl.get(page.english);
    if (!rawFile) throw new Error(`Roh-Snapshot fehlt für ${page.english}`);
    const html = fs.readFileSync(path.join(sourceRoot, "raw", rawFile), "utf8");
    for (const row of sourceRows(extractBalancedObject(html, "new ModsView("))) {
      const existing = byId.get(row.modId);
      if (existing && (existing.textEn !== row.textEn || existing.generationType !== row.generationType)) {
        const scopedId = `poe2db:${sha256(`${row.modId}|${page.english}|${row.textEn}`).slice(0, 20)}`;
        byId.set(scopedId, { ...row, modId: scopedId, pages: [page.english], sourceCollisionWith: row.modId });
        continue;
      }
      if (!existing) byId.set(row.modId, { ...row, pages: [page.english] });
      else if (!existing.pages.includes(page.english)) existing.pages.push(page.english);
    }
  }
  return [...byId.values()];
}

function firstMatchingWeight(rows, tags) {
  for (const row of rows ?? []) if (tags.includes(row.tag)) return Number(row.weight ?? 0);
  return 0;
}

function resolveApplicableSourceMods(source, bases, domain) {
  const applicableById = new Map();
  const excluded = [];
  for (const mod of source) {
    const identity = `${domain}|${mod.nameEn}|${mod.itemLevel}|${mod.generationType}`;
    const candidates = (repoeByIdentity.get(identity) ?? []).filter(([, row]) =>
      row.is_essence_only !== true
      && mod.families.every(family => (row.groups ?? []).includes(family))
      && row.spawn_weights?.some(weight => Number(weight.weight) > 0 && mod.spawnTags.includes(weight.tag))
      && bases.some(base => {
        const spawn = firstMatchingWeight(row.spawn_weights, base.tags);
        const generation = row.generation_weights?.length ? firstMatchingWeight(row.generation_weights, base.tags) : 1;
        return spawn > 0 && generation > 0;
      })
    );
    if (candidates.length === 1) {
      const resolved = { ...mod, technicalId: candidates[0][0] };
      const existing = applicableById.get(resolved.technicalId);
      if (existing && (existing.textEn !== resolved.textEn || existing.generationType !== resolved.generationType)) {
        throw new Error(`Widersprüchliche PoE2DB-Quelle für ${resolved.technicalId}`);
      }
      if (!existing) applicableById.set(resolved.technicalId, resolved);
    } else {
      excluded.push({ ...mod, reason: candidates.length ? `ambiguous-repoe-match:${candidates.length}` : "not-applicable-to-any-regular-base" });
    }
  }
  return { applicable: [...applicableById.values()], excluded };
}

const FAMILY_PATTERNS = [
  ["increased-physical-damage", /increased physical damage|erhöhter physischer schaden/i],
  ["added-physical-damage", /adds? .* physical damage|physischer.*schaden hinzu/i],
  ["attack-speed", /attack speed|angriffsgeschwindigkeit/i],
  ["critical-strike-chance", /critical (?:hit|strike) chance|kritische.*trefferchance/i],
  ["critical-strike-multiplier", /critical.*(?:damage bonus|multiplier)|kritischer.*(?:schadensbonus|multiplikator)/i],
  ["accuracy", /accuracy|genauigkeit/i],
  ["fire-damage", /fire damage|feuerschaden/i],
  ["cold-damage", /cold damage|kälteschaden/i],
  ["lightning-damage", /lightning damage|blitzschaden/i],
  ["elemental-damage", /elemental damage|elementarschaden/i],
  ["projectile", /projectile|arrow|projektil|pfeil/i],
  ["armour", /armour|rüstung/i],
  ["evasion", /evasion|ausweich/i],
  ["energy-shield", /energy shield|energieschild/i],
  ["life", /\blife\b|\bleben\b/i],
  ["mana", /\bmana\b/i],
  ["attributes", /strength|dexterity|intelligence|stärke|geschick|intelligenz/i],
  ["resistances", /resistance|widerstand/i],
  ["movement-speed", /movement speed|bewegungsgeschwindigkeit/i],
  ["block", /\bblock|\bblocken/i],
  ["gem-skill-level", /level of all|level of .* skills|stufe aller|stufe von/i],
  ["ailment", /ailment|ignite|shock|freeze|poison|bleed|entzünd|schock|einfrier|gift|blutung/i],
  ["minion", /minion|kreatur/i],
  ["spirit", /\bspirit\b|\bgeist\b/i],
  ["recovery-flask-charm", /recover|recovery|flask|charm|wiederherstell|fläschchen|talisman/i],
  ["leech-gain", /leech|gained? on hit|gewinn.*treffer|raub/i],
  ["stun", /stun|betäub/i]
];

function semanticFamilies(mods) {
  const result = {};
  for (const [family, pattern] of FAMILY_PATTERNS) {
    const ids = mods.filter(mod => pattern.test(`${mod.textEn ?? ""} ${mod.displayText ?? ""}`)).map(mod => mod.modId);
    if (ids.length) result[family] = ids;
  }
  return result;
}

function difference(left, right) {
  return [...left].filter(value => !right.has(value));
}

function details(ids, sourceById, importById) {
  return ids.map(modId => {
    const mod = sourceById.get(modId) ?? importById.get(modId) ?? appModById.get(modId);
    return { modId, poe2dbId: mod?.poe2dbId ?? mod?.modId ?? mod?.id ?? null, generationType: mod?.generationType ?? null, itemLevel: mod?.itemLevel ?? mod?.requiredLevel ?? null, textEn: mod?.textEn ?? mod?.displayTextEn ?? null, families: mod?.families ?? mod?.family ?? mod?.groups ?? [], spawnTags: mod?.spawnTags ?? mod?.poe2dbSpawnTags ?? [] };
  });
}

const classCounts = [];
const missingFromImport = [];
const missingFromPools = [];
const missingFromUi = [];
const unexpectedExtraMods = [];
const familyCoverage = [];
const sourceExclusions = [];
const baselineMissingFromImport = [];
const baselineClassCounts = [];
const globalStageIds = { poe2db: new Set(), imported: new Set(), importPool: new Set(), adapterPool: new Set(), visible: new Set() };

for (const classEntry of index.classes) {
  const document = readJson(path.join(sourceRoot, classEntry.dataFile));
  const regularBases = document.bases.filter(base => base.availability?.regularUsable !== false);
  const resolvedSource = resolveApplicableSourceMods(mergeSourcePages(document), regularBases, classEntry.itemClass === "Jewel" ? "misc" : "item");
  const source = resolvedSource.applicable;
  sourceExclusions.push({ itemClass: classEntry.itemClass, count: resolvedSource.excluded.length, mods: resolvedSource.excluded });
  const imported = [...document.prefixes, ...document.suffixes];
  const regularBaseIds = new Set(regularBases.map(base => base.id));
  const importedById = new Map(imported.map(mod => [mod.sourceId, { ...mod, modId: mod.sourceId, poe2dbId: mod.id }]));
  const importedSourceByPoe2dbId = new Map(imported.map(mod => [mod.id, mod.sourceId]));
  const sourceById = new Map(source.map(mod => [mod.technicalId, { ...mod, poe2dbId: mod.modId, modId: mod.technicalId }]));
  const importedIds = new Set(importedById.keys());
  const sourceIds = new Set(sourceById.keys());
  const importPools = document.pools.filter(pool => regularBaseIds.has(pool.baseId));
  const importPoolIds = new Set(importPools.flatMap(pool => [...pool.prefixes, ...pool.suffixes].map(entry => importedSourceByPoe2dbId.get(entry.modId)).filter(Boolean)));
  const appPoolFile = path.join(appRoot, appIndex.poolFiles[classEntry.itemClass]);
  const appPools = Object.values(readJson(appPoolFile).pools);
  const appPoolIds = new Set(appPools.flatMap(pool => [...pool.p, ...pool.s].map(entry => appModById.get(entry[0])?.sourceKey).filter(Boolean)));
  const appModBySource = new Map(appMods.map(mod => [mod.sourceKey, mod]));
  const uiDataIds = new Set([...appPoolIds].filter(id => appModBySource.get(id)?.displayText));
  const browserRow = browserByClass.get(classEntry.itemClass);
  const visibleIds = browserRow
    ? new Set([...(browserRow.prefixIds ?? []), ...(browserRow.suffixIds ?? [])].map(id => appModById.get(id)?.sourceKey).filter(Boolean))
    : uiDataIds;
  for (const id of sourceIds) globalStageIds.poe2db.add(id);
  for (const id of importedIds) globalStageIds.imported.add(id);
  for (const id of importPoolIds) globalStageIds.importPool.add(id);
  for (const id of appPoolIds) globalStageIds.adapterPool.add(id);
  for (const id of visibleIds) globalStageIds.visible.add(id);

  let baseline = null;
  if (baselineRef) {
    const previous = readGitJson(`generated/poe2db/${classEntry.dataFile}`);
    const previousMods = [...previous.prefixes, ...previous.suffixes];
    const previousBySource = new Map(previousMods.map(mod => [mod.sourceId, mod]));
    const previousIds = new Set(previousBySource.keys());
    const previousPoe2dbToSource = new Map(previousMods.map(mod => [mod.id, mod.sourceId]));
    const previousPoolIds = new Set(previous.pools.flatMap(pool => [...pool.prefixes, ...pool.suffixes].map(entry => previousPoe2dbToSource.get(entry.modId)).filter(Boolean)));
    const missingIds = difference(sourceIds, previousIds);
    if (missingIds.length) baselineMissingFromImport.push({ itemClass: classEntry.itemClass, count: missingIds.length, mods: details(missingIds, sourceById, previousBySource) });
    const previousCount = type => [...previousIds].filter(id => previousBySource.get(id)?.generationType === type).length;
    const previousPoolCount = type => [...previousPoolIds].filter(id => previousBySource.get(id)?.generationType === type).length;
    baseline = {
      prefixes: { poe2db: source.filter(mod => mod.generationType === "prefix").length, imported: previousCount("prefix"), importPool: previousPoolCount("prefix"), adapterPool: previousPoolCount("prefix"), uiEligible: previousPoolCount("prefix") },
      suffixes: { poe2db: source.filter(mod => mod.generationType === "suffix").length, imported: previousCount("suffix"), importPool: previousPoolCount("suffix"), adapterPool: previousPoolCount("suffix"), uiEligible: previousPoolCount("suffix") }
    };
    baselineClassCounts.push({ itemClass: classEntry.itemClass, ...baseline });
  }

  const stageCounts = type => ({
    poe2db: source.filter(mod => mod.generationType === type).length,
    imported: imported.filter(mod => mod.generationType === type).length,
    importPool: [...importPoolIds].filter(id => importedById.get(id)?.generationType === type).length,
    adapterPool: [...appPoolIds].filter(id => appModBySource.get(id)?.generationType === type).length,
    uiEligible: [...visibleIds].filter(id => appModBySource.get(id)?.generationType === type).length
  });
  classCounts.push({ itemClass: classEntry.itemClass, prefixes: stageCounts("prefix"), suffixes: stageCounts("suffix"), ...(baseline ? { baseline } : {}) });

  const importMissing = difference(sourceIds, importedIds);
  const poolMissing = difference(importedIds, importPoolIds);
  const adapterMissing = difference(importPoolIds, appPoolIds);
  const uiMissing = difference(appPoolIds, visibleIds);
  if (importMissing.length) missingFromImport.push({ itemClass: classEntry.itemClass, count: importMissing.length, mods: details(importMissing, sourceById, importedById) });
  if (poolMissing.length || adapterMissing.length) missingFromPools.push({ itemClass: classEntry.itemClass, missingFromImportPool: details(poolMissing, sourceById, importedById), missingFromAdapterPool: details(adapterMissing, sourceById, importedById) });
  if (uiMissing.length) missingFromUi.push({ itemClass: classEntry.itemClass, count: uiMissing.length, mods: details(uiMissing, sourceById, importedById) });
  const sourceExtras = difference(importedIds, sourceIds);
  const poolExtras = difference(appPoolIds, importedIds);
  const uiExtras = difference(visibleIds, appPoolIds);
  if (sourceExtras.length || poolExtras.length || uiExtras.length) unexpectedExtraMods.push({ itemClass: classEntry.itemClass, importedNotInSource: details(sourceExtras, sourceById, importedById), poolNotImported: details(poolExtras, sourceById, importedById), uiNotInPool: details(uiExtras, sourceById, importedById) });
  familyCoverage.push({
    itemClass: classEntry.itemClass,
    sourceFamilies: semanticFamilies(source.map(mod => ({ ...mod, modId: mod.technicalId }))),
    importedFamilies: semanticFamilies(imported.map(mod => ({ ...mod, modId: mod.sourceId }))),
    technicalGroups: [...new Set(imported.flatMap(mod => mod.family ?? []))].sort()
  });
}

const totals = classCounts.reduce((sum, row) => {
  for (const type of ["prefixes", "suffixes"]) for (const [stage, count] of Object.entries(row[type])) sum[stage] = (sum[stage] ?? 0) + count;
  return sum;
}, {});
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: process.argv.includes("--baseline") ? "baseline" : "verification",
  totals: {
    poe2dbMods: totals.poe2db,
    importedMods: totals.imported,
    importPoolMods: totals.importPool,
    adapterPoolMods: totals.adapterPool,
    visibleEligibleMods: totals.uiEligible,
    countingUnit: "class-to-mod assignments; the same technical mod may validly occur in multiple classes",
    uniqueTechnicalMods: {
      poe2db: globalStageIds.poe2db.size,
      imported: globalStageIds.imported.size,
      importPools: globalStageIds.importPool.size,
      adapterPools: globalStageIds.adapterPool.size,
      visibleEligible: globalStageIds.visible.size
    }
  },
  missing: {
    fromImport: missingFromImport.reduce((sum, row) => sum + row.count, 0),
    fromImportPools: missingFromPools.reduce((sum, row) => sum + row.missingFromImportPool.length, 0),
    fromAdapterPools: missingFromPools.reduce((sum, row) => sum + row.missingFromAdapterPool.length, 0),
    fromUiData: missingFromUi.reduce((sum, row) => sum + row.count, 0)
  },
  affectedClasses: [...new Set([...missingFromImport, ...missingFromPools, ...missingFromUi].map(row => row.itemClass))],
  discoveredCauses: [
    "Der frühere classMods-Vorfilter verlangte eine Überschneidung von PoE2DB spawn_no mit einem manuell konfigurierten Klassentag. Globale reguläre Tags wie weapon, armour und default wurden dadurch vor der vollständigen Gewichtsauswertung verworfen.",
    "Mehrere Rüstungs- und Juwel-Unterseiten lieferten dieselbe technische Mod-ID. Vor der Korrektur waren PoE2DB-Hash-IDs seitenabhängig und konnten dieselbe technische Mod mehrfach repräsentieren.",
    "Die englisch/deutsche Zuordnung mehrerer strukturgleicher Juwel-Zeilen benötigte neben stabilen IDs eine validierte numerische Signatur und stabile Datensatzposition."
  ],
  corrections: [
    "Alle regulären PoE2DB-Normalzeilen mit Präfix-/Suffix-Generation und positiver DropChance werden vor einer Klassenentscheidung eingelesen.",
    "Die Zulässigkeit wird ausschließlich durch die vollständigen geordneten RePoE Spawn- und Generation-Weights gegen sämtliche Tags jeder Basis bestimmt.",
    "Mods werden nach der technischen RePoE-Mod-ID dedupliziert; widersprüchliche Texte, Generation Types oder Item-Level führen zum Fehler.",
    "Tiers werden nach der technischen Deduplizierung pro Generation Type und Modfamilie neu berechnet.",
    "App-Pools und Browser-DOM werden mit Mod-IDs statt nur sichtbaren Texten verglichen."
  ],
  exclusions: [
    { category: "non-normal-poe2db-collections", reason: "Essenzen, Entweihung, Corruption, Crafted-, Monster-, Map- und andere Spezialkollektionen bleiben außerhalb regulärer Zufallspools und werden separat importiert." },
    { category: "non-affix-generation-types", reason: "Nur ModGenerationTypeID 1 (Präfix) und 2 (Suffix) gehören in reguläre Affixpools." },
    { category: "zero-poe2db-dropchance", reason: "Zeilen mit DropChance 0 sind auf der jeweiligen PoE2DB-Seite nicht regulär spawnbar." },
    { category: "zero-effective-weight", reason: "Mods, deren erster passender Spawn- oder Generation-Weight für eine Basis 0 ist, werden aus genau diesem Basispool ausgeschlossen." },
    ...sourceExclusions.filter(row => row.count).map(row => ({ itemClass: row.itemClass, count: row.count, reasons: [...new Set(row.mods.map(mod => mod.reason))] }))
  ]
};

if (baselineRef) {
  const baselineTotals = baselineClassCounts.reduce((sum, row) => {
    for (const type of ["prefixes", "suffixes"]) for (const [stage, count] of Object.entries(row[type])) sum[stage] = (sum[stage] ?? 0) + count;
    return sum;
  }, {});
  summary.baseline = {
    ref: baselineRef,
    totals: { poe2dbMods: baselineTotals.poe2db, importedMods: baselineTotals.imported, importPoolMods: baselineTotals.importPool, adapterPoolMods: baselineTotals.adapterPool, visibleEligibleMods: baselineTotals.uiEligible },
    missingFromImport: baselineMissingFromImport.reduce((sum, row) => sum + row.count, 0),
    affectedClasses: baselineMissingFromImport.map(row => row.itemClass)
  };
} else if (previousAuditSummary?.baseline) {
  summary.baseline = previousAuditSummary.baseline;
}

writeJson(path.join(auditRoot, "class-counts.json"), { schemaVersion: 1, classes: classCounts });
writeJson(path.join(auditRoot, "missing-from-import.json"), {
  schemaVersion: 1,
  classes: missingFromImport,
  ...(baselineRef
    ? { baselineRef, baselineClasses: baselineMissingFromImport }
    : (previousMissingImport?.baselineClasses ? { baselineRef: previousMissingImport.baselineRef, baselineClasses: previousMissingImport.baselineClasses } : {}))
});
writeJson(path.join(auditRoot, "missing-from-pools.json"), { schemaVersion: 1, classes: missingFromPools });
writeJson(path.join(auditRoot, "missing-from-ui.json"), { schemaVersion: 1, classes: missingFromUi });
writeJson(path.join(auditRoot, "unexpected-extra-mods.json"), { schemaVersion: 1, classes: unexpectedExtraMods });
writeJson(path.join(auditRoot, "mod-family-coverage.json"), { schemaVersion: 1, classes: familyCoverage });
writeJson(path.join(auditRoot, "audit-summary.json"), summary);
const auditFiles = ["class-counts.json", "missing-from-import.json", "missing-from-pools.json", "missing-from-ui.json", "unexpected-extra-mods.json", "mod-family-coverage.json", "audit-summary.json", ...(fs.existsSync(browserAuditPath) ? ["browser-dom-results.json"] : [])];
const appManifestPath = path.join(appRoot, "manifest.json");
const appManifest = readJson(appManifestPath);
appManifest.audit = { status: "complete", files: auditFiles.length, affectedClasses: summary.affectedClasses.length };
for (const file of auditFiles) {
  const relative = `audit/${file}`;
  appManifest.files[relative] = { sha256: sha256(fs.readFileSync(path.join(auditRoot, file))) };
}
writeJson(appManifestPath, appManifest);
console.log(JSON.stringify(summary));
