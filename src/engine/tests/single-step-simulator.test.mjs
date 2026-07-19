import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ENGINE_SIMULATOR_CODES, createItemState, createModifierCatalog, createSeededRandom,
  evaluateCraftingAction, selectWeightedModifier, simulateCraftingStep, validateItemState
} from "../index.mjs";

const mod = (id, generationType, weight, familyId) => ({ modId: id, generationType, domain: "item", technicalStats: [{ id: `${id}:stat` }], tier: 1, requiredLevel: 1, spawnWeights: [{ tag: "bow", weight }], generationWeights: [], groups: [familyId], flags: [], source: "poe2db" });
function documents() {
  const mods = [mod("mod:existing", "prefix", 1, "family:existing"), mod("mod:add-prefix", "prefix", 1, "family:add-prefix"), mod("mod:add-suffix", "suffix", 3, "family:add-suffix")];
  return {
    index: { classes: [{ id: "Bow" }] }, bases: { bases: [{ id: "base:bow", itemClass: "Bow", tags: ["bow", "weapon", "default"] }] }, mods: { mods },
    affixGroups: { groups: mods.map(entry => ({ familyId: entry.groups[0], generationType: entry.generationType, tiers: [{ modId: entry.modId, technicalTier: 1, displayTiers: { Bow: 1 }, requiredLevel: 1, spawnWeights: entry.spawnWeights, generationWeights: [], craftingSources: [], regularClasses: ["Bow"], specialClasses: [], requiredBaseTagsAny: [] }] })) }
  };
}
const existing = () => ({ instanceId: "instance:existing", modId: "mod:existing", familyId: "family:existing", generationType: "prefix", domain: "item", technicalTier: 1, displayTier: 1, statIds: ["mod:existing:stat"], values: [], source: "normal", appliedAtRevision: 0, metadata: {} });
const state = rarity => createItemState({ itemId: `item:${rarity}`, baseTypeId: "base:bow", itemClassId: "Bow", itemLevel: 86, rarity, prefixModifiers: rarity === "normal" ? [] : [existing()] });
const catalog = () => createModifierCatalog(documents());
function pipeline(actionId, rarity, random = 0.75) {
  const itemState = state(rarity); const cat = catalog();
  const actionResult = evaluateCraftingAction({ actionId, itemState, catalog: cat, actionContext: { capacityRules: { prefix: 3, suffix: 3 } } });
  const selectionResult = selectWeightedModifier(actionResult.selectionRequests[0], { random: () => random });
  return { itemState, cat, actionResult, selectionResult, result: simulateCraftingStep({ itemState, actionResult, selectionResults: [selectionResult] }) };
}
const code = result => result.reasons[0]?.code;
const clone = value => structuredClone(value);

test("1 augmentation applies exactly one selected modifier", () => {
  const { itemState, result, selectionResult } = pipeline("currency:augmentation", "magic");
  assert.equal(result.status, "simulated"); assert.equal(result.valid, true); assert.equal(result.resultingItemState.rarity, "magic");
  assert.equal(result.resultingItemState.prefixModifiers.length + result.resultingItemState.suffixModifiers.length, 2);
  assert.equal([...result.resultingItemState.prefixModifiers, ...result.resultingItemState.suffixModifiers].at(-1).modId, selectionResult.selectedCandidateId);
  assert.equal(itemState.prefixModifiers.length, 1);
});
test("2 regal changes rarity and adds exactly one modifier", () => {
  const { result } = pipeline("currency:regal", "magic", 0); assert.equal(result.status, "simulated"); assert.equal(result.resultingItemState.rarity, "rare");
  assert.equal(result.resultingItemState.prefixModifiers.length + result.resultingItemState.suffixModifiers.length, 2);
});
test("3 exalted preserves rare rarity and adds exactly one modifier", () => {
  const { result } = pipeline("currency:exalted", "rare", 0.9); assert.equal(result.status, "simulated"); assert.equal(result.resultingItemState.rarity, "rare"); assert.equal(result.consumedSelectionRequestIds.length, 1);
});
test("4 successful simulation increments revision exactly once", () => {
  const { itemState, result } = pipeline("currency:regal", "magic"); assert.equal(result.originalItemRevision, 0); assert.equal(result.resultingItemRevision, 1); assert.equal(result.resultingItemState.revision, itemState.revision + 1);
});
test("5 resulting modifier uses selected technical candidate data", () => {
  const { result, selectionResult } = pipeline("currency:augmentation", "magic", 0.9); const added = result.resultingItemState.suffixModifiers[0]; const selected = selectionResult.selectedCandidate;
  assert.equal(added.modId, selected.modifierId); assert.equal(added.familyId, selected.familyId); assert.equal(added.generationType, selected.generationType); assert.equal(added.technicalTier, selected.technicalTier); assert.equal(added.displayTier, selected.displayTier); assert.deepEqual(added.values, []); assert.equal(added.appliedAtRevision, 1);
});
test("6 resulting item validates through central item-state validation", () => assert.equal(validateItemState(pipeline("currency:exalted", "rare").result.resultingItemState).revision, 1));
test("7 transmutation without known count remains unresolved atomically", () => {
  const itemState = state("normal"), actionResult = evaluateCraftingAction({ actionId: "currency:transmutation", itemState, catalog: catalog(), actionContext: { capacityRules: { prefix: 3, suffix: 3 } } }); const before = JSON.stringify(itemState); const result = simulateCraftingStep({ itemState, actionResult, selectionResults: [] });
  assert.equal(result.status, "unresolved"); assert.equal(result.resultingItemState, null); assert.equal(JSON.stringify(itemState), before);
});
test("8 alteration remains unresolved", () => {
  const itemState = state("magic"), actionResult = evaluateCraftingAction({ actionId: "currency:alteration", itemState, catalog: catalog(), actionContext: { removalRules: { "currency:alteration": 1 } } }); assert.equal(simulateCraftingStep({ itemState, actionResult, selectionResults: [] }).status, "unresolved");
});
test("9 chaos remains unresolved", () => {
  const itemState = state("rare"), actionResult = evaluateCraftingAction({ actionId: "currency:chaos", itemState, catalog: catalog(), actionContext: { removalRules: { "currency:chaos": 1 } } }); assert.equal(simulateCraftingStep({ itemState, actionResult, selectionResults: [] }).status, "unresolved");
});
test("10 missing item state is a structured error", () => { const r = simulateCraftingStep({}); assert.equal(r.status, "error"); assert.equal(code(r), ENGINE_SIMULATOR_CODES.ITEM_STATE_INVALID); });
test("11 invalid item state is a structured error", () => { const r = simulateCraftingStep({ itemState: { revision: 0 }, actionResult: {} }); assert.equal(code(r), ENGINE_SIMULATOR_CODES.ITEM_STATE_INVALID); });
test("12 missing action result is a structured error", () => { const r = simulateCraftingStep({ itemState: state("magic") }); assert.equal(code(r), ENGINE_SIMULATOR_CODES.INPUT_INVALID); });
test("13 inapplicable action result remains inapplicable", () => {
  const itemState = state("normal"), actionResult = evaluateCraftingAction({ actionId: "currency:augmentation", itemState, catalog: catalog() }); const r = simulateCraftingStep({ itemState, actionResult }); assert.equal(r.status, "inapplicable"); assert.equal(code(r), ENGINE_SIMULATOR_CODES.ACTION_NOT_EXECUTABLE);
});
test("14 error action result is not executable", () => { const r = simulateCraftingStep({ itemState: state("magic"), actionResult: { valid: false, status: "error" } }); assert.equal(r.status, "inapplicable"); });
test("15 applicable result without mutation plan is an error", () => { const r = simulateCraftingStep({ itemState: state("magic"), actionResult: { valid: true, status: "applicable", summary: { applicable: true }, selectionRequests: [] } }); assert.equal(code(r), ENGINE_SIMULATOR_CODES.MUTATION_PLAN_INVALID); });
test("16 malformed mutation plan is rejected", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const bad = clone(actionResult); bad.mutationPlan[0].sequence = 4; assert.equal(code(simulateCraftingStep({ itemState, actionResult: bad, selectionResults: [selectionResult] })), ENGINE_SIMULATOR_CODES.MUTATION_PLAN_INVALID);
});
test("17 unknown operation is unresolved", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const bad = clone(actionResult); bad.mutationPlan[0].operation = "future-operation"; const r = simulateCraftingStep({ itemState, actionResult: bad, selectionResults: [selectionResult] }); assert.equal(r.status, "unresolved"); assert.equal(code(r), ENGINE_SIMULATOR_CODES.OPERATION_UNSUPPORTED);
});
test("18 removal operation is unsupported", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const bad = clone(actionResult); bad.mutationPlan[0].operation = "clear-random-modifiers"; assert.equal(code(simulateCraftingStep({ itemState, actionResult: bad, selectionResults: [selectionResult] })), ENGINE_SIMULATOR_CODES.OPERATION_UNSUPPORTED);
});
test("19 replacement operation is unsupported", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const bad = clone(actionResult); bad.mutationPlan[0].operation = "replace-random-modifiers"; assert.equal(code(simulateCraftingStep({ itemState, actionResult: bad, selectionResults: [selectionResult] })), ENGINE_SIMULATOR_CODES.OPERATION_UNSUPPORTED);
});
test("20 multiple additions are rejected", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const bad = clone(actionResult); bad.mutationPlan.push({ ...bad.mutationPlan.at(-1), sequence: bad.mutationPlan.length }); assert.equal(code(simulateCraftingStep({ itemState, actionResult: bad, selectionResults: [selectionResult] })), ENGINE_SIMULATOR_CODES.MUTATION_PLAN_INVALID);
});
test("21 count greater than one is rejected", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const bad = clone(actionResult); bad.selectionRequests[0].count = 2; assert.equal(code(simulateCraftingStep({ itemState, actionResult: bad, selectionResults: [selectionResult] })), ENGINE_SIMULATOR_CODES.REQUEST_MISMATCH);
});
test("22 missing selection result is rejected", () => { const { itemState, actionResult } = pipeline("currency:augmentation", "magic"); assert.equal(code(simulateCraftingStep({ itemState, actionResult, selectionResults: [] })), ENGINE_SIMULATOR_CODES.SELECTION_MISSING); });
test("23 wrong request ID is rejected", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const bad = clone(selectionResult); bad.requestId = "selection:foreign"; assert.equal(code(simulateCraftingStep({ itemState, actionResult, selectionResults: [bad] })), ENGINE_SIMULATOR_CODES.REQUEST_MISMATCH);
});
test("24 invalid selection status is rejected", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const bad = clone(selectionResult); bad.status = "error"; bad.valid = false; assert.equal(code(simulateCraftingStep({ itemState, actionResult, selectionResults: [bad] })), ENGINE_SIMULATOR_CODES.SELECTION_INVALID);
});
test("25 missing selected candidate is rejected", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const bad = clone(selectionResult); bad.selectedCandidate = null; assert.equal(code(simulateCraftingStep({ itemState, actionResult, selectionResults: [bad] })), ENGINE_SIMULATOR_CODES.SELECTION_INVALID);
});
test("26 manipulated candidate weight is rejected", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const bad = clone(selectionResult); bad.selectedCandidate.applicableWeight.spawn += 1; assert.equal(code(simulateCraftingStep({ itemState, actionResult, selectionResults: [bad] })), ENGINE_SIMULATOR_CODES.CANDIDATE_MISMATCH);
});
test("27 manipulated candidate identity is rejected", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const bad = clone(selectionResult); bad.selectedCandidate.modifierId = "mod:foreign"; bad.selectedCandidateId = "mod:foreign"; assert.equal(code(simulateCraftingStep({ itemState, actionResult, selectionResults: [bad] })), ENGINE_SIMULATOR_CODES.CANDIDATE_MISMATCH);
});
test("28 extra selection result is rejected", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); assert.equal(code(simulateCraftingStep({ itemState, actionResult, selectionResults: [selectionResult, selectionResult] })), ENGINE_SIMULATOR_CODES.SELECTION_INVALID);
});
test("29 item revision mismatch is rejected", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const revised = createItemState({ ...itemState, revision: 1 }); assert.equal(code(simulateCraftingStep({ itemState: revised, actionResult, selectionResults: [selectionResult] })), ENGINE_SIMULATOR_CODES.STATE_MISMATCH);
});
test("30 item rarity mismatch is rejected", () => {
  const { actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); assert.equal(code(simulateCraftingStep({ itemState: state("rare"), actionResult, selectionResults: [selectionResult] })), ENGINE_SIMULATOR_CODES.STATE_MISMATCH);
});
test("31 duplicate modifier is rejected", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic", 0); const selected = selectionResult.selectedCandidate; const duplicate = { ...existing(), instanceId: "instance:duplicate", modId: selected.modifierId, familyId: selected.familyId }; const occupied = createItemState({ ...itemState, prefixModifiers: [...itemState.prefixModifiers, duplicate] }); assert.equal(code(simulateCraftingStep({ itemState: occupied, actionResult, selectionResults: [selectionResult] })), ENGINE_SIMULATOR_CODES.DUPLICATE_MODIFIER);
});
test("32 conflicting rarity transition is rejected", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:regal", "magic"); const bad = clone(actionResult); bad.mutationPlan[0].rarity = "unique"; assert.equal(code(simulateCraftingStep({ itemState, actionResult: bad, selectionResults: [selectionResult] })), ENGINE_SIMULATOR_CODES.STATE_MISMATCH);
});
test("33 failure is atomic", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const before = [JSON.stringify(itemState), JSON.stringify(actionResult), JSON.stringify(selectionResult)]; const bad = clone(selectionResult); bad.selectedIndex = 99; const result = simulateCraftingStep({ itemState, actionResult, selectionResults: [bad] }); assert.equal(result.resultingItemState, null); assert.deepEqual(result.appliedOperations, []); assert.deepEqual([JSON.stringify(itemState), JSON.stringify(actionResult), JSON.stringify(selectionResult)], before);
});
test("34 recursively frozen inputs remain byte-identical", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:exalted", "rare"); const before = [JSON.stringify(itemState), JSON.stringify(actionResult), JSON.stringify(selectionResult)]; simulateCraftingStep({ itemState, actionResult, selectionResults: [selectionResult] }); assert.deepEqual([JSON.stringify(itemState), JSON.stringify(actionResult), JSON.stringify(selectionResult)], before);
});
test("35 result and resulting state are recursively immutable and detached", () => {
  const { itemState, result } = pipeline("currency:augmentation", "magic"); assert.notEqual(result.resultingItemState, itemState); assert.ok(Object.isFrozen(result) && Object.isFrozen(result.resultingItemState) && Object.isFrozen(result.resultingItemState.prefixModifiers) && Object.isFrozen(result.appliedOperations)); assert.throws(() => { result.status = "changed"; }, TypeError);
});
test("36 identical inputs produce byte-identical simulator results", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:regal", "magic"); assert.equal(JSON.stringify(simulateCraftingStep({ itemState, actionResult, selectionResults: [selectionResult] })), JSON.stringify(simulateCraftingStep({ selectionResults: [selectionResult], actionResult, itemState })));
});
test("37 successful result records operations in explicit plan order", () => {
  const { actionResult, result } = pipeline("currency:regal", "magic"); assert.deepEqual(result.appliedOperations.map(entry => entry.operation), actionResult.mutationPlan.map(entry => entry.operation));
});
test("38 production simulator has no evaluation selection RNG catalog time or UI dependency", () => {
  const source = readFileSync(new URL("../single-step-simulator.mjs", import.meta.url), "utf8"); assert.doesNotMatch(source, /evaluateCraftingAction|resolveEligibleModifiers|selectWeightedModifier|createSeededRandom|Math\.random|Date\.now|node:crypto|catalog|document\.|window\./i);
});
test("39 manipulated request candidate no longer matches its deterministic key", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const action = clone(actionResult); const selection = clone(selectionResult); action.selectionRequests[0].candidates[selection.selectedIndex].applicableWeight.spawn += 1; selection.selectedCandidate = clone(action.selectionRequests[0].candidates[selection.selectedIndex]); assert.equal(code(simulateCraftingStep({ itemState, actionResult: action, selectionResults: [selection] })), ENGINE_SIMULATOR_CODES.REQUEST_MISMATCH);
});
test("40 rarity change after addition is rejected as invalid operation order", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:regal", "magic"); const bad = clone(actionResult); const rarity = bad.mutationPlan.shift(); rarity.sequence = bad.mutationPlan.length; bad.mutationPlan.push(rarity); bad.mutationPlan.forEach((entry, index) => { entry.sequence = index; }); assert.equal(code(simulateCraftingStep({ itemState, actionResult: bad, selectionResults: [selectionResult] })), ENGINE_SIMULATOR_CODES.MUTATION_PLAN_INVALID);
});
test("41 non-canonical selected candidate is a structured mismatch", () => {
  const { itemState, actionResult, selectionResult } = pipeline("currency:augmentation", "magic"); const bad = clone(selectionResult); bad.selectedCandidate.invalid = undefined; const result = simulateCraftingStep({ itemState, actionResult, selectionResults: [bad] }); assert.equal(result.status, "error"); assert.equal(code(result), ENGINE_SIMULATOR_CODES.CANDIDATE_MISMATCH);
});
