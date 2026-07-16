import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const sourceRoot = path.resolve(process.argv[2] ?? ".cache/poe2-data");
const sourceData = path.join(sourceRoot, "data");
const outputRoot = path.resolve("generated");

const TABLES = [
  "baseitemtypes.json",
  "itemclasses.json",
  "itemclasscategories.json",
  "mods.json",
  "modfamilies.json",
  "modgenerationtypes.json",
  "modsellprices.json",
  "stats.json",
  "tags.json",
  "defaultmonsterstats.json",
  "currencyitems.json",
  "craftingbenchoptions.json",
  "craftingitemclasscategories.json",
  "essences.json",
  "runegrafts.json",
  "runes.json",
  "omenitems.json",
  "desecratedmods.json",
  "desecratedmodtypes.json",
  "armourtypes.json",
  "belttypes.json",
  "shieldtypes.json",
  "weaponclasses.json",
  "weapontypes.json",
  "flavourtext.json"
];

const LANGUAGES = ["english", "german"];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function findCaseInsensitive(dir, filename) {
  if (!fs.existsSync(dir)) return null;
  const wanted = filename.toLowerCase();
  const match = fs.readdirSync(dir).find(entry => entry.toLowerCase() === wanted);
  return match ? path.join(dir, match) : null;
}

function copyTable(source, destination) {
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
  return {
    file: path.relative(outputRoot, destination).replaceAll("\\", "/"),
    bytes: fs.statSync(destination).size,
    sha256: sha256(destination)
  };
}
function git(args, fallback = "unknown") {
  try {
    return execFileSync("git", ["-C", sourceRoot, ...args], {
      encoding: "utf8"
    }).trim() || fallback;
  } catch {
    return fallback;
  }
}

if (!fs.existsSync(sourceData)) {
  throw new Error(`PoE2-Datenordner nicht gefunden: ${sourceData}`);
}

fs.rmSync(outputRoot, {
  recursive: true,
  force: true
});

ensureDir(outputRoot);

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    repository: "https://github.com/adainrivers/poe2-data",
    commit: git(["rev-parse", "HEAD"]),
    commitDate: git(["show", "-s", "--format=%cI", "HEAD"])
  },
  tables: {},
  missing: []
};

for (const language of LANGUAGES) {
  const languageDir =
    language === "english"
      ? sourceData
      : path.join(sourceData, language);

  manifest.tables[language] = {};

  for (const table of TABLES) {
    const source = findCaseInsensitive(languageDir, table);

    if (!source) {
      manifest.missing.push({
        language,
        table
      });
      continue;
    }

    const destination = path.join(
      outputRoot,
      "raw",
      language,
      table
    );

    manifest.tables[language][table] = copyTable(source, destination);
  }
}

fs.writeFileSync(
  path.join(outputRoot, "manifest.json"),
  JSON.stringify(manifest, null, 2)
);

console.log("Import abgeschlossen.");
