#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appRoot = path.join(root, "generated", "poe2db", "app");
const read = file => JSON.parse(fs.readFileSync(path.join(appRoot, file), "utf8"));

const index = read("index.json");
const bases = read("bases.json").bases;
const mods = read("mods.json").mods;
const manifest = read("manifest.json");
const modsById = new Map(mods.map(mod => [mod.id, mod]));
const basesByClass = Map.groupBy(bases, base => base.itemClass);

if (index.source !== "generated/poe2db") throw new Error("Adapter verwendet nicht generated/poe2db");
if (index.classes.length !== 28) throw new Error(`Erwartet 28 Klassen, erhalten: ${index.classes.length}`);

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
  craftingFiles: Object.keys(index.craftingFiles).length
}));
