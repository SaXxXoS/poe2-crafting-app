#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pobRoot = path.resolve(process.argv[2] ?? ".cache/pob2");
const basesDir = path.join(pobRoot, "src", "Data", "Bases");
const dataFile = path.join(root, "data.js");
const englishBaseFile = path.join(root, "generated", "raw", "english", "baseitemtypes.json");
const germanBaseFile = path.join(root, "generated", "raw", "german", "baseitemtypes.json");
const reportFile = path.join(root, "generated", "pob-bases-report.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return normalize(value).replaceAll(" ", "-") || "unknown";
}

function readJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadExistingData() {
  if (!fs.existsSync(dataFile)) {
    fail("data.js wurde nicht gefunden. Führe zuerst build-app-data.mjs aus.");
  }

  const source = fs.readFileSync(dataFile, "utf8");
  const match = source.match(/window\.EXILEFORGE_DATA\s*=\s*([\s\S]*);\s*$/);

  if (!match) {
    fail("data.js hat nicht das erwartete EXILEFORGE_DATA-Format.");
  }

  return JSON.parse(match[1]);
}

class LuaTokenizer {
  constructor(source) {
    this.source = source;
    this.index = 0;
    this.current = null;
  }

  skipWhitespaceAndComments() {
    while (this.index < this.source.length) {
      if (/\s/.test(this.source[this.index])) {
        this.index += 1;
        continue;
      }

      if (this.source.startsWith("--", this.index)) {
        const newline = this.source.indexOf("\n", this.index + 2);
        this.index = newline === -1 ? this.source.length : newline + 1;
        continue;
      }

      break;
    }
  }

  next() {
    this.skipWhitespaceAndComments();

    if (this.index >= this.source.length) {
      return { type: "eof", value: "" };
    }

    const char = this.source[this.index];

    if ('{}[]=,'.includes(char)) {
      this.index += 1;
      return { type: char, value: char };
    }

    if (char === '"' || char === "'") {
      const quote = char;
      this.index += 1;
      let value = "";

      while (this.index < this.source.length) {
        const current = this.source[this.index++];

        if (current === quote) break;

        if (current === "\\") {
          const escaped = this.source[this.index++];
          const map = {
            n: "\n",
            r: "\r",
            t: "\t",
            "\\": "\\",
            '"': '"',
            "'": "'"
          };
          value += map[escaped] ?? escaped;
        } else {
          value += current;
        }
      }

      return { type: "string", value };
    }

    const numberMatch = this.source.slice(this.index).match(/^-?\d+(?:\.\d+)?/);
    if (numberMatch) {
      this.index += numberMatch[0].length;
      return { type: "number", value: Number(numberMatch[0]) };
    }

    const identifierMatch = this.source.slice(this.index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifierMatch) {
      this.index += identifierMatch[0].length;
      return { type: "identifier", value: identifierMatch[0] };
    }

    throw new Error(`Unbekanntes Lua-Zeichen bei Position ${this.index}: ${char}`);
  }

  peek() {
    if (!this.current) this.current = this.next();
    return this.current;
  }

  take() {
    const token = this.peek();
    this.current = null;
    return token;
  }

  expect(type) {
    const token = this.take();
    if (token.type !== type) {
      throw new Error(`Lua-Parser: ${type} erwartet, aber ${token.type} gefunden.`);
    }
    return token;
  }
}

function parseLuaValue(tokenizer) {
  const token = tokenizer.peek();

  if (token.type === "string" || token.type === "number") {
    return tokenizer.take().value;
  }

  if (token.type === "identifier") {
    const value = tokenizer.take().value;
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "nil") return null;
    return value;
  }

  if (token.type === "{") {
    return parseLuaTable(tokenizer);
  }

  throw new Error(`Lua-Wert kann nicht gelesen werden: ${token.type}`);
}

function parseLuaTable(tokenizer) {
  tokenizer.expect("{");

  const keyed = {};
  const array = [];
  let hasKeys = false;

  while (tokenizer.peek().type !== "}") {
    const first = tokenizer.peek();

    if (first.type === "identifier") {
      const identifier = tokenizer.take();

      if (tokenizer.peek().type === "=") {
        tokenizer.take();
        keyed[identifier.value] = parseLuaValue(tokenizer);
        hasKeys = true;
      } else {
        array.push(
          identifier.value === "true"
            ? true
            : identifier.value === "false"
              ? false
              : identifier.value
        );
      }
    } else if (first.type === "[") {
      tokenizer.take();
      const key = parseLuaValue(tokenizer);
      tokenizer.expect("]");
      tokenizer.expect("=");
      keyed[String(key)] = parseLuaValue(tokenizer);
      hasKeys = true;
    } else {
      array.push(parseLuaValue(tokenizer));
    }

    if (tokenizer.peek().type === ",") tokenizer.take();
  }

  tokenizer.expect("}");

  if (!hasKeys) return array;
  if (array.length) keyed.__array = array;
  return keyed;
}

function findBalancedTable(source, startIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "{") depth += 1;

    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, index + 1);
    }
  }

  throw new Error("Unvollständige Lua-Tabelle.");
}

function parseBaseFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const output = [];
  const assignment = /itemBases\["((?:\\.|[^"])*)"\]\s*=\s*\{/g;
  let match;

  while ((match = assignment.exec(source))) {
    const name = JSON.parse(`"${match[1]}"`);
    const tableStart = source.indexOf("{", match.index);
    const tableSource = findBalancedTable(source, tableStart);
    const tokenizer = new LuaTokenizer(tableSource);
    const value = parseLuaTable(tokenizer);

    output.push({
      name,
      sourceFile: path.basename(filePath),
      value
    });

    assignment.lastIndex = tableStart + tableSource.length;
  }

  return output;
}

const TYPE_MAP = {
  "Spear": ["weapon", "Speer"],
  "Crossbow": ["weapon", "Armbrust"],
  "Bow": ["weapon", "Bogen"],
  "Quarterstaff": ["weapon", "Kampfstab"],
  "Warstaff": ["weapon", "Kriegsstab"],
  "Wand": ["weapon", "Zauberstab"],
  "Sceptre": ["weapon", "Zepter"],
  "Staff": ["weapon", "Stab"],
  "Mace": ["weapon", "Streitkolben"],
  "One Handed Mace": ["weapon", "Streitkolben"],
  "Two Handed Mace": ["weapon", "Streitkolben"],
  "Sword": ["weapon", "Schwert"],
  "One Handed Sword": ["weapon", "Schwert"],
  "Two Handed Sword": ["weapon", "Schwert"],
  "Axe": ["weapon", "Axt"],
  "One Handed Axe": ["weapon", "Axt"],
  "Two Handed Axe": ["weapon", "Axt"],
  "Dagger": ["weapon", "Dolch"],
  "Flail": ["weapon", "Flegel"],
  "Claw": ["weapon", "Klaue"],

  "Helmet": ["armour", "Helm"],
  "Body Armour": ["armour", "Körperrüstung"],
  "Gloves": ["armour", "Handschuhe"],
  "Boots": ["armour", "Stiefel"],
  "Shield": ["armour", "Schild"],
  "Focus": ["armour", "Fokus"],
  "Quiver": ["armour", "Köcher"],

  "Ring": ["jewellery", "Ring"],
  "Amulet": ["jewellery", "Amulett"],
  "Belt": ["jewellery", "Gürtel"]
};

function inferType(value) {
  const explicit = value.type;
  if (TYPE_MAP[explicit]) return TYPE_MAP[explicit];

  const tags = Object.keys(value.tags ?? {}).filter(key => value.tags[key]);

  const candidates = [
    ["crossbow", ["weapon", "Armbrust"]],
    ["spear", ["weapon", "Speer"]],
    ["bow", ["weapon", "Bogen"]],
    ["quarterstaff", ["weapon", "Kampfstab"]],
    ["warstaff", ["weapon", "Kriegsstab"]],
    ["wand", ["weapon", "Zauberstab"]],
    ["sceptre", ["weapon", "Zepter"]],
    ["helmet", ["armour", "Helm"]],
    ["body_armour", ["armour", "Körperrüstung"]],
    ["gloves", ["armour", "Handschuhe"]],
    ["boots", ["armour", "Stiefel"]],
    ["shield", ["armour", "Schild"]],
    ["focus", ["armour", "Fokus"]],
    ["quiver", ["armour", "Köcher"]],
    ["ring", ["jewellery", "Ring"]],
    ["amulet", ["jewellery", "Amulett"]],
    ["belt", ["jewellery", "Gürtel"]]
  ];

  for (const [tag, mapped] of candidates) {
    if (tags.includes(tag)) return mapped;
  }

  return null;
}

function buildTranslationMaps() {
  const englishRows = readJson(englishBaseFile);
  const germanRows = readJson(germanBaseFile);
  const germanById = new Map(germanRows.map(row => [row.Id, row.Name]));
  const nameMap = new Map();

  for (const row of englishRows) {
    const germanName = germanById.get(row.Id);
    if (row.Name && germanName) {
      nameMap.set(normalize(row.Name), germanName);
    }
  }

  return nameMap;
}

function implicitLines(value) {
  return String(value.implicit ?? "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      name: line,
      kind: index === 0 && /^grants skill:/i.test(line)
        ? "Gewährte Fertigkeit (PoB-Originaltext)"
        : "Basis-Implizit (PoB-Originaltext)"
    }));
}

function requirements(value) {
  const req = value.req ?? {};
  const parts = [];

  if (Number(req.str) > 0) parts.push(`${req.str} Str`);
  if (Number(req.dex) > 0) parts.push(`${req.dex} Ges`);
  if (Number(req.int) > 0) parts.push(`${req.int} Int`);

  return parts.join(" · ");
}

function physicalRange(weapon) {
  const min = weapon?.PhysicalMin;
  const max = weapon?.PhysicalMax;

  if (min === undefined && max === undefined) return "–";
  if (min === max || max === undefined) return String(min);
  return `${min}–${max}`;
}

function defenceSummary(value) {
  const armour = value.armour ?? value.armourData ?? {};
  const parts = [];

  const armourValue = armour.ArmourBase ?? armour.Armour;
  const evasionValue = armour.EvasionBase ?? armour.Evasion;
  const energyShieldValue = armour.EnergyShieldBase ?? armour.EnergyShield;

  if (armourValue) parts.push(`Rüstung ${armourValue}`);
  if (evasionValue) parts.push(`Ausweichen ${evasionValue}`);
  if (energyShieldValue) parts.push(`Energieschild ${energyShieldValue}`);

  return parts.join(" · ");
}

if (!fs.existsSync(basesDir)) {
  fail(`PoB-Basenordner fehlt: ${basesDir}`);
}

const translations = buildTranslationMaps();
const currentData = loadExistingData();
const baseItems = {};
const classOptions = {
  weapon: [],
  armour: [],
  jewellery: []
};

const report = {
  generatedAt: new Date().toISOString(),
  source: "PathOfBuildingCommunity/PathOfBuilding-PoE2",
  sourceBranch: "dev",
  parsedFiles: 0,
  parsedBases: 0,
  importedBases: 0,
  hiddenSkipped: 0,
  unmappedTypes: {},
  classes: {},
  englishImplicitLines: 0
};

const files = fs.readdirSync(basesDir)
  .filter(file => file.endsWith(".lua"))
  .sort();

for (const file of files) {
  const parsed = parseBaseFile(path.join(basesDir, file));
  report.parsedFiles += 1;
  report.parsedBases += parsed.length;

  for (const entry of parsed) {
    const value = entry.value;

    if (value.hidden === true) {
      report.hiddenSkipped += 1;
      continue;
    }

    const mapped = inferType(value);

    if (!mapped) {
      const type = value.type ?? `Datei: ${entry.sourceFile}`;
      report.unmappedTypes[type] = (report.unmappedTypes[type] ?? 0) + 1;
      continue;
    }

    const [category, itemClass] = mapped;
    if (!baseItems[itemClass]) baseItems[itemClass] = [];
    if (!classOptions[category].includes(itemClass)) {
      classOptions[category].push(itemClass);
    }

    const weapon = value.weapon ?? {};
    const implicits = implicitLines(value);
    report.englishImplicitLines += implicits.length;

    baseItems[itemClass].push({
      id: slug(`${value.type ?? itemClass}-${entry.name}`),
      sourceId: `pob:${entry.sourceFile}:${entry.name}`,
      name: translations.get(normalize(entry.name)) ?? entry.name,
      englishName: entry.name,
      requiredLevel: Number(value.req?.level ?? 0),
      requirements: requirements(value),
      physical: physicalRange(weapon),
      crit: weapon.CritChanceBase !== undefined
        ? `${Number(weapon.CritChanceBase).toLocaleString("de-DE", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
          })} %`
        : "–",
      aps: weapon.AttackRateBase !== undefined
        ? Number(weapon.AttackRateBase).toLocaleString("de-DE", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
          })
        : "–",
      defences: defenceSummary(value),
      implicits,
      tags: Object.keys(value.tags ?? {}).filter(tag => value.tags[tag]),
      pobType: value.type ?? "",
      sourceFile: entry.sourceFile
    });

    report.importedBases += 1;
    report.classes[itemClass] = (report.classes[itemClass] ?? 0) + 1;
  }
}

for (const category of Object.keys(classOptions)) {
  classOptions[category].sort((a, b) => a.localeCompare(b, "de"));
}

for (const list of Object.values(baseItems)) {
  list.sort((a, b) =>
    a.requiredLevel - b.requiredLevel ||
    a.name.localeCompare(b.name, "de")
  );
}

currentData.classOptions = classOptions;
currentData.baseItems = baseItems;
currentData.generatedAt = new Date().toISOString();
currentData.baseSource = {
  name: "Path of Building 2",
  branch: "dev"
};

currentData.recognition = currentData.recognition ?? {};
currentData.recognition.categoryByClass = Object.fromEntries(
  Object.entries(classOptions)
    .flatMap(([category, classes]) => classes.map(itemClass => [itemClass, category]))
);

currentData.recognition.classAliases = currentData.recognition.classAliases ?? {};
for (const [category, classes] of Object.entries(classOptions)) {
  for (const itemClass of classes) {
    currentData.recognition.classAliases[itemClass] = [
      itemClass,
      normalize(itemClass)
    ];
  }
}

fs.writeFileSync(
  dataFile,
  `window.EXILEFORGE_DATA = ${JSON.stringify(currentData, null, 2)};\n`,
  "utf8"
);

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log(`PoB-Basen importiert: ${report.importedBases}`);
console.log(`Klassen: ${Object.keys(report.classes).length}`);
console.log(`Nicht zugeordnete Typen: ${Object.keys(report.unmappedTypes).length}`);
console.log(`Bericht: ${path.relative(root, reportFile)}`);
