import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ENGINE_PLANNER_CODES, ENGINE_SIMULATOR_CODES, PLANNER_LIMITS, createItemState, createModifierCatalog,
  enumerateWeightedCandidates, loadModifierCatalog, planCraftingPaths, simulateCraftingStep
} from "../index.mjs";
import { classifyPlannerSimulatorResult } from "../planner-status.mjs";

const makeMod = (id, generationType, weight, familyId) => ({ modId: id, generationType, domain: "item",
  technicalStats: [{ id: `${id}:stat` }], tier: 1, requiredLevel: 1, spawnWeights: [{ tag: "bow", weight }],
  generationWeights: [], groups: [familyId], flags: [], source: "poe2db" });
function documents(mods = [
    makeMod("mod:existing", "prefix", 1, "family:existing"),
    makeMod("mod:add-prefix", "prefix", 1, "family:add-prefix"),
    makeMod("mod:add-suffix", "suffix", 3, "family:add-suffix"),
    makeMod("mod:equal-suffix", "suffix", 1, "family:equal-suffix"),
    makeMod("mod:zero", "suffix", 0, "family:zero")
  ]) {
  return { index: { classes: [{ id: "Bow" }] }, bases: { bases: [{ id: "base:bow", itemClass: "Bow", tags: ["bow", "weapon", "default"] }] },
    mods: { mods }, affixGroups: { groups: mods.map(entry => ({ familyId: entry.groups[0], generationType: entry.generationType,
      tiers: [{ modId: entry.modId, technicalTier: 1, displayTiers: { Bow: 1 }, requiredLevel: 1,
        spawnWeights: entry.spawnWeights, generationWeights: [], craftingSources: [], regularClasses: ["Bow"], specialClasses: [], requiredBaseTagsAny: [] }] })) } };
}
const catalog = mods => createModifierCatalog(documents(mods));
const existing = (instanceId = "instance:existing") => ({ instanceId, modId: "mod:existing", familyId: "family:existing",
  generationType: "prefix", domain: "item", technicalTier: 1, displayTier: 1, statIds: ["mod:existing:stat"],
  values: [], source: "normal", appliedAtRevision: 0, metadata: {} });
const state = (rarity = "magic", overrides = {}) => createItemState({ itemId: `item:${rarity}`, baseTypeId: "base:bow",
  itemClassId: "Bow", itemLevel: 86, rarity, prefixModifiers: rarity === "normal" ? [] : [existing()], ...overrides });
const contexts = Object.freeze({ capacityRules: Object.freeze({ prefix: 3, suffix: 3 }) });
const plan = (overrides = {}) => planCraftingPaths({ initialItemState: state(), catalog: catalog(),
  allowedActions: ["currency:augmentation"], maxDepth: 2, maxPaths: 50, targetPredicate: () => false,
  actionContext: contexts, ...overrides });
const bytes = value => JSON.stringify(value);

test("1 invalid initial state", () => assert.equal(planCraftingPaths({ initialItemState: {}, allowedActions: ["currency:augmentation"], maxDepth: 1, maxPaths: 1, targetPredicate: () => false }).code, ENGINE_PLANNER_CODES.ITEM_STATE_INVALID));
test("2 empty actions", () => assert.equal(plan({ allowedActions: [] }).code, ENGINE_PLANNER_CODES.INPUT_INVALID));
test("3 unsupported action", () => assert.equal(plan({ allowedActions: ["currency:chaos"] }).code, ENGINE_PLANNER_CODES.ACTION_UNSUPPORTED));
test("4 invalid maxDepth", () => assert.equal(plan({ maxDepth: PLANNER_LIMITS.maxDepth + 1 }).status, "error"));
test("5 invalid maxPaths", () => assert.equal(plan({ maxPaths: 0 }).status, "error"));
test("6 target predicate required", () => assert.equal(plan({ targetPredicate: null }).status, "error"));
test("7 initial target produces depth zero path", () => { const result = plan({ targetPredicate: () => true }); assert.equal(result.status, "target-reached"); assert.equal(result.paths[0].depth, 0); assert.deepEqual(result.paths[0].resultingItemState, result.initialItemState); });
test("8 augmentation produces deterministic states", () => { const result = plan({ maxDepth: 1 }); assert.ok(result.paths.length > 0); assert.ok(result.paths.every(path => path.steps[0].action === "currency:augmentation")); });
test("9 regal produces rare states", () => { const result = plan({ allowedActions: ["currency:regal"], maxDepth: 1 }); assert.ok(result.paths.every(path => path.resultingItemState.rarity === "rare")); });
test("10 exalted produces rare states", () => { const result = plan({ initialItemState: state("rare"), allowedActions: ["currency:exalted"], maxDepth: 1 }); assert.ok(result.paths.length && result.paths.every(path => path.resultingItemState.rarity === "rare")); });
test("11 augmentation then regal path", () => { const result = plan({ allowedActions: ["currency:augmentation", "currency:regal"], targetPredicate: item => item.rarity === "rare" && item.prefixModifiers.length + item.suffixModifiers.length === 3 }); assert.ok(result.paths.some(path => path.steps.map(step => step.action).join(",") === "currency:augmentation,currency:regal")); });
test("12 regal then exalted path", () => { const result = plan({ allowedActions: ["currency:regal", "currency:exalted"], targetPredicate: item => item.rarity === "rare" && item.prefixModifiers.length + item.suffixModifiers.length === 3 }); assert.ok(result.paths.some(path => path.steps.map(step => step.action).join(",") === "currency:regal,currency:exalted")); });
test("13 cumulative probability is product", () => { const path = plan({ allowedActions: ["currency:regal", "currency:exalted"], targetPredicate: item => item.prefixModifiers.length + item.suffixModifiers.length === 3 }).paths.find(entry => entry.depth === 2); assert.equal(path.cumulativeProbability, path.steps[0].stepProbability * path.steps[1].stepProbability); });
test("14 zero weight candidates are not expanded", () => assert.equal(plan({ maxDepth: 1 }).paths.some(path => path.steps[0].selectedModifierId === "mod:zero"), false));
test("15 equal weights use stable modifier IDs", () => { const ids = plan({ maxDepth: 1 }).paths.filter(path => path.steps[0].candidateWeight === 1).map(path => path.steps[0].selectedModifierId); assert.deepEqual(ids, [...ids].sort()); });
test("16 identical input produces identical immutable result", () => { const options = { initialItemState: state(), catalog: catalog(), allowedActions: ["currency:augmentation"], maxDepth: 1, maxPaths: 20, targetPredicate: () => false, actionContext: contexts }; const first = planCraftingPaths(options); assert.deepEqual(first, planCraftingPaths(options)); assert.ok(Object.isFrozen(first) && Object.isFrozen(first.paths) && Object.isFrozen(first.paths[0].steps)); });
test("17 initial state and allowed actions are not mutated", () => { const item = state(), actions = Object.freeze(["currency:augmentation"]), before = [bytes(item), bytes(actions)]; plan({ initialItemState: item, allowedActions: actions }); assert.deepEqual([bytes(item), bytes(actions)], before); });
test("18 catalog is not mutated", () => { const cat = catalog(), before = bytes(cat); plan({ catalog: cat }); assert.equal(bytes(cat), before); });
test("19 modifier definitions remain frozen and unchanged", () => { const cat = catalog(), before = bytes(cat.modifiers); plan({ catalog: cat }); assert.equal(bytes(cat.modifiers), before); assert.ok(Object.isFrozen(cat.modifiers)); });
test("20 action error becomes planner error", () => { const broken = { ...catalog(), modifiers: null }; const result = plan({ catalog: broken }); assert.equal(result.status, "error"); assert.equal(result.code, ENGINE_PLANNER_CODES.ACTION_ERROR); });
test("21 inapplicable action is skipped", () => { const result = plan({ allowedActions: ["currency:exalted"] }); assert.equal(result.status, "no-path"); assert.equal(result.diagnostics[0].status, "inapplicable"); });
test("22 unresolved action stays unresolved", () => { const result = plan({ actionContext: {} }); assert.equal(result.status, "unresolved"); assert.equal(result.generatedTransitionCount, 0); });
test("23 simulator errors remain planner errors", () => { const collision = `simulated:item:magic:1:currency:augmentation:mod:add-suffix`; const item = state("magic", { prefixModifiers: [existing(collision)] }); const result = plan({ initialItemState: item, maxPaths: 1 }); assert.equal(result.status, "error"); assert.equal(result.code, ENGINE_PLANNER_CODES.SIMULATOR_ERROR); });
test("24 simulator inapplicable remains fachlich separate", () => assert.equal(classifyPlannerSimulatorResult({ status: "inapplicable" }), "inapplicable"));
test("25 simulator unresolved remains fachlich separate", () => assert.equal(classifyPlannerSimulatorResult({ status: "unresolved" }), "unresolved"));
test("26 maxDepth is strict", () => assert.ok(plan({ maxDepth: 1 }).paths.every(path => path.depth <= 1)));
test("27 maxPaths is strict and retains the highest-priority non-target path", () => { const result = plan({ maxDepth: 1, maxPaths: 1 }); assert.equal(result.paths.length, 1); assert.equal(result.paths[0].steps[0].selectedModifierId, "mod:add-suffix"); assert.equal(result.paths[0].cumulativeProbability, 0.6); assert.equal(result.generatedTransitionCount, 3); assert.equal(result.truncated, true); });
test("28 maxDepth truncates only when a positive transition remains", () => { const result = plan({ allowedActions: ["currency:regal", "currency:exalted"], maxDepth: 1 }); assert.equal(result.truncated, true); assert.ok(result.paths.every(path => path.depth <= 1)); });
test("29 no executable action yields no-path", () => assert.equal(plan({ initialItemState: state("normal"), allowedActions: ["currency:augmentation"] }).status, "no-path"));
test("30 inapplicable branch does not block valid branch", () => { const result = plan({ allowedActions: ["currency:augmentation", "currency:exalted"], maxDepth: 1 }); assert.ok(result.paths.length); });
test("31 duplicate states are not expanded at equal or worse positions", () => { const result = plan({ allowedActions: ["currency:augmentation"], maxDepth: 2 }); assert.ok(result.exploredNodeCount <= result.generatedTransitionCount + 1); });
test("32 state key does not use revision as identity", () => { const source = readFileSync(new URL("../planner.mjs", import.meta.url), "utf8"); const body = source.slice(source.indexOf("function stateKey"), source.indexOf("function selectionResult")); assert.doesNotMatch(body, /revision|instanceId|appliedAtRevision/); });
test("33 planner needs no random source", () => assert.doesNotMatch(readFileSync(new URL("../planner.mjs", import.meta.url), "utf8"), /Math\.random|createSeededRandom|selectWeightedModifier|Date\.now/));

const realCatalog = loadModifierCatalog();
const realCase = itemClassId => { const baseTypeId = Object.values(realCatalog.baseTypes).find(base => base.itemClassId === itemClassId).id; const item = createItemState({ itemId: `real:${itemClassId}`, baseTypeId, itemClassId, itemLevel: 86, rarity: "rare" }); return planCraftingPaths({ initialItemState: item, catalog: realCatalog, allowedActions: ["currency:exalted"], maxDepth: 1, maxPaths: 5, targetPredicate: () => false }); };
test("34 Spear regression", () => assert.equal(realCase("Spear").status, "unresolved"));
test("35 Bow regression", () => assert.equal(realCase("Bow").status, "unresolved"));
test("36 Body Armour regression", () => assert.equal(realCase("Body Armour").status, "unresolved"));
test("37 Ring regression", () => assert.equal(realCase("Ring").status, "unresolved"));
test("38 Jewel regression", () => assert.equal(realCase("Jewel").status, "unresolved"));
test("39 real no-capacity cases do not select simulate or mutate", () => { const before = bytes(realCatalog), result = realCase("Spear"); assert.equal(result.generatedTransitionCount, 0); assert.equal(result.paths.length, 0); assert.equal(bytes(realCatalog), before); });
test("40 simulator action-error classification remains intact", () => { const itemState = state(), actionResult = Object.freeze({ actionId: "currency:augmentation", valid: false, status: "error" }); const result = simulateCraftingStep({ itemState, actionResult, selectionResults: Object.freeze([]) }); assert.equal(result.valid, false); assert.equal(result.status, "error"); assert.equal(result.errors[0].code, ENGINE_SIMULATOR_CODES.ACTION_NOT_EXECUTABLE); assert.equal(result.resultingItemState, null); assert.deepEqual(result.appliedOperations, []); });

test("weighted enumeration shares validation and excludes zero weights", () => {
  const request = { id: "request", deterministicKey: "key", type: "modifier-addition", executable: true, count: 1,
    candidates: [{ modifierId: "a", generationType: "prefix", applicableWeight: { spawn: 0 } }, { modifierId: "b", generationType: "suffix", applicableWeight: { spawn: 2 } }] };
  const result = enumerateWeightedCandidates(request); assert.equal(result.status, "enumerated"); assert.equal(result.totalWeight, 2); assert.deepEqual(result.candidates.map(entry => entry.candidate.modifierId), ["b"]);
});

test("terminal regal path at maxDepth completes without truncation", () => {
  const mods = [makeMod("mod:existing", "prefix", 1, "family:existing"), makeMod("mod:add-suffix", "suffix", 1, "family:add-suffix")];
  const result = plan({ catalog: catalog(mods), allowedActions: ["currency:regal"], maxDepth: 1, maxPaths: 50 });
  assert.equal(result.status, "completed"); assert.equal(result.truncated, false); assert.equal(result.targetReached, false);
  assert.equal(result.paths.length, 1); assert.ok(result.paths.every(path => path.depth === 1 && path.steps.length === 1));
  assert.ok(result.paths.every(path => path.steps[0].action === "currency:regal" && path.resultingItemState.rarity === "rare"));
  assert.ok(result.paths.every(path => path.depth <= 1));
});

test("maxPaths ranks an evaluated lower-weight target before a higher-weight non-target", () => {
  const mods = [makeMod("mod:existing", "prefix", 1, "family:existing"),
    makeMod("mod:high", "suffix", 3, "family:high"), makeMod("mod:target", "suffix", 1, "family:target")];
  let predicateCalls = 0;
  const result = plan({ catalog: catalog(mods), maxDepth: 1, maxPaths: 1, targetPredicate: item => {
    predicateCalls += 1;
    return item.suffixModifiers.some(modifier => modifier.modId === "mod:target");
  } });
  assert.equal(predicateCalls, 3); assert.equal(result.generatedTransitionCount, 2); assert.equal(result.paths.length, 1);
  assert.equal(result.status, "target-reached"); assert.equal(result.targetReached, true); assert.equal(result.truncated, true);
  assert.equal(result.paths[0].steps[0].selectedModifierId, "mod:target");
  assert.equal(result.paths[0].steps[0].stepProbability, 0.25); assert.equal(result.paths[0].cumulativeProbability, 0.25);
});
