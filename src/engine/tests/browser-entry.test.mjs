import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as browserEngine from "../browser.mjs";
import * as nodeEngine from "../index.mjs";

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
});

test("browser entry exports the synchronous UI engine API without the Node loader", () => {
  for (const name of requiredBrowserExports) assert.equal(typeof browserEngine[name] !== "undefined", true, `${name} missing`);
  assert.equal("loadModifierCatalog" in browserEngine, false);
});

test("Node entry retains its existing catalog and engine API", () => {
  for (const name of requiredBrowserExports) assert.equal(typeof nodeEngine[name] !== "undefined", true, `${name} missing`);
  assert.equal(typeof nodeEngine.loadModifierCatalog, "function");
});
