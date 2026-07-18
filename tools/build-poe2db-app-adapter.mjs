#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const sourceRoot = path.join(root, "generated", "poe2db");
const outputRoot = path.join(sourceRoot, "app");
const index = readJson(path.join(sourceRoot, "index.json"));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function appProperties(base) {
  const values = base.values ?? {};
  const properties = {};
  if (Array.isArray(values.physicalDamage)) {
    properties.physical_damage_min = values.physicalDamage[0];
    properties.physical_damage_max = values.physicalDamage[1];
  }
  if (Number(values.attacksPerSecond) > 0) properties.attack_time = 1000 / Number(values.attacksPerSecond);
  if (Number(values.criticalHitChance) > 0) properties.critical_strike_chance = Number(values.criticalHitChance) * 100;
  if (Number(values.weaponRange) > 0) properties.range = values.weaponRange;
  if (Number(values.armour) > 0) properties.armour = values.armour;
  if (Number(values.evasion) > 0) properties.evasion = values.evasion;
  if (Number(values.energyShield) > 0) properties.energy_shield = values.energyShield;
  if (Number(values.blockChance) > 0) properties.block = values.blockChance;
  if (Number(values.movementSpeedModifier) !== 0) properties.movement_speed = values.movementSpeedModifier;
  return properties;
}

function adaptBase(base, itemClass) {
  return {
    id: base.id,
    name: base.nameEn,
    nameEn: base.nameEn,
    nameDe: base.nameDe,
    itemClass,
    itemClassName: itemClass,
    dropLevel: Number(base.dropLevel ?? 0),
    tags: base.tags ?? [],
    requirements: base.requirements ?? {},
    properties: appProperties(base),
    sourceProperties: base.values?.properties ?? [],
    implicits: (base.implicits ?? []).map((implicit, index) => ({
      id: `${base.id}:implicit:${index}`,
      textEn: implicit.textEn ?? null,
      textDe: implicit.textDe ?? null,
      type: "Basis-Implizit"
    })),
    availability: base.availability ?? null,
    source: "poe2db"
  };
}

function adaptMod(mod) {
  return {
    id: mod.id,
    sourceId: mod.sourceId,
    generationType: mod.generationType,
    requiredLevel: Number(mod.itemLevel ?? 0),
    tier: mod.tier ?? null,
    group: mod.family?.[0] ?? mod.sourceId ?? mod.id,
    groups: mod.family ?? [],
    nameEn: mod.nameEn ?? null,
    nameDe: mod.nameDe ?? null,
    textEn: mod.textEn ?? null,
    textDe: mod.textDe ?? null,
    spawnWeights: mod.spawnWeights ?? [],
    generationWeights: mod.generationWeights ?? [],
    poe2dbDropChance: Number(mod.spawnWeight ?? 0),
    source: "poe2db"
  };
}

const bases = [];
const modsById = new Map();
const classes = [];
const poolFiles = {};
let poolBaseCount = 0;

for (const classEntry of index.classes) {
  const document = readJson(path.join(sourceRoot, classEntry.dataFile));
  const completePoolBaseIds = new Set(document.pools
    .filter(pool =>
      pool.prefixes.some(entry => entry.spawnWeight > 0 && entry.generationWeight > 0)
      && pool.suffixes.some(entry => entry.spawnWeight > 0 && entry.generationWeight > 0)
    )
    .map(pool => pool.baseId));
  const regularBases = document.bases.filter(base =>
    base.availability?.regularUsable !== false && completePoolBaseIds.has(base.id)
  );
  if (!regularBases.length) throw new Error(`Keine regulären Basen für ${classEntry.itemClass}`);

  classes.push({ id: classEntry.itemClass, name: classEntry.itemClass, key: classEntry.key });
  for (const base of regularBases) bases.push(adaptBase(base, classEntry.itemClass));
  for (const mod of [...document.prefixes, ...document.suffixes]) {
    const adapted = adaptMod(mod);
    const existing = modsById.get(adapted.id);
    if (existing && (existing.textEn !== adapted.textEn || existing.generationType !== adapted.generationType)) {
      throw new Error(`Widersprüchliche Mod-ID ${adapted.id}`);
    }
    if (!existing) modsById.set(adapted.id, adapted);
  }

  const validBaseIds = new Set(regularBases.map(base => base.id));
  const pools = {};
  for (const pool of document.pools.filter(pool => validBaseIds.has(pool.baseId))) {
    const prefixes = pool.prefixes.filter(entry => entry.spawnWeight > 0 && entry.generationWeight > 0);
    const suffixes = pool.suffixes.filter(entry => entry.spawnWeight > 0 && entry.generationWeight > 0);
    if (!prefixes.length || !suffixes.length) throw new Error(`Leerer Mod-Pool für ${pool.baseId}`);
    pools[pool.baseId] = {
      p: prefixes.map(entry => [entry.modId, modsById.get(entry.modId)?.requiredLevel ?? 0, entry.spawnWeight * entry.generationWeight]),
      s: suffixes.map(entry => [entry.modId, modsById.get(entry.modId)?.requiredLevel ?? 0, entry.spawnWeight * entry.generationWeight])
    };
  }
  if (Object.keys(pools).length !== regularBases.length) throw new Error(`Unvollständige Pools für ${classEntry.itemClass}`);

  const poolFile = `pools/${classEntry.key}.json`;
  writeJson(path.join(outputRoot, poolFile), { schemaVersion: 1, itemClass: classEntry.itemClass, source: "generated/poe2db", pools });
  poolFiles[classEntry.itemClass] = poolFile;
  poolBaseCount += Object.keys(pools).length;
}

const mods = [...modsById.values()];
writeJson(path.join(outputRoot, "bases.json"), { schemaVersion: 1, source: "generated/poe2db", count: bases.length, bases });
writeJson(path.join(outputRoot, "mods.json"), { schemaVersion: 1, source: "generated/poe2db", count: mods.length, mods });
writeJson(path.join(outputRoot, "index.json"), {
  schemaVersion: 1,
  source: "generated/poe2db",
  classes,
  poolFiles,
  craftingFiles: {
    essences: "../crafting/essences.json",
    omens: "../crafting/omens.json",
    desecration: "../crafting/desecration.json",
    currencies: "../crafting/currencies.json",
    craftedModifiers: "../crafting/crafted-modifiers.json",
    methods: "../crafting/methods.json"
  }
});

const generatedAt = new Date().toISOString();
const files = ["bases.json", "mods.json", "index.json", ...Object.values(poolFiles)];
writeJson(path.join(outputRoot, "manifest.json"), {
  schemaVersion: 1,
  generatedAt,
  status: "poe2db-app-adapter-ready",
  deprecatedSource: "generated/app-data is retained but no longer referenced by the application",
  counts: { equipmentBases: bases.length, referencedEquipmentMods: mods.length, poolFiles: Object.keys(poolFiles).length, poolBases: poolBaseCount, craftingFiles: 6 },
  files: Object.fromEntries(files.map(file => [file, { sha256: sha256(path.join(outputRoot, file)) }]))
});

console.log(`PoE2DB-App-Adapter: ${bases.length} Basen, ${mods.length} Mods, ${classes.length} Klassen, ${poolBaseCount} Pools`);
