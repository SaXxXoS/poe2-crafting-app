#!/usr/bin/env node

import fs from "fs";
import path from "path";

const projectRoot = process.cwd();

const dataDir = path.join(projectRoot, "poe2-data");
const outputDir = path.join(projectRoot, "database");

function error(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(dataDir)) {
  error("Ordner 'poe2-data' wurde nicht gefunden.");
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const manifest = {
  generatedAt: new Date().toISOString(),
  languages: [],
  tables: {}
};

const languages = fs
  .readdirSync(dataDir)
  .filter((d) =>
    fs.statSync(path.join(dataDir, d)).isDirectory()
  );

for (const language of languages) {

  manifest.languages.push(language);

  const langDir = path.join(dataDir, language);

  manifest.tables[language] = {};

  const files = fs
    .readdirSync(langDir)
    .filter((f) => f.endsWith(".json"));

  for (const file of files) {

    const source = path.join(langDir, file);

    const destination = path.join(
      outputDir,
      "raw",
      language,
      file
    );

    fs.mkdirSync(path.dirname(destination), {
      recursive: true
    });

    fs.copyFileSync(source, destination);
        manifest.tables[language][file] = {
      path: path.relative(outputDir, destination),
      size: fs.statSync(destination).size
    };

  }

}

const stats = {
  languages: manifest.languages.length,
  tables: Object.values(manifest.tables)
    .reduce((sum, lang) => sum + Object.keys(lang).length, 0)
};

fs.writeFileSync(
  path.join(outputDir, "manifest.json"),
  JSON.stringify(manifest, null, 2)
);

fs.writeFileSync(
  path.join(outputDir, "stats.json"),
  JSON.stringify(stats, null, 2)
);

console.log("");
console.log("================================");
console.log("PoE2-Daten erfolgreich importiert");
console.log("================================");
console.log("");

console.log("Sprachen:", stats.languages);
console.log("Tabellen:", stats.tables);
console.log("");
const requiredTables = [
  "baseitemtypes.json",
  "itemclasses.json",
  "mods.json",
  "stats.json"
];

const validation = {
  checkedAt: new Date().toISOString(),
  errors: [],
  warnings: [],
  checkedFiles: 0
};

for (const language of manifest.languages) {

  const languageTables =
    manifest.tables[language] ?? {};

  for (const requiredTable of requiredTables) {

    if (!languageTables[requiredTable]) {
      validation.errors.push(
        `${language}: ${requiredTable} fehlt`
      );
    }

  }

  for (const [tableName, tableInfo]
    of Object.entries(languageTables)) {

    const tablePath = path.join(
      outputDir,
      tableInfo.path
    );

    validation.checkedFiles += 1;

    if (!fs.existsSync(tablePath)) {
      validation.errors.push(
        `Datei fehlt: ${tableInfo.path}`
      );

      continue;
    }

    if (fs.statSync(tablePath).size === 0) {
      validation.errors.push(
        `Datei ist leer: ${tableInfo.path}`
      );

      continue;
    }

    try {
      JSON.parse(
        fs.readFileSync(tablePath, "utf8")
      );
    } catch (exception) {
      validation.errors.push(
        `Ungültiges JSON: ${tableInfo.path}`
      );
    }

  }

}
fs.writeFileSync(
  path.join(outputDir, "validation-report.json"),
  JSON.stringify(validation, null, 2)
);

console.log("Geprüfte Dateien:", validation.checkedFiles);
console.log("Warnungen:", validation.warnings.length);
console.log("Fehler:", validation.errors.length);

if (validation.warnings.length > 0) {
  console.warn(
    validation.warnings.join("\n")
  );
}

if (validation.errors.length > 0) {
  console.error(
    validation.errors.join("\n")
  );

  process.exit(1);
}

console.log("");
console.log("Datenprüfung erfolgreich abgeschlossen.");
