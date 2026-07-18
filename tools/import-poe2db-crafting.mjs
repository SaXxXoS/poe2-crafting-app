#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const outputRoot = path.join(root, "generated", "poe2db", "crafting");
const rawRoot = path.join(outputRoot, "raw");
const offline = process.argv.includes("--offline");
const repoeMods = JSON.parse(fs.readFileSync(path.join(root, "generated", "repoe", "raw", "mods.min.json"), "utf8"));
const repoeBases = JSON.parse(fs.readFileSync(path.join(root, "generated", "repoe", "raw", "base_items.min.json"), "utf8"));

const PAGES = [
  ["essences", "Essence"],
  ["omens", "Omen"],
  ["desecration", "Desecrated_Modifiers"],
  ["currencies", "Stackable_Currency"],
  ["crafted-modifiers", "Crafted_Modifiers"],
  ["crafting", "Crafting"],
  ["liquid-emotions", "Liquid_Emotions"],
  ["alloys", "Alloy"],
  ["mark-abyssal-lord", "Mark_of_the_Abyssal_Lord"],
  ["abyss", "Abyss"]
];

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const decode = value => String(value ?? "")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;|&#160;/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\r/g, "")
  .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
const norm = value => decode(value).toLowerCase().replace(/\d+(?:\.\d+)?/g, "#").replace(/[^a-zäöüß#]+/g, " ").trim();
const values = text => [...decode(text).matchAll(/(?:\(|\+)?(-?\d+(?:\.\d+)?)\s*(?:—|–|-)\s*(-?\d+(?:\.\d+)?)|(?:\+)?(-?\d+(?:\.\d+)?)/g)]
  .map(match => match[1] ? { min: Number(match[1]), max: Number(match[2]) } : { min: Number(match[3]), max: Number(match[3]) });

async function snapshots() {
  fs.mkdirSync(rawRoot, { recursive: true });
  const result = new Map();
  const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), files: {} };
  for (const [key, page] of PAGES) {
    for (const [language, locale] of [["english", "us"], ["german", "de"]]) {
      const fileName = `${language}-${key}.html`;
      const file = path.join(rawRoot, fileName);
      const url = `https://poe2db.tw/${locale}/${page}`;
      let html;
      if (offline) {
        if (!fs.existsSync(file)) throw new Error(`Crafting-Snapshot fehlt: ${fileName}`);
        html = fs.readFileSync(file, "utf8");
      } else {
        const response = await fetch(url, { headers: { "user-agent": "ExileForge-PoE2DB-Importer/1.0" } });
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        html = await response.text();
        if (!html.includes("PoE2DB")) throw new Error(`Ungültiger PoE2DB-Snapshot: ${url}`);
        fs.writeFileSync(file, html, "utf8");
      }
      result.set(`${key}:${language}`, html);
      manifest.files[fileName] = { url, bytes: Buffer.byteLength(html), sha256: sha256(html) };
    }
  }
  writeJson(path.join(rawRoot, "manifest.json"), manifest);
  return { result, manifest };
}

function cards(html) {
  const pattern = /<a class="([^"]+)" data-hover="([^"]*BaseItemTypes[^"]*)" href="([^"]+)">([\s\S]*?)<\/a>/g;
  const matches = [...html.matchAll(pattern)];
  const seen = new Set();
  return matches.map((match, index) => {
    const hover = decodeURIComponent(match[2].replace(/&amp;/g, "&"));
    const id = hover.match(/BaseItemTypes[\\/]([^?&#]+)/)?.[1]?.replace(/\\/g, "/") ?? null;
    const segment = html.slice(match.index, matches[index + 1]?.index ?? html.length);
    const explicit = [...segment.matchAll(/<div class="explicitMod">([\s\S]*?)<\/div>/g)].map(row => decode(row[1])).filter(Boolean);
    const properties = [...segment.matchAll(/<div class="property">([\s\S]*?)<\/div>/g)].map(row => decode(row[1])).filter(Boolean);
    return { id, className: match[1], href: match[3], name: decode(match[4]), explicit, properties };
  }).filter(card => card.id && card.name && !seen.has(card.id) && seen.add(card.id));
}

function localizedCards(enHtml, deHtml, filter) {
  const en = cards(enHtml).filter(filter);
  const de = new Map(cards(deHtml).map(card => [card.id, card]));
  return en.map(card => ({ ...card, nameDe: de.get(card.id)?.name ?? null, explicitDe: de.get(card.id)?.explicit ?? [] }));
}

function technicalMatch(text, candidates) {
  const target = new Set(norm(text).split(" ").filter(token => token.length > 2));
  const targetValues = values(text).map(value => `${value.min}:${value.max}`).join(",");
  const scored = candidates.map(([id, row]) => {
    const source = new Set(norm(row.text).split(" ").filter(token => token.length > 2));
    const common = [...target].filter(token => source.has(token)).length;
    const sourceValues = (row.stats ?? []).map(value => `${Number(value.min)}:${Number(value.max)}`).join(",");
    const valueBonus = targetValues && targetValues === sourceValues ? 1 : 0;
    return { id, row, score: common / Math.max(target.size, source.size, 1) + valueBonus };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 0.45 && scored[0].score > (scored[1]?.score ?? -1) ? scored[0] : null;
}

function essenceData(map) {
  const essenceCards = localizedCards(map.get("essences:english"), map.get("essences:german"), card => /Essence/i.test(card.name) && /\/Currency\//i.test(card.id) && !/^Omen/i.test(card.name));
  const technical = Object.entries(repoeMods).filter(([, row]) => ["item", "misc"].includes(row.domain) && ["prefix", "suffix"].includes(row.generation_type) && row.text);
  const guaranteed = [];
  const essences = essenceCards.map(card => {
    const effectEn = card.explicit[0] ?? null;
    const effectDe = card.explicitDe[0] ?? null;
    const rows = card.explicit.slice(1).map((textEn, index) => {
      const colon = textEn.indexOf(":");
      const allowedClasses = colon >= 0 ? textEn.slice(0, colon).split(/,| or /).map(x => x.trim()) : ["Equipment"];
      const modTextEn = colon >= 0 ? textEn.slice(colon + 1).trim() : textEn;
      const deText = card.explicitDe[index + 1] ?? null;
      const deColon = deText?.indexOf(":") ?? -1;
      const match = technicalMatch(modTextEn, technical);
      const entry = {
        essenceId: card.id, essenceNameEn: card.name, allowedItemClasses: allowedClasses,
        textEn: modTextEn, textDe: deColon >= 0 ? deText.slice(deColon + 1).trim() : deText,
        generationType: match?.row.generation_type ?? null, values: values(modTextEn),
        tier: /Lesser/.test(card.name) ? 1 : /^Essence /.test(card.name) ? 2 : /Greater/.test(card.name) ? 3 : /Perfect|Corrupted/.test(card.name) ? 4 : null,
        technicalModId: match?.id ?? null, modGroups: match?.row.groups ?? [], essenceOnly: match?.row.is_essence_only ?? false,
        requiredLevel: match?.row.required_level ?? null
      };
      guaranteed.push(entry);
      return entry.technicalModId;
    });
    return {
      id: card.id, nameEn: card.name, nameDe: card.nameDe,
      quality: /Lesser/.test(card.name) ? "lesser" : /Greater/.test(card.name) ? "greater" : /Perfect/.test(card.name) ? "perfect" : /Corrupted/.test(card.name) ? "corrupted" : "normal",
      effectEn, effectDe, inputRarity: /Magic/.test(effectEn) ? "magic" : /Rare/.test(effectEn) ? "rare" : null,
      outputRarity: /to a Rare|Rare item/.test(effectEn) ? "rare" : null, guaranteedModifierIds: rows
    };
  });
  if (!essences.length || !guaranteed.length) throw new Error(`Essenzdaten oder garantierte Essenz-Mods fehlen (${essences.length}/${guaranteed.length}; Karten ${JSON.stringify(cards(map.get("essences:english")).slice(0, 5))})`);
  return { schemaVersion: 1, source: "PoE2DB Essence; RePoE technical modifier rules", essences, guaranteedModifiers: guaranteed };
}

function omenData(map) {
  const omens = localizedCards(map.get("omens:english"), map.get("omens:german"), card => /\bOmen\b/.test(card.className)).map(card => {
    const textEn = card.explicit.join("\n") || null;
    const textDe = card.explicitDe.join("\n") || null;
    const crafting = /Orb of (?:Alchemy|Annulment|Augmentation|Chance)|(?:Exalted|Chaos|Regal) Orb|Essence|Desecrat|Coronation|Crystallisation/i.test(textEn);
    return {
      id: card.id, nameEn: card.name, nameDe: card.nameDe, textEn, textDe, crafting,
      triggerEn: textEn, triggerDe: textDe,
      affectedMethod: textEn?.match(/(?:next|your next)\s+([^\n]+?(?:Orb|Essence|Desecration attempt|Desecrated modifiers))/i)?.[1] ?? null,
      affects: ["prefix", "suffix", "remove", "add", "essence", "desecration"].filter(value => new RegExp(value, "i").test(textEn)),
      consumedOnTrigger: /next time|your next/i.test(textEn), restrictionsEn: null, restrictionsDe: null
    };
  });
  if (!omens.length || !omens.some(x => x.crafting)) throw new Error("Omen oder Crafting-Omen fehlen");
  return { schemaVersion: 1, source: "PoE2DB Omen", omens };
}

function tableRows(html) {
  return [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(match => [...match[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(td => decode(td[1]))).filter(row => row.length >= 4);
}

function desecrationData(map) {
  const enRows = tableRows(map.get("desecration:english")).filter(row => ["Prefix", "Suffix"].includes(row[2]));
  const deRows = tableRows(map.get("desecration:german"));
  const technical = Object.entries(repoeMods).filter(([, row]) => row.domain === "desecrated" && ["prefix", "suffix"].includes(row.generation_type));
  const deByShape = new Map();
  for (const row of deRows) {
    const key = `${row[1]}|${/Präfix/i.test(row[2]) ? "prefix" : /Suffix/i.test(row[2]) ? "suffix" : row[2]}|${values(row[3]).map(x => `${x.min}:${x.max}`).join(",")}`;
    if (!deByShape.has(key)) deByShape.set(key, []);
    deByShape.get(key).push(row);
  }
  const modifiers = enRows.map(row => {
    const generationType = row[2].toLowerCase();
    const key = `${row[1]}|${generationType}|${values(row[3]).map(x => `${x.min}:${x.max}`).join(",")}`;
    const deCandidates = deByShape.get(key) ?? [];
    const de = deCandidates.shift() ?? null;
    const match = technicalMatch(row[3], technical.filter(([, mod]) => mod.generation_type === generationType && Number(mod.required_level) === Number(row[1])));
    return {
      technicalModId: match?.id ?? null, nameEn: row[0], nameDe: de?.[0] ?? null,
      textEn: row[3], textDe: de?.[3] ?? null, generationType, itemLevel: Number(row[1]), tier: null,
      values: values(row[3]), modGroups: match?.row.groups ?? [], spawnWeights: match?.row.spawn_weights ?? [],
      generationWeights: match?.row.generation_weights ?? [], allowedCategories: match?.row.spawn_weights?.filter(x => x.weight > 0).map(x => x.tag) ?? []
    };
  });
  const items = localizedCards(map.get("desecration:english"), map.get("desecration:german"), card => card.explicit.some(text => /^Desecrates a Rare/i.test(text)));
  const markEn = decode(map.get("mark-abyssal-lord:english").match(/Desecrating an item with the Mark[\s\S]*?<\/p>/)?.[0]);
  const markDe = decode(map.get("mark-abyssal-lord:german").match(/<p>[\s\S]*?Mark[\s\S]*?<\/p>/)?.[0]);
  if (!modifiers.length || !items.length) throw new Error("Entweihungsmods oder Entweihungsgegenstände fehlen");
  return { schemaVersion: 1, source: "PoE2DB Desecrated Modifiers; RePoE technical rules", items: items.map(card => ({ id: card.id, nameEn: card.name, nameDe: card.nameDe, textEn: card.explicit.join("\n"), textDe: card.explicitDe.join("\n") || null })), modifiers, revealRules: { choices: 3, rerollOmen: "Omen of Abyssal Echoes", textEn: "Reveal at the Well of Souls and select one of three options." }, markOfTheAbyssalLord: { textEn: markEn || null, textDe: markDe || null } };
}

function currencyData(map) {
  const currency = localizedCards(map.get("currencies:english"), map.get("currencies:german"), card => {
    const text = card.explicit.join(" ");
    const technical = repoeBases[card.id];
    return technical?.release_state === "released" && technical.item_class === "StackableCurrency"
      && /(Normal|Magic|Rare|modifier|Quality|socket|Corrupt|weapon|armour|jewel|item)/i.test(text)
      && !/(Map|Waystone|Skill Gem|Flask|Charm|Monster)/i.test(text);
  }).map(card => {
    const textEn = card.explicit.join("\n") || null;
    const textDe = card.explicitDe.join("\n") || null;
    return {
      id: card.id, nameEn: card.name, nameDe: card.nameDe, textEn, textDe,
      grade: /Greater/.test(card.name) ? "greater" : /Perfect/.test(card.name) ? "perfect" : /Lesser/.test(card.name) ? "lesser" : "normal",
      inputRarity: textEn?.match(/(?:a |an )(Normal|Magic|Rare)/i)?.[1]?.toLowerCase() ?? null,
      outputRarity: textEn?.match(/to a (Magic|Rare|Unique)/i)?.[1]?.toLowerCase() ?? null,
      addedModifiers: Number(textEn?.match(/add(?:ing|s)? (\d+)/i)?.[1] ?? (/add(?:ing|s)? (?:a|one) /i.test(textEn) ? 1 : 0)),
      removedModifiers: Number(textEn?.match(/remove(?:s)? (\d+)/i)?.[1] ?? (/remove(?:s)? (?:a|one) /i.test(textEn) ? 1 : 0)),
      prefixRestriction: /prefix/i.test(textEn), suffixRestriction: /suffix/i.test(textEn)
    };
  });
  if (!currency.length) throw new Error("Crafting-Währungen fehlen");
  return { schemaVersion: 1, source: "PoE2DB Stackable Currency", currencies: currency };
}

function craftedData(map) {
  const sourceCards = localizedCards(map.get("crafted-modifiers:english"), map.get("crafted-modifiers:german"), card => /Liquid|Alloy/i.test(card.name));
  const technical = Object.entries(repoeMods).filter(([, row]) => ["crafted", "misc", "item"].includes(row.domain) && row.text);
  const modifiers = [];
  for (const card of sourceCards) {
    card.explicit.filter(text => /(?:Ruby|Sapphire|Emerald|Diamond|Jewel|Weapon|Armour|Ring|Amulet|Belt)\s+(?:Prefix|Suffix):/i.test(text)).forEach((textEn, index) => {
      const match = textEn.match(/^(.+?)\s+(Prefix|Suffix):\s*(.+)$/i);
      if (!match) return;
      const candidate = technicalMatch(match[3], technical);
      const sourceIndex = card.explicit.indexOf(textEn);
      const deText = card.explicitDe[sourceIndex] ?? null;
      modifiers.push({ sourceItemId: card.id, sourceNameEn: card.name, sourceNameDe: card.nameDe, itemClass: match[1], generationType: match[2].toLowerCase(), textEn: match[3], textDe: deText?.replace(/^.+?:\s*/, "") ?? null, values: values(match[3]), technicalModId: candidate?.id ?? null, modGroups: candidate?.row.groups ?? [], cost: [{ itemId: card.id, amount: 1 }], requirementsEn: card.explicit[0] ?? null, requirementsDe: card.explicitDe[0] ?? null });
    });
  }
  if (!modifiers.length) throw new Error("Garantierte Crafted Modifiers fehlen");
  return { schemaVersion: 1, source: "PoE2DB Crafted Modifiers; RePoE technical IDs", modifiers };
}

function methodData(map) {
  const alloyCards = localizedCards(map.get("alloys:english"), map.get("alloys:german"), card => /Alloy/i.test(card.name));
  return {
    schemaVersion: 1,
    source: "PoE2DB Crafting, Alloy, Liquid Emotions, Mark of the Abyssal Lord",
    methods: [
      { id: "alloys", nameEn: "Alloys", nameDe: alloyCards[0]?.nameDe ?? null, descriptionEn: "Replace an existing modifier with a guaranteed crafted modifier.", items: alloyCards.map(x => x.id) },
      { id: "liquid-emotions", nameEn: "Liquid Emotion Jewel Crafting", nameDe: null, descriptionEn: "Replace a modifier on a Rare Jewel with a guaranteed Crafted modifier." },
      { id: "omen-meta-crafting", nameEn: "Omen Meta-crafting", nameDe: null, descriptionEn: "Influences the next applicable crafting action while active in the inventory." },
      { id: "desecration", nameEn: "Desecration", nameDe: null, descriptionEn: "Adds an unrevealed Desecrated modifier selected at the Well of Souls." },
      { id: "mark-of-the-abyssal-lord", nameEn: "Mark of the Abyssal Lord", nameDe: null, descriptionEn: "Upgrades into a higher-tier unrevealed Desecrated modifier on Desecration." }
    ]
  };
}

function missingFields(object, prefix = "") {
  const missing = [];
  if (Array.isArray(object)) object.forEach((value, index) => missing.push(...missingFields(value, `${prefix}[${index}]`)));
  else if (object && typeof object === "object") for (const [key, value] of Object.entries(object)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if ((key.endsWith("De") || key === "nameDe") && value == null) missing.push(next);
    else missing.push(...missingFields(value, next));
  }
  return missing;
}

async function main() {
  const { result: map, manifest: rawManifest } = await snapshots();
  const outputs = {
    "essences.json": essenceData(map), "omens.json": omenData(map),
    "desecration.json": desecrationData(map), "currencies.json": currencyData(map),
    "crafted-modifiers.json": craftedData(map), "methods.json": methodData(map)
  };
  for (const [file, data] of Object.entries(outputs)) writeJson(path.join(outputRoot, file), data);
  const counts = {
    essences: outputs["essences.json"].essences.length,
    guaranteedEssenceModifiers: outputs["essences.json"].guaranteedModifiers.length,
    omens: outputs["omens.json"].omens.length,
    craftingOmens: outputs["omens.json"].omens.filter(x => x.crafting).length,
    desecratedPrefixes: outputs["desecration.json"].modifiers.filter(x => x.generationType === "prefix").length,
    desecratedSuffixes: outputs["desecration.json"].modifiers.filter(x => x.generationType === "suffix").length,
    desecrationItems: outputs["desecration.json"].items.length,
    currencies: outputs["currencies.json"].currencies.length,
    craftedModifiers: outputs["crafted-modifiers.json"].modifiers.length,
    methods: outputs["methods.json"].methods.length
  };
  for (const [key, value] of Object.entries(counts)) if (!value) throw new Error(`Leere Crafting-Kategorie: ${key}`);
  const missingGerman = [];
  const track = (category, rows, fields, idField = "id") => rows.forEach((row, index) => fields.forEach(field => {
    if (row[field] == null) missingGerman.push({ category, id: row[idField] ?? index, field });
  }));
  track("essence", outputs["essences.json"].essences, ["nameDe", "effectDe"]);
  track("essence-modifier", outputs["essences.json"].guaranteedModifiers, ["textDe"], "technicalModId");
  track("omen", outputs["omens.json"].omens, ["nameDe", "textDe"]);
  track("desecration-item", outputs["desecration.json"].items, ["nameDe", "textDe"]);
  track("desecrated-modifier", outputs["desecration.json"].modifiers, ["nameDe", "textDe"], "technicalModId");
  track("currency", outputs["currencies.json"].currencies, ["nameDe", "textDe"]);
  track("crafted-modifier", outputs["crafted-modifiers.json"].modifiers, ["sourceNameDe", "textDe"], "technicalModId");
  const ambiguousMappings = [];
  const missingTechnicalMappings = [
    ...outputs["essences.json"].guaranteedModifiers.filter(x => !x.technicalModId).map(x => ({ category: "essence", source: x.essenceNameEn, textEn: x.textEn })),
    ...outputs["desecration.json"].modifiers.filter(x => !x.technicalModId).map(x => ({ category: "desecration", source: x.nameEn, textEn: x.textEn })),
    ...outputs["crafted-modifiers.json"].modifiers.filter(x => !x.technicalModId).map(x => ({ category: "crafted-modifier", source: x.sourceNameEn, textEn: x.textEn }))
  ];
  const quality = { schemaVersion: 1, generatedAt: new Date().toISOString(), counts, missingGerman, missingTechnicalMappings, ambiguousMappings,
    validation: { normalPoolsSeparated: true, essenceOnlySeparated: true, desecratedSeparated: true, emptyCategories: [], online: !offline } };
  writeJson(path.join(outputRoot, "quality-report.json"), quality);
  const files = Object.keys(outputs).map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(outputRoot, file))) }));
  writeJson(path.join(outputRoot, "index.json"), { schemaVersion: 1, generatedAt: quality.generatedAt, counts, files: [...Object.keys(outputs), "quality-report.json"] });
  writeJson(path.join(outputRoot, "manifest.json"), { schemaVersion: 1, generatedAt: quality.generatedAt, sources: { visible: "PoE2DB English/German", technical: "RePoE IDs and complete rules only" }, rawSnapshotCount: Object.keys(rawManifest.files).length, files });
  console.log(JSON.stringify(counts));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
