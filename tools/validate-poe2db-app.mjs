#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const appRoot = path.join(root, "generated", "poe2db", "app");
const read = file => JSON.parse(fs.readFileSync(path.join(appRoot, file), "utf8"));

const index = read("index.json");
const bases = read("bases.json").bases;
const mods = read("mods.json").mods;
const manifest = read("manifest.json");
const hashFile = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const modsById = new Map(mods.map(mod => [mod.id, mod]));
const basesByClass = Map.groupBy(bases, base => base.itemClass);
const forbiddenVisiblePattern = /(?:Implicit|LocalChance|AdditionalArrows\d|(?:^|\s)\+%(?:\s|$)|minimaler[^\n]+\+[^\n]+maximaler)/i;

if (index.source !== "generated/poe2db") throw new Error("Adapter verwendet nicht generated/poe2db");
const defaultAffixGroupsFile = path.join(appRoot, "affix-groups.json");
if (fs.existsSync(defaultAffixGroupsFile) && !index.affixGroupsFile) {
  throw new Error("affix-groups.json existiert, aber index.json enthält kein affixGroupsFile");
}
if (typeof index.affixGroupsFile !== "string" || !index.affixGroupsFile.trim()) {
  throw new Error("App-Index deklariert keine Affixgruppen-Datei");
}
const affixGroupsFile = path.resolve(appRoot, index.affixGroupsFile);
if (!affixGroupsFile.startsWith(`${appRoot}${path.sep}`) || !fs.existsSync(affixGroupsFile)) {
  throw new Error(`Deklarierte Affixgruppen-Datei fehlt oder liegt außerhalb des App-Datensatzes: ${index.affixGroupsFile}`);
}
const affixGroupDocument = JSON.parse(fs.readFileSync(affixGroupsFile, "utf8"));
if (!Array.isArray(affixGroupDocument.groups) || affixGroupDocument.groups.length === 0) {
  throw new Error("Affixgruppen-Datei ist leer");
}
const affixTierCount = affixGroupDocument.groups.reduce((sum, group) => sum + (Array.isArray(group.tiers) ? group.tiers.length : 0), 0);
if (affixTierCount === 0) throw new Error("Affixgruppen enthalten keine Tiers");
if (manifest.counts.affixGroups !== affixGroupDocument.groups.length) throw new Error("Manifest-Affixgruppenzahl stimmt nicht");
if (manifest.counts.affixGroupTiers !== affixTierCount) throw new Error("Manifest-Affixtierzahl stimmt nicht");
if (manifest.files?.[index.affixGroupsFile]?.sha256 !== hashFile(affixGroupsFile)) throw new Error("Manifest-Hash für Affixgruppen fehlt oder stimmt nicht");
if (manifest.files?.["index.json"]?.sha256 !== hashFile(path.join(appRoot, "index.json"))) throw new Error("Manifest-Hash für App-Index fehlt oder stimmt nicht");
if (index.classes.length !== 28) throw new Error(`Erwartet 28 Klassen, erhalten: ${index.classes.length}`);
for (const requiredClass of ["Bow", "Spear", "Ring", "Body Armour", "Jewel"]) {
  if (!basesByClass.get(requiredClass)?.length) throw new Error(`Testklasse fehlt: ${requiredClass}`);
}

for (const mod of mods) {
  if (!mod.displayText) throw new Error(`Vollständiger Modtext fehlt: ${mod.modId}`);
  if (mod.displayText !== (mod.displayTextDe || mod.displayTextEn)) throw new Error(`Falsche Sprachpriorität: ${mod.modId}`);
  if (forbiddenVisiblePattern.test(mod.displayText)) throw new Error(`Technischer oder künstlicher Affixtext: ${mod.displayText}`);
  if (!Array.isArray(mod.technicalStats)) throw new Error(`Technische Stats fehlen intern: ${mod.modId}`);
}

for (const base of bases) {
  if (!base.nameDe && !base.nameEn) throw new Error(`Sichtbarer Basisname fehlt: ${base.id}`);
  for (const implicit of base.implicits) {
    if (!implicit.displayText) throw new Error(`Implizittext fehlt: ${implicit.id}`);
    if (implicit.displayText !== (implicit.displayTextDe || implicit.displayTextEn || "Impliziter Modtext nicht verfügbar")) {
      throw new Error(`Falsche Implizit-Sprachpriorität: ${implicit.id}`);
    }
    if (implicit.displayText === implicit.id || forbiddenVisiblePattern.test(implicit.displayText)) {
      throw new Error(`Technische Implizit-ID sichtbar: ${implicit.displayText}`);
    }
  }
}

let poolCount = 0;
for (const itemClass of index.classes) {
  const classBases = basesByClass.get(itemClass.id) ?? [];
  if (!classBases.length) throw new Error(`Keine Basen geladen: ${itemClass.id}`);
  const relativePoolFile = index.poolFiles[itemClass.id];
  if (!relativePoolFile) throw new Error(`Pool-Datei fehlt: ${itemClass.id}`);
  const pools = read(relativePoolFile).pools;

  for (const base of classBases) {
    const pool = pools[base.id];
    if (!pool?.p?.length || !pool?.s?.length) throw new Error(`Leerer Pool: ${base.id}`);
    for (const [type, rows] of [["prefix", pool.p], ["suffix", pool.s]]) {
      for (const [modId, itemLevel, weight] of rows) {
        const mod = modsById.get(modId);
        if (!mod) throw new Error(`Unbekannte Mod-ID ${modId}`);
        if (mod.generationType !== type) throw new Error(`Falscher Generationstyp für ${modId}`);
        if (Number(itemLevel) < 0 || Number(weight) <= 0) throw new Error(`Ungültige Poolregel für ${modId}`);
      }
    }
    poolCount += 1;
  }
}

const germanBaseNames = bases.filter(base => base.nameDe).length;
const fallbackBaseNames = bases.filter(base => !base.nameDe && base.nameEn).length;
const germanModTexts = mods.filter(mod => mod.textDe).length;
const fallbackModTexts = mods.filter(mod => !mod.textDe && mod.textEn).length;
if (!germanBaseNames || !fallbackBaseNames || !germanModTexts || !fallbackModTexts) {
  throw new Error("Deutschbevorzugung oder englischer Fallback ist nicht testbar");
}

for (const relativeFile of Object.values(index.craftingFiles)) {
  const file = path.resolve(appRoot, relativeFile);
  if (!fs.existsSync(file)) throw new Error(`Crafting-Datei fehlt: ${relativeFile}`);
  JSON.parse(fs.readFileSync(file, "utf8"));
}

if (manifest.counts.poolBases !== poolCount) throw new Error("Manifest-Poolzahl stimmt nicht");

console.log(JSON.stringify({
  classes: index.classes.length,
  bases: bases.length,
  mods: mods.length,
  pools: poolCount,
  germanBaseNames,
  fallbackBaseNames,
  germanModTexts,
  fallbackModTexts,
  craftingFiles: Object.keys(index.craftingFiles).length,
  affixGroups: affixGroupDocument.groups.length,
  affixGroupTiers: affixTierCount
}));
