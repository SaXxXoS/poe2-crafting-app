#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { CURRENT_MAX_ITEM_LEVEL } = require("../app-config.js");

const root = path.resolve(__dirname, "..");
const appRoot = path.join(root, "generated/poe2db/app");
const index = JSON.parse(fs.readFileSync(path.join(appRoot, "index.json"), "utf8"));
const bases = JSON.parse(fs.readFileSync(path.join(appRoot, "bases.json"), "utf8")).bases;
const mods = JSON.parse(fs.readFileSync(path.join(appRoot, "mods.json"), "utf8")).mods;
const modById = new Map(mods.map(mod => [mod.modId, mod]));

function category(itemClass) {
  if (/Amulet|Ring|Belt|Jewel/.test(itemClass)) return "jewellery";
  if (/Armour|Helmet|Gloves|Boots|Shield|Buckler|Focus|Quiver/.test(itemClass)) return "armour";
  return "weapon";
}

function greedyCover(pools) {
  const target = new Set(Object.values(pools).flatMap(pool => [...pool.p, ...pool.s].map(row => row[0])));
  const uncovered = new Set(target);
  const selected = [];
  while (uncovered.size) {
    let best = null;
    for (const [baseId, pool] of Object.entries(pools)) {
      if (selected.includes(baseId)) continue;
      const ids = new Set([...pool.p, ...pool.s].map(row => row[0]));
      const gain = [...ids].filter(id => uncovered.has(id)).length;
      if (!best || gain > best.gain) best = { baseId, ids, gain };
    }
    if (!best?.gain) throw new Error(`Pool-Abdeckung kann nicht vervollständigt werden: ${[...uncovered].join(",")}`);
    selected.push(best.baseId);
    for (const id of best.ids) uncovered.delete(id);
  }
  return { selected, target };
}

let browser;
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined });
  const page = await browser.newPage();
  await page.route("https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.min.js", route => route.fulfill({ contentType: "application/javascript", body: "window.Tesseract = window.Tesseract || {};" }));
  const errors = [];
  page.on("console", message => { if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.EXILEFORGE_TEST_URL || "http://127.0.0.1:8765/index.html", { waitUntil: "networkidle" });
  await page.waitForSelector("#dataStatus.success", { timeout: 30000 });
  const setSelect = async (selector, value) => page.locator(selector).evaluate((element, next) => { element.value = next; element.dispatchEvent(new Event("change", { bubbles: true })); }, value);
  await page.locator("#ilevel").evaluate((element, level) => { element.value = String(level); element.dispatchEvent(new Event("input", { bubbles: true })); }, CURRENT_MAX_ITEM_LEVEL);

  const classes = [];
  for (const classEntry of index.classes) {
    const itemClass = classEntry.id;
    const pools = JSON.parse(fs.readFileSync(path.join(appRoot, index.poolFiles[itemClass]), "utf8")).pools;
    const cover = greedyCover(pools);
    const observed = { p: new Set(), s: new Set() };
    await setSelect("#category", category(itemClass));
    await page.waitForSelector(`#itemClass option[value="${itemClass}"]`, { state: "attached", timeout: 10000 });
    await setSelect("#itemClass", itemClass);
    await page.waitForFunction(expected => document.querySelector("#itemClass")?.value === expected, itemClass);

    for (const baseId of cover.selected) {
      if (await page.locator("#basePicker").getAttribute("data-base-id") !== baseId) {
        await page.locator("#basePicker").dispatchEvent("click");
        const baseRow = page.locator(`#baseResults .result[data-base-id="${baseId}"] button`);
        await baseRow.waitFor({ state: "visible", timeout: 10000 });
        await baseRow.click();
      }
      for (const [type, selector, key] of [["prefix", "#prefixSlots", "p"], ["suffix", "#suffixSlots", "s"]]) {
        await page.locator(`${selector} .affix-slot`).first().dispatchEvent("click");
        await page.waitForSelector('#modResults .affix-tier-row[data-normal="true"]', { state: "attached", timeout: 10000 });
        const rows = await page.locator('#modResults .affix-tier-row[data-normal="true"]').evaluateAll(elements => elements.map(element => ({ id: element.dataset.modId, text: element.dataset.displayText ?? "" })));
        const actual = rows.map(row => row.id).sort();
        const expected = pools[baseId][key].map(row => row[0]).sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          const actualSet = new Set(actual);
          const expectedSet = new Set(expected);
          throw new Error(`${itemClass}/${baseId}/${type}: fehlt=${expected.filter(id => !actualSet.has(id)).join(",")}; extra=${actual.filter(id => !expectedSet.has(id)).join(",")}`);
        }
        for (const row of rows) {
          if (row.text !== modById.get(row.id)?.displayText) throw new Error(`${itemClass}: sichtbarer DOM-Text weicht von displayText ab: ${row.id}`);
          observed[key].add(row.id);
        }
        await page.keyboard.press("Escape");
      }
    }
    const expectedPrefix = new Set(Object.values(pools).flatMap(pool => pool.p.map(row => row[0])));
    const expectedSuffix = new Set(Object.values(pools).flatMap(pool => pool.s.map(row => row[0])));
    if (observed.p.size !== expectedPrefix.size || observed.s.size !== expectedSuffix.size) throw new Error(`${itemClass}: DOM-Union unvollständig`);
    classes.push({
      itemClass,
      bases: bases.filter(base => base.itemClass === itemClass).length,
      auditedBases: cover.selected.length,
      prefixes: observed.p.size,
      suffixes: observed.s.size,
      prefixIds: [...observed.p].sort(),
      suffixIds: [...observed.s].sort()
    });
  }

  const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), classes, consoleErrors: errors };
  fs.writeFileSync(path.join(appRoot, "audit/browser-dom-results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result));
  if (errors.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
