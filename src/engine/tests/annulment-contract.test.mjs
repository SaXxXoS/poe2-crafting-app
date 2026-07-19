import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ENGINE_ACTION_CODES, ENGINE_SIMULATOR_CODES, createItemState, createSeededRandom,
  evaluateCraftingAction, getCraftingActionDefinition, selectModifierForRemoval,
  simulateCraftingStep, validateItemState
} from "../index.mjs";

const instance = (instanceId, generationType, source = "normal") => ({
  instanceId, modId: `mod:${instanceId}`, familyId: `family:${instanceId}`, generationType,
  domain: "item", technicalTier: 3, displayTier: 2, statIds: [`stat:${instanceId}`],
  values: [{ min: 3, max: 7 }], source, appliedAtRevision: 0, metadata: { origin: instanceId }
});
const makeState = (changes = {}) => createItemState({
  itemId: "item:annul", baseTypeId: "base:spear", itemClassId: "Spear", itemLevel: 86, rarity: "rare",
  prefixModifiers: [instance("prefix-a", "prefix")], suffixModifiers: [instance("suffix-a", "suffix")],
  implicitModifiers: [instance("implicit-a", "implicit", "implicit")],
  craftedModifiers: [instance("crafted-a", "prefix", "crafted")],
  desecratedModifiers: [instance("desecrated-a", "suffix", "desecrated")], metadata: { retained: true }, ...changes
});
const evaluate = itemState => evaluateCraftingAction({ actionId: "currency:annulment", itemState });
const execute = (itemState, options = { random: () => 0 }) => {
  const actionResult = evaluate(itemState);
  const selectionResult = selectModifierForRemoval(actionResult.selectionRequests[0], options);
  return { actionResult, selectionResult, result: simulateCraftingStep({ itemState, actionResult, selectionResults: [selectionResult] }) };
};
const clone = value => structuredClone(value);
const code = result => result.reasons[0]?.code;

test("1 annulment definition is public and authoritative", () => {
  const definition = getCraftingActionDefinition("currency:annulment");
  assert.equal(definition.operationType, "remove-modifier"); assert.equal(definition.removalCount, 1); assert.equal(definition.selectionCount, 0); assert.equal(definition.requiresCatalog, false);
});
test("2 regular prefix makes annulment applicable", () => assert.equal(evaluate(makeState({ suffixModifiers: [] })).status, "applicable"));
test("3 regular suffix makes annulment applicable", () => assert.equal(evaluate(makeState({ prefixModifiers: [] })).status, "applicable"));
test("4 no regular modifier makes annulment inapplicable", () => {
  const result = evaluate(makeState({ prefixModifiers: [], suffixModifiers: [] })); assert.equal(result.status, "inapplicable"); assert.ok(result.reasons.some(entry => entry.code === ENGINE_ACTION_CODES.NO_REMOVABLE_MODIFIER)); assert.deepEqual(result.selectionRequests, []);
});
test("5 special modifier lists alone do not make annulment applicable", () => assert.equal(evaluate(makeState({ prefixModifiers: [], suffixModifiers: [] })).summary.applicable, false));
test("6 applicable action creates one executable removal request", () => {
  const result = evaluate(makeState()); assert.equal(result.selectionRequests.length, 1); assert.equal(result.selectionRequests[0].type, "modifier-removal"); assert.equal(result.selectionRequests[0].executable, true); assert.equal(result.selectionRequests[0].count, 1);
});
test("7 mutation plan preserves remaining modifiers and removes one selection", () => assert.deepEqual(evaluate(makeState()).mutationPlan.map(step => step.operation), ["preserve-existing-modifiers", "remove-selected-modifier"]));
test("8 action evaluation needs neither catalog nor capacity rules", () => assert.equal(evaluate(makeState()).valid, true));
test("9 invalid item is a structured action error", () => assert.equal(evaluateCraftingAction({ actionId: "currency:annulment", itemState: {} }).status, "error"));
test("10 action evaluation is non-mutating", () => {
  const itemState = makeState(); const before = JSON.stringify(itemState); evaluate(itemState); assert.equal(JSON.stringify(itemState), before);
});
test("11 action output is recursively immutable", () => {
  const result = evaluate(makeState()); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.selectionRequests[0].candidates));
});
test("12 successful simulation removes exactly selected prefix instance", () => {
  const itemState = makeState(); const { selectionResult, result } = execute(itemState, { random: () => 0 });
  assert.equal(selectionResult.selectedInstanceId, "prefix-a"); assert.deepEqual(result.resultingItemState.prefixModifiers, []); assert.equal(result.resultingItemState.suffixModifiers.length, 1);
});
test("13 successful simulation can remove exactly selected suffix instance", () => {
  const { selectionResult, result } = execute(makeState(), { random: () => 0.75 }); assert.equal(selectionResult.selectedInstanceId, "suffix-a"); assert.equal(result.resultingItemState.prefixModifiers.length, 1); assert.deepEqual(result.resultingItemState.suffixModifiers, []);
});
test("14 success preserves rarity item identity level quality sockets and metadata", () => {
  const itemState = makeState({ quality: 20, sockets: [{ id: "socket:1" }] }); const result = execute(itemState).result.resultingItemState;
  for (const field of ["itemId", "baseTypeId", "itemClassId", "itemLevel", "rarity", "quality"]) assert.deepEqual(result[field], itemState[field]);
  assert.deepEqual(result.sockets, itemState.sockets); assert.deepEqual(result.metadata, itemState.metadata);
});
test("15 implicit crafted and desecrated lists are preserved byte-for-byte", () => {
  const itemState = makeState(); const result = execute(itemState).result.resultingItemState;
  for (const field of ["implicitModifiers", "craftedModifiers", "desecratedModifiers"]) assert.deepEqual(result[field], itemState[field]);
});
test("16 success increments revision exactly once", () => {
  const itemState = makeState({ revision: 8 }); const result = execute(itemState).result; assert.equal(result.originalItemRevision, 8); assert.equal(result.resultingItemRevision, 9); assert.equal(result.resultingItemState.revision, 9);
});
test("17 resulting item passes central validation", () => assert.equal(validateItemState(execute(makeState()).result.resultingItemState).revision, 1));
test("18 input state action request and selection stay unchanged", () => {
  const itemState = makeState(); const actionResult = evaluate(itemState); const selectionResult = selectModifierForRemoval(actionResult.selectionRequests[0], { random: () => 0 }); const before = [itemState, actionResult, selectionResult].map(JSON.stringify);
  simulateCraftingStep({ itemState, actionResult, selectionResults: [selectionResult] }); assert.deepEqual([itemState, actionResult, selectionResult].map(JSON.stringify), before);
});
test("19 same seed creates byte-identical end-to-end output", () => {
  const itemState = makeState(); const seeded = createSeededRandom(99); assert.equal(JSON.stringify(execute(itemState, { rngState: seeded }).result), JSON.stringify(execute(itemState, { rngState: seeded }).result));
});
test("20 simulator exposes advanced RNG state", () => {
  const result = execute(makeState(), { rngState: createSeededRandom(99) }); assert.deepEqual(result.result.nextRngState, result.selectionResult.nextRngState);
});
test("21 stale request is rejected atomically", () => {
  const original = makeState(); const { actionResult, selectionResult } = execute(original); const revised = createItemState({ ...original, revision: 1 }); const result = simulateCraftingStep({ itemState: revised, actionResult, selectionResults: [selectionResult] });
  assert.equal(code(result), ENGINE_SIMULATOR_CODES.REQUEST_MISMATCH); assert.equal(result.resultingItemState, null);
});
test("22 manipulated selected instance is rejected atomically", () => {
  const itemState = makeState(); const { actionResult, selectionResult } = execute(itemState); const bad = clone(selectionResult); bad.selectedInstanceId = "implicit-a"; bad.selectedCandidateId = "implicit-a"; const result = simulateCraftingStep({ itemState, actionResult, selectionResults: [bad] });
  assert.equal(code(result), ENGINE_SIMULATOR_CODES.SELECTION_INVALID); assert.equal(result.resultingItemState, null);
});
test("23 candidate injected from special list is rejected", () => {
  const itemState = makeState(); const actionResult = clone(evaluate(itemState)); actionResult.selectionRequests[0].candidates[0].instanceId = "crafted-a"; const result = simulateCraftingStep({ itemState, actionResult, selectionResults: [] }); assert.equal(code(result), ENGINE_SIMULATOR_CODES.REQUEST_MISMATCH);
});
test("24 missing selection is rejected without partial mutation", () => {
  const itemState = makeState(); const result = simulateCraftingStep({ itemState, actionResult: evaluate(itemState), selectionResults: [] }); assert.equal(code(result), ENGINE_SIMULATOR_CODES.SELECTION_MISSING); assert.equal(result.resultingItemState, null); assert.equal(itemState.revision, 0);
});
test("25 extra selection result is rejected", () => {
  const itemState = makeState(); const { actionResult, selectionResult } = execute(itemState); assert.equal(code(simulateCraftingStep({ itemState, actionResult, selectionResults: [selectionResult, selectionResult] })), ENGINE_SIMULATOR_CODES.SELECTION_INVALID);
});
test("26 removal reports the exact removed modifier and operation", () => {
  const { result } = execute(makeState()); assert.equal(result.removedModifier.instanceId, "prefix-a"); assert.equal(result.appliedOperations.at(-1).removedInstanceId, "prefix-a");
});
test("27 annulment action contains no RNG or duplicated selection arithmetic", () => {
  const source = readFileSync(new URL("../crafting-actions.mjs", import.meta.url), "utf8"); assert.doesNotMatch(source, /Math\.random|Date\.now|crypto\./); assert.equal(source.includes("Math.floor"), false);
});
test("28 simulator does not duplicate RNG selection", () => {
  const source = readFileSync(new URL("../single-step-simulator.mjs", import.meta.url), "utf8"); assert.doesNotMatch(source, /Math\.random|nextSeededRandom|createSeededRandom/);
});
test("29 action and successful simulation keep rarity unchanged", () => {
  const itemState = makeState(); const actionResult = evaluate(itemState); const result = execute(itemState).result; assert.equal(actionResult.definition.rarityTransition, null); assert.equal(result.resultingItemState.rarity, "rare");
});
test("30 successful output follows recursive immutability convention", () => {
  const result = execute(makeState()).result; assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.resultingItemState)); assert.ok(Object.isFrozen(result.removedModifier.metadata));
});
test("31 crafted candidate injection is rejected atomically", () => {
  const itemState = makeState(); const actionResult = clone(evaluate(itemState)); actionResult.selectionRequests[0].candidates[0].instanceId = "crafted-a"; const result = simulateCraftingStep({ itemState, actionResult, selectionResults: [] }); assert.equal(code(result), ENGINE_SIMULATOR_CODES.REQUEST_MISMATCH); assert.equal(result.resultingItemState, null);
});
test("32 desecrated candidate injection is rejected atomically", () => {
  const itemState = makeState(); const actionResult = clone(evaluate(itemState)); actionResult.selectionRequests[0].candidates[0].instanceId = "desecrated-a"; const result = simulateCraftingStep({ itemState, actionResult, selectionResults: [] }); assert.equal(code(result), ENGINE_SIMULATOR_CODES.REQUEST_MISMATCH); assert.equal(result.resultingItemState, null);
});
test("33 empty pool cannot produce a partial simulation", () => {
  const itemState = makeState({ prefixModifiers: [], suffixModifiers: [] }); const result = simulateCraftingStep({ itemState, actionResult: evaluate(itemState), selectionResults: [] }); assert.equal(result.status, "inapplicable"); assert.equal(result.resultingItemState, null); assert.equal(itemState.revision, 0);
});
test("34 simulator returns the validated removal selection result", () => {
  const { selectionResult, result } = execute(makeState(), { rngState: createSeededRandom(42) }); assert.deepEqual(result.selectionResult, selectionResult); assert.ok(Object.isFrozen(result.selectionResult));
});
