#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { CURRENT_MAX_ITEM_LEVEL } = require("../app-config.js");

const root = path.resolve(__dirname, "..");
const reportFile = path.join(root, "generated/poe2db/app/audit/affix-group-ui.json");
const parityReportFile = path.join(root, "generated/poe2db/app/audit/affix-tier-parity.json");
const basesByClass = JSON.parse(fs.readFileSync(path.join(root, "generated/poe2db/app/bases.json"), "utf8")).bases.reduce((map, base) => {
  (map[base.itemClass] ||= []).push(base.id);
  return map;
}, {});
const samples = [
  ["weapon", "Spear"], ["weapon", "Bow"], ["weapon", "Crossbow"], ["weapon", "Wand"],
  ["armour", "Body Armour"], ["jewellery", "Ring"], ["jewellery", "Jewel"]
];

let browser;
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.min.js", route => route.fulfill({ contentType: "application/javascript", body: "window.Tesseract = {};" }));
  const consoleErrors = [];
  page.on("console", message => { if (message.type() === "error" && !message.location().url.endsWith("favicon.ico")) consoleErrors.push(message.text()); });
  page.on("pageerror", error => consoleErrors.push(error.message));
  await page.goto(process.env.EXILEFORGE_TEST_URL || "http://127.0.0.1:8765/index.html", { waitUntil: "networkidle" });
  await page.waitForSelector("#dataStatus.success", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(document.querySelector("#basePicker")?.dataset.baseId && !document.querySelector("#basePicker")?.disabled), null, { timeout: 10000 });
  const setSelect = (selector, value) => page.locator(selector).evaluate((element, next) => { if (element.value === next) return; element.value = next; element.dispatchEvent(new Event("change", { bubbles: true })); }, value);
  const desktopClasses = [];
  const observedBadges = new Set();

  for (const [category, itemClass] of samples) {
    await setSelect("#category", category);
    await page.waitForSelector(`#itemClass option[value="${itemClass}"]`, { state: "attached" });
    await setSelect("#itemClass", itemClass);
    await page.waitForFunction(({ expected, baseIds }) => document.querySelector("#itemClass")?.value === expected && baseIds.includes(document.querySelector("#basePicker")?.dataset.baseId), { expected: itemClass, baseIds: basesByClass[itemClass] }, { timeout: 10000 });
    await page.locator("#ilevel").evaluate((element, level) => { element.value = String(level); element.dispatchEvent(new Event("input", { bubbles: true })); }, CURRENT_MAX_ITEM_LEVEL);
    const result = { itemClass, prefixGroups: 0, suffixGroups: 0, prefixTiers: 0, suffixTiers: 0 };
    for (const [type, selector] of [["prefix", "#prefixSlots"], ["suffix", "#suffixSlots"]]) {
      await page.locator(`${selector} .affix-slot`).first().dispatchEvent("click");
      await page.waitForSelector("#modResults .affix-family", { timeout: 10000 });
      const groups = page.locator("#modResults .affix-family");
      const tiers = page.locator("#modResults .affix-tier-row");
      result[`${type}Groups`] = await groups.count();
      result[`${type}Tiers`] = await tiers.count();
      if (!result[`${type}Groups`] || !result[`${type}Tiers`]) throw new Error(`${itemClass}/${type}: leere Gruppenauswahl`);
      const unreachable = await tiers.evaluateAll((elements, maximum) => elements.filter(element => Number(element.dataset.requiredLevel) > maximum).map(element => element.dataset.modId), CURRENT_MAX_ITEM_LEVEL);
      if (unreachable.length) throw new Error(`${itemClass}/${type}: unerreichbare Tiers sichtbar: ${unreachable.join(",")}`);
      const first = groups.first();
      const toggle = first.locator(".affix-family-toggle");
      if (await toggle.getAttribute("aria-expanded") !== "false") throw new Error(`${itemClass}/${type}: Gruppe nicht initial eingeklappt`);
      await toggle.click();
      if (await toggle.getAttribute("aria-expanded") !== "true" || !(await first.locator(".affix-tier-row").first().isVisible())) throw new Error(`${itemClass}/${type}: Aufklappen fehlgeschlagen`);
      for (const badge of await page.locator("#modResults .source-badge").allTextContents()) observedBadges.add(badge);
      await page.keyboard.press("Escape");
    }
    desktopClasses.push(result);
  }

  await setSelect("#category", "weapon");
  await page.waitForSelector('#itemClass option[value="Spear"]', { state: "attached" });
  await setSelect("#itemClass", "Spear");
  await page.locator("#ilevel").evaluate((element, level) => { element.value = String(level); element.dispatchEvent(new Event("input", { bubbles: true })); }, CURRENT_MAX_ITEM_LEVEL);
  await page.locator("#suffixSlots .affix-slot").first().dispatchEvent("click");
  await page.fill("#modSearch", "Projektil-Fertigkeiten");
  await page.waitForSelector("#modResults .affix-tier-row");
  const spearProjectileTiers = await page.locator("#modResults .affix-tier-row").evaluateAll(elements => elements
    .filter(element => element.dataset.sourceKey?.startsWith("GlobalProjectileSkillGemLevelWeapon"))
    .map(element => ({
      tier: element.querySelector(".affix-tier-main b")?.textContent,
      value: element.querySelector(".affix-tier-main span")?.textContent,
      itemLevel: element.querySelector(".affix-tier-main small")?.textContent
    })));
  const expectedSpearProjectileTiers = [
    { tier: "T1", value: "+4", itemLevel: "ilvl 81" },
    { tier: "T2", value: "+3", itemLevel: "ilvl 55" },
    { tier: "T3", value: "+2", itemLevel: "ilvl 36" },
    { tier: "T4", value: "+1", itemLevel: "ilvl 18" }
  ];
  if (JSON.stringify(spearProjectileTiers) !== JSON.stringify(expectedSpearProjectileTiers)) throw new Error(`Spear-Projektiltier-Parität verletzt: ${JSON.stringify(spearProjectileTiers)}`);
  await page.keyboard.press("Escape");

  await setSelect("#category", "weapon");
  await page.waitForSelector('#itemClass option[value="Bow"]', { state: "attached" });
  await setSelect("#itemClass", "Bow");
  await page.locator("#ilevel").evaluate((element, level) => { element.value = String(level); element.dispatchEvent(new Event("input", { bubbles: true })); }, CURRENT_MAX_ITEM_LEVEL);
  await page.locator("#prefixSlots .affix-slot").first().dispatchEvent("click");
  await page.waitForSelector("#modResults .affix-family");
  const highCount = await page.locator("#modResults .affix-tier-row").count();
  await page.locator("#ilevel").evaluate(element => { element.value = "1"; element.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForFunction(previousCount => {
    const tiers = [...document.querySelectorAll("#modResults .affix-tier-row")];
    return tiers.length < previousCount && tiers.every(element => Number(element.dataset.requiredLevel) <= 1);
  }, highCount, { timeout: 10000 });
  const lowCount = await page.locator("#modResults .affix-tier-row").count();
  if (!(lowCount < highCount)) throw new Error(`Item-Level-Filter unwirksam: ilvl1=${lowCount}, ilvl${CURRENT_MAX_ITEM_LEVEL}=${highCount}`);
  await page.keyboard.press("Escape");
  await page.locator("#suffixSlots .affix-slot").first().dispatchEvent("click");
  await page.waitForSelector("#modResults .affix-family");
  const lowSuffixCount = await page.locator("#modResults .affix-tier-row").count();
  await page.keyboard.press("Escape");
  await page.locator("#ilevel").evaluate((element, level) => { element.value = String(level); element.dispatchEvent(new Event("input", { bubbles: true })); }, CURRENT_MAX_ITEM_LEVEL);
  await page.locator("#prefixSlots .affix-slot").first().dispatchEvent("click");
  await page.waitForSelector("#modResults .affix-family");
  const searchTerm = (await page.locator("#modResults .affix-family-name").first().textContent()).split(" ")[0];
  await page.fill("#modSearch", searchTerm);
  await page.waitForFunction(() => [...document.querySelectorAll("#modResults .affix-family-toggle")].every(node => node.getAttribute("aria-expanded") === "true"));
  if (!(await page.locator("#modResults .affix-tier-row").first().isVisible())) throw new Error("Suche klappt gefundene Tiers nicht auf");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.fill("#modSearch", "");
  await page.locator("#modResults .affix-family-toggle").first().click();
  const maximumInput = await page.locator("#ilevel").evaluate((element, attempted) => {
    element.value = String(attempted);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return { max: Number(element.max), value: Number(element.value) };
  }, CURRENT_MAX_ITEM_LEVEL + 1);
  if (maximumInput.max !== CURRENT_MAX_ITEM_LEVEL || maximumInput.value !== CURRENT_MAX_ITEM_LEVEL) throw new Error(`Item-Level oberhalb des Maximums auswählbar: ${JSON.stringify(maximumInput)}`);
  const mobile = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    sheetWidth: document.querySelector("#modSheet")?.scrollWidth,
    groupHeight: document.querySelector("#modResults .affix-family-toggle")?.getBoundingClientRect().height
  }));
  if (mobile.documentWidth > mobile.viewportWidth || mobile.sheetWidth > mobile.viewportWidth || mobile.groupHeight > 52) throw new Error(`Mobiles Layout überläuft oder ist nicht kompakt: ${JSON.stringify(mobile)}`);
  if (!observedBadges.has("Normal")) throw new Error("Normal-Quellenbadge fehlt");
  if (consoleErrors.length) throw new Error(`Browser-Konsole: ${consoleErrors.join(" | ")}`);

  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const bowAtMaximum = desktopClasses.find(row => row.itemClass === "Bow");
  report.browserTest = { status: "passed", desktopClasses, spearProjectileTiers, itemLevelFilter: { level1: { prefixes: lowCount, suffixes: lowSuffixCount }, currentMaximum: CURRENT_MAX_ITEM_LEVEL, maximum: { prefixes: highCount, suffixes: bowAtMaximum.suffixTiers } }, maximumInput, observedBadges: [...observedBadges].sort(), mobile, consoleErrors };
  report.passed = report.passed && true;
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const parityReport = JSON.parse(fs.readFileSync(parityReportFile, "utf8"));
  parityReport.browserTest = { status: "passed", classes: desktopClasses.map(row => row.itemClass), spearProjectileTiers, consoleErrors };
  parityReport.passed = parityReport.passed && consoleErrors.length === 0;
  fs.writeFileSync(parityReportFile, `${JSON.stringify(parityReport, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report.browserTest));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
