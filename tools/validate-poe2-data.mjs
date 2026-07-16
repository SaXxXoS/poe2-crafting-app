#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const projectRoot = process.cwd();
const generatedRoot = path.join(projectRoot, "generated");
const manifestPath = path.join(generatedRoot, "manifest.json");
const reportPath = path.join(generatedRoot, "validation-report.json");

const REQUIRED_ENGLISH_TABLES = [
  "baseitemtypes.json",
  "itemclasses.json",
  "mods.json",
  "stats.json"
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Ungültiges JSON in ${path.relative(projectRoot, filePath)}: ${error.message}`
    );
  }
}

if (!fs.existsSync(generatedRoot)) {
  fail("Der Ordner 'generated' wurde nicht gefunden. Führe zuerst den Datenimport aus.");
}

if (!fs.existsSync(manifestPath)) {
  fail("generated/manifest.json wurde nicht gefunden. Führe zuerst den Datenimport aus.");
}

const manifest = readJson(manifestPath);

const validation = {
  checkedAt: new Date().toISOString(),
  sourceCommit: manifest.source?.commit ?? "unknown",
  checkedFiles: 0,
  errors: [],
  warnings: [],
  missingTables: Array.isArray(manifest.missing) ? manifest.missing : []
};

const englishTables = manifest.tables?.english ?? {};

for (const tableName of REQUIRED_ENGLISH_TABLES) {
  if (!englishTables[tableName]) {
    validation.errors.push(
      `Erforderliche englische Tabelle fehlt: ${tableName}`
    );
  }
}

for (const [language, tables] of Object.entries(manifest.tables ?? {})) {
  for (const [tableName, metadata] of Object.entries(tables ?? {})) {
    validation.checkedFiles += 1;

    if (!metadata?.file) {
      validation.errors.push(
        `${language}/${tableName}: Dateipfad fehlt im Manifest`
      );
      continue;
    }

    const filePath = path.join(generatedRoot, metadata.file);

    if (!fs.existsSync(filePath)) {
      validation.errors.push(
        `Datei fehlt: ${metadata.file}`
      );
      continue;
    }

    const fileSize = fs.statSync(filePath).size;

    if (fileSize === 0) {
      validation.errors.push(
        `Datei ist leer: ${metadata.file}`
      );
      continue;
    }

    if (
      Number.isFinite(metadata.bytes) &&
      fileSize !== metadata.bytes
    ) {
      validation.errors.push(
        `Dateigröße stimmt nicht: ${metadata.file}`
      );
    }

    if (metadata.sha256) {
      const actualHash = sha256(filePath);

      if (actualHash !== metadata.sha256) {
        validation.errors.push(
          `Prüfsumme stimmt nicht: ${metadata.file}`
        );
      }
    }

    try {
      const parsed = readJson(filePath);

      if (Array.isArray(parsed) && parsed.length === 0) {
        validation.warnings.push(
          `Tabelle enthält keine Einträge: ${metadata.file}`
        );
      }
    } catch (error) {
      validation.errors.push(error.message);
    }
  }
}

if (validation.checkedFiles === 0) {
  validation.errors.push(
    "Im Manifest wurden keine importierten Tabellen gefunden."
  );
}

fs.writeFileSync(
  reportPath,
  JSON.stringify(validation, null, 2) + "\n"
);

console.log("");
console.log("================================");
console.log("PoE2-Datenprüfung");
console.log("================================");
console.log(`Geprüfte Dateien: ${validation.checkedFiles}`);
console.log(`Warnungen: ${validation.warnings.length}`);
console.log(`Fehler: ${validation.errors.length}`);

if (validation.warnings.length > 0) {
  console.warn("");
  console.warn(validation.warnings.join("\n"));
}

if (validation.errors.length > 0) {
  console.error("");
  console.error(validation.errors.join("\n"));
  process.exit(1);
}

console.log("");
console.log("Datenprüfung erfolgreich abgeschlossen.");
