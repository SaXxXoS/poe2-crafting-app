#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const appMods = JSON.parse(fs.readFileSync(path.join(root, "generated/poe2db/app/mods.json"), "utf8"));
const completeTexts = new Set(appMods.mods.map(mod => mod.displayText).filter(Boolean));
const forbidden = /(?:Implicit|LocalChance|AdditionalArrows\d|(?:^|\s)\+%(?:\s|$)|minimaler[^\n]+\+[^\n]+maximaler)/i;
const samples = [
  ["weapon", "Bow"],
  ["weapon", "Spear"],
  ["jewellery", "Ring"],
  ["armour", "Body Armour"],
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
    await page.locator("#prefixSlots .affix-slot").first().dispatchEvent("click");
    await page.waitForSelector("#modResults .result b", { timeout: 10000 });
    const visibleTexts = await page.locator("#modResults .result b").allTextContents();
    if (!visibleTexts.length) throw new Error(`${itemClass}: kein sichtbarer Präfix-Pool`);
    for (const text of visibleTexts) {
      if (!completeTexts.has(text)) throw new Error(`${itemClass}: DOM-Text stammt nicht aus displayText: ${text}`);
      if (forbidden.test(text)) throw new Error(`${itemClass}: technischer oder künstlicher DOM-Text: ${text}`);
    }
    classes.push({ itemClass, base: await page.textContent("#basePickerName"), prefixRows: visibleTexts.length, firstText: visibleTexts[0] });
    await page.keyboard.press("Escape");
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
