import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as browserEngine from "../browser.mjs";
import * as nodeEngine from "../index.mjs";
import { CURRENT_MAX_ITEM_LEVEL as sharedMaximumItemLevel } from "../../../app-config-values.mjs";

let freshImportSequence = 0;

const requiredBrowserExports = [
  "createItemState", "reviseItemState", "createRuleContext", "evaluateRuleSets", "resolveEligibleModifiers",
  "listCraftingActionDefinitions", "getCraftingActionDefinition", "evaluateCraftingAction",
  "createSeededRandom", "selectWeightedModifier", "enumerateWeightedCandidates", "simulateCraftingStep",
  "planCraftingPaths", "createModifierCatalog", "getModifierDisplayTier", "EngineValidationError",
  "ENGINE_ACTION_CODES", "ENGINE_ELIGIBILITY_CODES", "ENGINE_ERROR_CODES", "ENGINE_PLANNER_CODES",
  "ENGINE_RULE_ERROR_CODES", "ENGINE_SIMULATOR_CODES", "ENGINE_WEIGHT_SELECTION_CODES"
];

function browserModuleGraph(entryUrl) {
  const visited = new Set();
  const visit = url => {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = readFileSync(url, "utf8");
    assert.doesNotMatch(source, /(?:from\s+|import\s*)["']node:/, `${url.pathname} imports a Node built-in`);
    const dependencies = [...source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.\.?\/[^"']+)["']/g)];
    for (const dependency of dependencies) visit(new URL(dependency[1], url));
  };
  visit(entryUrl);
  return visited;
}

test("browser entry dependency graph contains no node imports", () => {
  const modules = browserModuleGraph(new URL("../browser.mjs", import.meta.url));
  assert.ok(modules.size > 1);
  assert.equal([...modules].some(module => module.endsWith("/app-config.js")), false);
});

test("browser entry exports the synchronous UI engine API without the Node loader", () => {
  for (const name of requiredBrowserExports) assert.equal(typeof browserEngine[name] !== "undefined", true, `${name} missing`);
  assert.equal("loadModifierCatalog" in browserEngine, false);
});

test("Node entry retains its existing catalog and engine API", () => {
  for (const name of requiredBrowserExports) assert.equal(typeof nodeEngine[name] !== "undefined", true, `${name} missing`);
  assert.equal(typeof nodeEngine.loadModifierCatalog, "function");
});

test("browser entry import does not create a missing global config", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "EXILEFORGE_CONFIG");
  try {
    delete globalThis.EXILEFORGE_CONFIG;
    await import(`../browser.mjs?side-effect-missing=${++freshImportSequence}`);
    assert.equal(Object.hasOwn(globalThis, "EXILEFORGE_CONFIG"), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, "EXILEFORGE_CONFIG", previous);
    else delete globalThis.EXILEFORGE_CONFIG;
  }
});

test("browser entry import preserves an existing global config", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "EXILEFORGE_CONFIG");
  const sentinel = Object.freeze({ CURRENT_MAX_ITEM_LEVEL: 123, sentinel: true });
  try {
    globalThis.EXILEFORGE_CONFIG = sentinel;
    await import(`../browser.mjs?side-effect-existing=${++freshImportSequence}`);
    assert.equal(globalThis.EXILEFORGE_CONFIG, sentinel);
    assert.equal(globalThis.EXILEFORGE_CONFIG.CURRENT_MAX_ITEM_LEVEL, 123);
    assert.equal(globalThis.EXILEFORGE_CONFIG.sentinel, true);
  } finally {
    if (previous) Object.defineProperty(globalThis, "EXILEFORGE_CONFIG", previous);
    else delete globalThis.EXILEFORGE_CONFIG;
  }
});

test("shared, browser, and Node item-level configuration remains in parity", () => {
  assert.equal(sharedMaximumItemLevel, 86);
  assert.equal(browserEngine.CURRENT_MAX_ITEM_LEVEL, sharedMaximumItemLevel);
  assert.equal(nodeEngine.CURRENT_MAX_ITEM_LEVEL, sharedMaximumItemLevel);
});
