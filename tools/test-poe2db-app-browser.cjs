#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { CURRENT_MAX_ITEM_LEVEL } = require("../app-config.js");

const root = path.resolve(__dirname, "..");
const appMods = JSON.parse(fs.readFileSync(path.join(root, "generated/poe2db/app/mods.json"), "utf8"));
const appIndex = JSON.parse(fs.readFileSync(path.join(root, "generated/poe2db/app/index.json"), "utf8"));
const modById = new Map(appMods.mods.map(mod => [mod.modId, mod]));
const completeTexts = new Set(appMods.mods.map(mod => mod.displayText).filter(Boolean));
const forbidden = /(?:Implicit|LocalChance|AdditionalArrows\d|(?:^|\s)\+%(?:\s|$)|minimaler[^\n]+\+[^\n]+maximaler)/i;
const samples = [
  ["weapon", "Bow"],
  ["weapon", "Two Hand Sword"],
  ["weapon", "One Hand Axe"],
  ["weapon", "Wand"],
  ["armour", "Body Armour"],
  ["armour", "Gloves"],
  ["jewellery", "Ring"],
  ["jewellery", "Amulet"],
  ["jewellery", "Jewel"]
];

let browser;

(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined
  });
  const page = await browser.newPage();
  await page.route("https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.min.js", route => route.fulfill({
    contentType: "application/javascript",
    body: "window.Tesseract = window.Tesseract || {};"
  }));
  const errors = [];
  page.on("console", message => {
    if (message.type() === "error") {
      const url = message.location().url || "console";
      if (!url.endsWith("/favicon.ico")) errors.push(`${url}: ${message.text()}`);
    }
  });
  page.on("pageerror", error => errors.push(error.message));

  await page.goto(process.env.EXILEFORGE_TEST_URL || "http://127.0.0.1:8765/index.html", { waitUntil: "networkidle" });
  await page.waitForSelector("#dataStatus.success", { timeout: 30000 });
  const setSelect = async (selector, value) => page.locator(selector).evaluate((element, nextValue) => {
    element.value = nextValue;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);

  const classes = [];
  for (const [category, itemClass] of samples) {
    await setSelect("#category", category);
    await page.waitForSelector(`#itemClass option[value="${itemClass}"]`, { state: "attached", timeout: 10000 });
    await setSelect("#itemClass", itemClass);
    await page.waitForFunction(expected => document.querySelector("#itemClass")?.value === expected, itemClass);
    await page.waitForFunction(() => {
      const picker = document.querySelector("#basePicker");
      return picker && !picker.disabled && picker.dataset.baseId;
    });
    await page.locator("#ilevel").evaluate((element, level) => { element.value = String(level); element.dispatchEvent(new Event("input", { bubbles: true })); }, CURRENT_MAX_ITEM_LEVEL);
    const baseId = await page.locator("#basePicker").getAttribute("data-base-id");
    const poolFile = appIndex.poolFiles[itemClass];
    const classPools = JSON.parse(fs.readFileSync(path.join(root, "generated/poe2db/app", poolFile), "utf8")).pools;
    const expectedPool = classPools[baseId];
    if (!expectedPool) throw new Error(`${itemClass}: Adapter-Pool fehlt für ${baseId}`);
    const observed = {};
    for (const [type, slotSelector, poolKey] of [["prefix", "#prefixSlots", "p"], ["suffix", "#suffixSlots", "s"]]) {
      await page.locator(`${slotSelector} .affix-slot`).first().dispatchEvent("click");
      await page.waitForSelector('#modResults .affix-tier-row[data-normal="true"]', { state: "attached", timeout: 10000 });
      const rows = await page.locator('#modResults .affix-tier-row[data-normal="true"]').evaluateAll(elements => elements.map(element => ({
        modId: element.dataset.modId,
        text: element.dataset.displayText ?? ""
      })));
      const actualIds = rows.map(row => row.modId).sort();
      const expectedIds = expectedPool[poolKey].map(row => row[0]).sort();
      if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
        const actual = new Set(actualIds);
        const expected = new Set(expectedIds);
        throw new Error(`${itemClass}/${type}: DOM-ID-Abweichung; fehlt=${expectedIds.filter(id => !actual.has(id)).join(",")}; extra=${actualIds.filter(id => !expected.has(id)).join(",")}`);
      }
      for (const { modId, text } of rows) {
        if (text !== modById.get(modId)?.displayText || !completeTexts.has(text)) throw new Error(`${itemClass}: DOM-Text stammt nicht aus displayText: ${modId} ${text}`);
        if (forbidden.test(text)) throw new Error(`${itemClass}: technischer oder künstlicher DOM-Text: ${text}`);
      }
      observed[type] = rows.length;
      await page.keyboard.press("Escape");
    }
    classes.push({ itemClass, baseId, base: await page.textContent("#basePickerName"), prefixes: observed.prefix, suffixes: observed.suffix });
  }

  const bowResult = classes.find(row => row.itemClass === "Bow");
  const bowPool = JSON.parse(fs.readFileSync(path.join(root, "generated/poe2db/app", appIndex.poolFiles.Bow), "utf8")).pools[bowResult.baseId];
  const bowMods = [...bowPool.p, ...bowPool.s].map(row => modById.get(row[0]));
  const bowFamilies = {
    increasedPhysical: /increased physical damage/i,
    addedPhysical: /adds? .* physical damage/i,
    attackSpeed: /attack speed/i,
    criticalChance: /critical (?:hit|strike) chance/i,
    criticalMultiplier: /critical.*(?:damage bonus|multiplier)/i,
    accuracy: /accuracy/i,
    fire: /fire damage/i,
    cold: /cold damage/i,
    lightning: /lightning damage/i,
    elementalWithAttacks: /elemental damage with attack/i,
    projectileOrBow: /projectile|arrow|bow/i
  };
  for (const [family, pattern] of Object.entries(bowFamilies)) {
    const matches = bowMods.filter(mod => pattern.test(`${mod.displayTextEn} ${mod.groups.join(" ")} ${mod.technicalStats.map(stat => stat.id).join(" ")}`));
    if (!matches.length) throw new Error(`Bow: erwartete gültige Modfamilie fehlt im DOM-geprüften Pool: ${family}`);
  }

  await setSelect("#category", "weapon");
  await page.waitForSelector('#itemClass option[value="Bow"]', { state: "attached", timeout: 10000 });
  await setSelect("#itemClass", "Bow");
  await page.locator("#basePicker").dispatchEvent("click");
  await page.fill("#baseSearch", "Hüterinbogen");
  await page.waitForSelector("#baseResults .result button", { timeout: 10000 });
  await page.locator("#baseResults .result button").first().click();
  const bowBase = await page.textContent("#basePickerName");
  const bowImplicit = await page.locator("#baseDetails .implicit b").first().textContent();
  if (bowBase !== "Hüterinbogen") throw new Error(`Deutscher Basisname nicht bevorzugt: ${bowBase}`);
  if (!bowImplicit || forbidden.test(bowImplicit) || /BowImplicit/.test(bowImplicit)) {
    throw new Error(`Ungültiger sichtbarer Bogen-Implizittext: ${bowImplicit}`);
  }

  const result = {
    status: await page.textContent("#dataStatus"),
    classes,
    localizedBow: { base: bowBase, implicit: bowImplicit },
    consoleErrors: errors
  };
  console.log(JSON.stringify(result));
  if (errors.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
});
