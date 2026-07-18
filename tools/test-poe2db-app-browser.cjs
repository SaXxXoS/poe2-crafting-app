#!/usr/bin/env node

const { chromium } = require("playwright");

let browser;

(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined
  });
  const page = await browser.newPage();
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
  const status = await page.textContent("#dataStatus");
  const base = await page.textContent("#basePickerName");

  await page.locator("#prefixSlots .affix-slot").first().dispatchEvent("click");
  await page.waitForSelector("#modResults .result", { timeout: 10000 });
  const displayedPrefixRows = await page.locator("#modResults .result").count();
  const firstDisplayedMod = await page.locator("#modResults .result b").first().textContent();

  const result = { status, base, displayedPrefixRows, firstDisplayedMod, consoleErrors: errors };
  console.log(JSON.stringify(result));
  if (errors.length || !displayedPrefixRows) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
});
