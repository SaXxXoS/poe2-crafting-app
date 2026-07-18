import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ENGINE_ACTION_CODES, ENGINE_ELIGIBILITY_CODES, createItemState, createModifierCatalog, createRuleContext, evaluateCraftingAction,
  getCraftingActionDefinition, immutableCopy, listCraftingActionDefinitions, loadModifierCatalog
} from "../index.mjs";

const ACTION_IDS = ["currency:alteration", "currency:augmentation", "currency:chaos", "currency:exalted", "currency:regal", "currency:transmutation"];
const TEST_CAPACITY_RULES = Object.freeze({ prefix: 10, suffix: 10 });
const TEST_COUNTS = Object.freeze({ "currency:alteration": 2, "currency:chaos": 3, "currency:transmutation": 2 });
const TEST_REMOVALS = Object.freeze({ "currency:alteration": 1, "currency:chaos": 2 });

function documents() {
  const makeMod = (modId, generationType, group, tag, tier) => ({ modId, generationType, domain: "item", technicalStats: [{ id: `${modId}:stat` }],
    tier, requiredLevel: 1, spawnWeights: [{ tag, weight: 100 }, { tag: "default", weight: 0 }], generationWeights: [], groups: [group], flags: [], source: "poe2db" });
  const mods = [makeMod("mod:prefix", "prefix", "Damage", "bow", 2), makeMod("mod:suffix", "suffix", "Speed", "bow", 10), makeMod("mod:spear", "prefix", "Spear", "spear", 1)];
  return {
    index: { classes: [{ id: "Bow" }, { id: "Spear" }] },
    bases: { bases: [{ id: "base:bow", itemClass: "Bow", tags: ["bow", "weapon", "default"] }, { id: "base:spear", itemClass: "Spear", tags: ["spear", "weapon", "default"] }] },
    mods: { mods },
    affixGroups: { groups: mods.map((mod, index) => ({ familyId: `family:${index}`, generationType: mod.generationType, tiers: [{ modId: mod.modId,
      technicalTier: mod.tier, displayTiers: { [mod.modId === "mod:spear" ? "Spear" : "Bow"]: index + 1 }, requiredLevel: 1,
      spawnWeights: mod.spawnWeights, generationWeights: [], craftingSources: [], regularClasses: [mod.modId === "mod:spear" ? "Spear" : "Bow"], specialClasses: [], requiredBaseTagsAny: [] }] })) }
  };
}
const catalog = change => { const docs = documents(); change?.(docs); return createModifierCatalog(docs); };
const item = (rarity = "magic", changes = {}) => createItemState({ itemId: "item:action", baseTypeId: "base:bow", itemClassId: "Bow", itemLevel: 86, rarity, ...changes });
const instance = (modId, generationType = "prefix") => ({ instanceId: `instance:${modId}`, modId, familyId: "family:0", generationType, domain: "item", technicalTier: 1, statIds: ["stat"], values: [{}], source: "normal", appliedAtRevision: 0 });
const rules = (extra = {}) => ({ capacityRules: TEST_CAPACITY_RULES, selectionCountRules: TEST_COUNTS, removalRules: TEST_REMOVALS, ...extra });
const evaluate = (actionId, rarity, changes = {}) => evaluateCraftingAction({ actionId, itemState: changes.itemState ?? item(rarity), catalog: changes.catalog ?? catalog(),
  ruleContext: changes.ruleContext ?? null, actionContext: changes.actionContext ?? rules(), options: changes.options ?? {} });
const has = (result, code) => result.reasons.some(entry => entry.code === code);

test("1 all six action IDs are registered", () => assert.deepEqual(listCraftingActionDefinitions().map(entry => entry.id), ACTION_IDS));
test("2 action IDs are unique", () => assert.equal(new Set(listCraftingActionDefinitions().map(entry => entry.id)).size, 6));
test("3 definitions have stable technical order", () => assert.deepEqual(listCraftingActionDefinitions().map(entry => entry.id), ACTION_IDS));
test("4 unknown action is structured", () => { const result = evaluateCraftingAction({ actionId: "currency:unknown" }); assert.equal(result.status, "error"); assert.equal(result.errors[0].code, ENGINE_ACTION_CODES.UNKNOWN); });
test("5 definitions are recursively immutable", () => { const value = getCraftingActionDefinition("currency:chaos"); assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.notes)); });
test("6 definitions contain no time or random values", () => assert.doesNotMatch(JSON.stringify(listCraftingActionDefinitions()), /generatedAt|Date\(|Math\.random|randomId/));
test("7 definitions use stable technical identity", () => { for (const entry of listCraftingActionDefinitions()) assert.match(entry.id, /^currency:[a-z]+$/); });
test("8 invalid item state is error", () => assert.equal(evaluateCraftingAction({ actionId: "currency:augmentation", itemState: {}, catalog: catalog() }).status, "error"));
test("9 invalid catalog context is error", () => assert.equal(evaluateCraftingAction({ actionId: "currency:augmentation", itemState: item(), catalog: {} }).status, "error"));
test("10 inputs are not mutated", () => { const state = item(); const cat = catalog(); const actionContext = rules(); const ruleContext = createRuleContext({ itemState: state, catalog: cat, actionContext }); const options = { requireDomain: false }; const before = [state, cat, ruleContext, actionContext, options].map(JSON.stringify); evaluateCraftingAction({ actionId: "currency:augmentation", itemState: state, catalog: cat, ruleContext, actionContext, options }); assert.deepEqual([state, cat, ruleContext, actionContext, options].map(JSON.stringify), before); });
test("11 result is recursively immutable", () => { const result = evaluate("currency:augmentation", "magic"); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.reasons)); assert.ok(Object.isFrozen(result.selectionRequests[0])); });
test("12 identical inputs produce byte-identical results", () => assert.equal(JSON.stringify(evaluate("currency:augmentation", "magic")), JSON.stringify(evaluate("currency:augmentation", "magic"))));
test("13 permuted equivalent rules produce byte-identical results", () => { const a = evaluate("currency:augmentation", "magic", { actionContext: { capacityRules: { prefix: 10, suffix: 10 }, selectionCountRules: TEST_COUNTS, removalRules: TEST_REMOVALS } }); const b = evaluate("currency:augmentation", "magic", { actionContext: { removalRules: TEST_REMOVALS, selectionCountRules: TEST_COUNTS, capacityRules: { suffix: 10, prefix: 10 } } }); assert.equal(JSON.stringify(a), JSON.stringify(b)); });
test("14 production action code has no locale comparator", () => { const source = readFileSync(new URL("../crafting-actions.mjs", import.meta.url), "utf8"); assert.equal(source.includes(".localeCompare("), false); assert.equal(source.includes("Intl.Collator"), false); });
test("15 status priority error outranks fail and unresolved", () => { const base = catalog(); const bad = immutableCopy({ ...base, modifiers: { ...base.modifiers, "mod:prefix": { ...base.modifiers["mod:prefix"], spawnWeights: [{ tag: "bow", value: 1 }] } } }); const result = evaluate("currency:augmentation", "normal", { catalog: bad, actionContext: {} }); assert.equal(result.status, "error"); });
test("16 reasons errors and warnings are deterministically ordered", () => assert.equal(JSON.stringify(evaluate("currency:augmentation", "magic")), JSON.stringify(evaluate("currency:augmentation", "magic"))));
test("17 mutation plan executes nothing", () => { for (const step of evaluate("currency:regal", "magic").mutationPlan) assert.equal(step.applied, false); });
test("18 no selection request contains a selected result", () => assert.doesNotMatch(JSON.stringify(evaluate("currency:augmentation", "magic").selectionRequests), /selectedModifier|selectedCandidate|resultModifier/));

for (const [number, rarity, status] of [[19, "normal", "applicable"], [20, "magic", "inapplicable"], [21, "rare", "inapplicable"]]) test(`${number} transmutation rarity ${rarity} is ${status}`, () => assert.equal(evaluate("currency:transmutation", rarity).status, status));
test("22 transmutation count is not guessed", () => assert.equal(evaluate("currency:transmutation", "normal", { actionContext: { capacityRules: TEST_CAPACITY_RULES } }).status, "unresolved"));
test("23 explicit transmutation rules create a request", () => assert.equal(evaluate("currency:transmutation", "normal").selectionRequests.length, 1));
test("24 transmutation rarity change is planned only", () => { const state = item("normal"); const result = evaluate("currency:transmutation", "normal", { itemState: state }); assert.equal(state.rarity, "normal"); assert.deepEqual(result.mutationPlan[0], { sequence: 0, operation: "set-rarity", rarity: "magic", applied: false }); });

test("25 augmentation with capacity and candidates is applicable", () => assert.equal(evaluate("currency:augmentation", "magic").status, "applicable"));
test("26 normal item is inapplicable for augmentation", () => assert.equal(evaluate("currency:augmentation", "normal").status, "inapplicable"));
test("27 rare item is inapplicable for augmentation", () => assert.equal(evaluate("currency:augmentation", "rare").status, "inapplicable"));
test("28 unresolved candidates make augmentation unresolved", () => assert.equal(evaluate("currency:augmentation", "magic", { actionContext: {} }).status, "unresolved"));
test("29 no eligible or unresolved candidates is inapplicable", () => { const cat = catalog(d => { for (const group of d.affixGroups.groups) group.tiers[0].spawnWeights = [{ tag: "never", weight: 1 }]; }); assert.equal(evaluate("currency:augmentation", "magic", { catalog: cat }).status, "inapplicable"); });
test("30 augmentation preserves modifiers in plan", () => assert.ok(evaluate("currency:augmentation", "magic").mutationPlan.some(step => step.operation === "preserve-existing-modifiers")));
test("31 augmentation addition is request only", () => assert.equal(evaluate("currency:augmentation", "magic").mutationPlan.at(-1).operation, "add-selected-modifier"));

for (const [number, rarity, status] of [[32, "magic", "unresolved"], [33, "normal", "inapplicable"], [34, "rare", "inapplicable"]]) test(`${number} alteration rarity ${rarity} is ${status}`, () => assert.equal(evaluate("currency:alteration", rarity).status, status));
test("35 missing alteration replacement rules is unresolved", () => assert.equal(evaluate("currency:alteration", "magic", { actionContext: { capacityRules: TEST_CAPACITY_RULES } }).status, "unresolved"));
test("36 alteration does not remove existing modifiers", () => { const state = item("magic", { prefixModifiers: [instance("mod:prefix")] }); evaluate("currency:alteration", "magic", { itemState: state }); assert.equal(state.prefixModifiers.length, 1); });
test("37 alteration performs no modifier selection", () => assert.doesNotMatch(JSON.stringify(evaluate("currency:alteration", "magic")), /selectedModifier/));

test("38 regal with safe rules can be applicable", () => assert.equal(evaluate("currency:regal", "magic").status, "applicable"));
test("39 normal item is inapplicable for regal", () => assert.equal(evaluate("currency:regal", "normal").status, "inapplicable"));
test("40 rare item is inapplicable for regal", () => assert.equal(evaluate("currency:regal", "rare").status, "inapplicable"));
test("41 regal plans rare rarity", () => assert.equal(evaluate("currency:regal", "magic").mutationPlan[0].rarity, "rare"));
test("42 regal plans an addition request", () => assert.equal(evaluate("currency:regal", "magic").selectionRequests[0].type, "modifier-addition"));
test("43 regal does not select a modifier", () => assert.doesNotMatch(JSON.stringify(evaluate("currency:regal", "magic")), /selectedModifier/));

test("44 exalted with capacity and candidates is applicable", () => assert.equal(evaluate("currency:exalted", "rare").status, "applicable"));
test("45 normal item is inapplicable for exalted", () => assert.equal(evaluate("currency:exalted", "normal").status, "inapplicable"));
test("46 magic item is inapplicable for exalted", () => assert.equal(evaluate("currency:exalted", "magic").status, "inapplicable"));
test("47 exalted without capacity is unresolved", () => assert.equal(evaluate("currency:exalted", "rare", { actionContext: {} }).status, "unresolved"));
test("48 exalted preserves existing modifiers", () => assert.ok(evaluate("currency:exalted", "rare").mutationPlan.some(step => step.operation === "preserve-existing-modifiers")));
test("49 exalted applies no modifier", () => assert.doesNotMatch(JSON.stringify(evaluate("currency:exalted", "rare")), /applied":true|selectedModifier/));

test("50 rare item enters deferred chaos planning", () => assert.equal(evaluate("currency:chaos", "rare").status, "unresolved"));
test("51 normal item is inapplicable for chaos", () => assert.equal(evaluate("currency:chaos", "normal").status, "inapplicable"));
test("52 magic item is inapplicable for chaos", () => assert.equal(evaluate("currency:chaos", "magic").status, "inapplicable"));
test("53 missing chaos replacement rules is unresolved", () => assert.equal(evaluate("currency:chaos", "rare", { actionContext: { capacityRules: TEST_CAPACITY_RULES } }).status, "unresolved"));
test("54 chaos count is not guessed", () => assert.equal(getCraftingActionDefinition("currency:chaos").selectionCount, null));
test("55 chaos removes no current modifier", () => { const state = item("rare", { prefixModifiers: [instance("mod:prefix")] }); evaluate("currency:chaos", "rare", { itemState: state }); assert.equal(state.prefixModifiers.length, 1); });
test("56 chaos selects no new modifier", () => assert.doesNotMatch(JSON.stringify(evaluate("currency:chaos", "rare")), /selectedModifier/));

test("57 action result embeds resolver output", () => assert.equal(evaluate("currency:augmentation", "magic").eligibilityResult.contextSummary.mode, "regular"));
test("58 invalid eligibility result makes action error", () => { const base = catalog(); const bad = immutableCopy({ ...base, modifiers: { ...base.modifiers, "mod:prefix": { ...base.modifiers["mod:prefix"], spawnWeights: [{}] } } }); assert.equal(evaluate("currency:augmentation", "magic", { catalog: bad }).status, "error"); });
test("59 eligible candidates are stably copied", () => assert.deepEqual(evaluate("currency:augmentation", "magic").selectionRequests[0].candidates.map(entry => entry.modifierId), ["mod:prefix", "mod:suffix"]));
test("60 unresolved candidates are not selectable", () => assert.equal(evaluate("currency:augmentation", "magic", { actionContext: {} }).selectionRequests.length, 0));
test("61 ineligible candidates are absent from request", () => assert.equal(evaluate("currency:augmentation", "magic").selectionRequests[0].candidates.some(entry => entry.modifierId === "mod:spear"), false));
test("62 raw weights are retained", () => assert.deepEqual(evaluate("currency:augmentation", "magic").selectionRequests[0].candidates[0].rawWeight, { spawn: 100, generation: 1, spawnTag: "bow", generationTag: null }));
test("63 no probabilities are calculated", () => assert.doesNotMatch(JSON.stringify(evaluate("currency:augmentation", "magic")), /probability|chance|percent/));
test("64 no weighted selection result exists", () => assert.equal(evaluate("currency:augmentation", "magic").selectionRequests[0].weighting.normalized, false));

test("65 no capacity is guessed", () => assert.equal(evaluate("currency:augmentation", "magic", { actionContext: {} }).status, "unresolved"));
test("66 explicit synthetic capacity permits slots", () => assert.equal(evaluate("currency:augmentation", "magic").status, "applicable"));
test("67 full prefix side blocks prefix candidates", () => { const state = item("magic", { prefixModifiers: [instance("mod:prefix")] }); const result = evaluate("currency:augmentation", "magic", { itemState: state, actionContext: rules({ capacityRules: { prefix: 1, suffix: 10 } }) }); assert.deepEqual(result.selectionRequests[0].candidates.map(entry => entry.modifierId), ["mod:suffix"]); const prefix = result.eligibilityResult.ineligible.find(entry => entry.modifierId === "mod:prefix"); assert.ok(prefix.reasons.some(entry => entry.code === ENGINE_ELIGIBILITY_CODES.PREFIX_CAPACITY_REACHED)); });
test("68 full suffix side blocks suffix candidates", () => { const state = item("magic", { suffixModifiers: [instance("mod:suffix", "suffix")] }); const result = evaluate("currency:augmentation", "magic", { itemState: state, actionContext: rules({ capacityRules: { prefix: 10, suffix: 1 } }) }); assert.deepEqual(result.selectionRequests[0].candidates.map(entry => entry.modifierId), ["mod:prefix"]); const suffix = result.eligibilityResult.ineligible.find(entry => entry.modifierId === "mod:suffix"); assert.ok(suffix.reasons.some(entry => entry.code === ENGINE_ELIGIBILITY_CODES.SUFFIX_CAPACITY_REACHED)); });
test("69 test capacities are not definitions", () => assert.equal(JSON.stringify(listCraftingActionDefinitions()).includes("capacityRules"), false));
test("70 invalid capacity rules are context error", () => assert.equal(evaluate("currency:augmentation", "magic", { actionContext: { capacityRules: { prefix: -1 } } }).status, "error"));

test("71 selection IDs and keys are stable", () => { const a = evaluate("currency:augmentation", "magic").selectionRequests[0]; const b = evaluate("currency:augmentation", "magic").selectionRequests[0]; assert.equal(a.id, b.id); assert.equal(a.deterministicKey, b.deterministicKey); });
test("72 candidate ordering is explicit technical order", () => assert.deepEqual(evaluate("currency:augmentation", "magic").selectionRequests[0].candidates.map(entry => entry.modifierId), ["mod:prefix", "mod:suffix"]));
test("73 unknown transmutation count stays unresolved", () => assert.equal(evaluate("currency:transmutation", "normal", { actionContext: { capacityRules: TEST_CAPACITY_RULES } }).selectionRequests.length, 0));
test("74 request has no chosen candidate", () => assert.doesNotMatch(JSON.stringify(evaluate("currency:augmentation", "magic").selectionRequests[0]), /chosen|selected/));
test("75 requests are recursively immutable", () => { const request = evaluate("currency:augmentation", "magic").selectionRequests[0]; assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(request.candidates)); });
test("76 equivalent requests are byte-identical", () => assert.equal(JSON.stringify(evaluate("currency:augmentation", "magic").selectionRequests), JSON.stringify(evaluate("currency:augmentation", "magic").selectionRequests)));
test("77 removal request describes later selection", () => { const request = evaluate("currency:chaos", "rare").selectionRequests.find(entry => entry.type === "modifier-removal"); assert.ok(request); assert.equal(request.weighting.mode, "none"); assert.equal(request.executable, false); });
test("78 requests contain no time or paths", () => assert.doesNotMatch(JSON.stringify(evaluate("currency:chaos", "rare").selectionRequests), /generatedAt|Date\(|Math\.random|[A-Za-z]:\\/));

for (const [number, itemClassId] of [[79, "Spear"], [80, "Bow"], [81, "Body Armour"], [82, "Ring"], [83, "Jewel"]]) test(`${number} real ${itemClassId} action sample loads`, () => {
  const cat = loadModifierCatalog(); const base = Object.values(cat.baseTypes).find(entry => entry.itemClassId === itemClassId); assert.ok(base);
  const state = createItemState({ itemId: `real:${itemClassId}`, baseTypeId: base.id, itemClassId, itemLevel: 86, rarity: "rare" });
  const result = evaluateCraftingAction({ actionId: "currency:exalted", itemState: state, catalog: cat }); assert.equal(result.status, "unresolved"); assert.equal(result.valid, true);
});
test("84 real decisions stay unresolved without invented rules", () => { const cat = loadModifierCatalog(); const base = Object.values(cat.baseTypes).find(entry => entry.itemClassId === "Bow"); const state = createItemState({ itemId: "real", baseTypeId: base.id, itemClassId: "Bow", itemLevel: 86, rarity: "rare" }); assert.equal(evaluateCraftingAction({ actionId: "currency:exalted", itemState: state, catalog: cat }).status, "unresolved"); });
test("85 real tests do not mutate catalog", () => { const cat = loadModifierCatalog(); const before = JSON.stringify(cat); const base = Object.values(cat.baseTypes)[0]; const state = createItemState({ itemId: "real", baseTypeId: base.id, itemClassId: base.itemClassId, itemLevel: 86, rarity: "rare" }); evaluateCraftingAction({ actionId: "currency:exalted", itemState: state, catalog: cat }); assert.equal(JSON.stringify(cat), before); });

for (const [number, label, assertion] of [
  [86, "item-state API remains exported", async () => assert.equal(typeof (await import("../index.mjs")).createItemState, "function")],
  [87, "rule-set API remains exported", async () => assert.equal(typeof (await import("../index.mjs")).evaluateRuleSets, "function")],
  [88, "eligible resolver remains exported", async () => assert.equal(typeof (await import("../index.mjs")).resolveEligibleModifiers, "function")],
  [89, "action API is exported", async () => assert.equal(typeof (await import("../index.mjs")).evaluateCraftingAction, "function")],
  [90, "action code has no UI dependency", () => assert.doesNotMatch(readFileSync(new URL("../crafting-actions.mjs", import.meta.url), "utf8"), /document\.|window\.|app\.js/)]
]) test(`${number} ${label}`, assertion);

test("91 alteration never claims a pool against modifiers scheduled for removal", () => {
  const state = item("magic", { prefixModifiers: [instance("mod:prefix")] }); const before = JSON.stringify(state);
  const result = evaluate("currency:alteration", "magic", { itemState: state });
  assert.equal(result.status, "unresolved"); assert.equal(result.eligibilityResult, null);
  assert.equal(result.selectionRequests.some(request => request.type === "modifier-addition"), false);
  assert.equal(result.selectionRequests.some(request => request.type === "modifier-removal"), true);
  assert.equal(JSON.stringify(state), before);
});
test("92 chaos full current sides do not become a false replacement pool", () => {
  const state = item("rare", { prefixModifiers: [instance("mod:prefix")], suffixModifiers: [instance("mod:suffix", "suffix")] }); const before = JSON.stringify(state);
  const result = evaluate("currency:chaos", "rare", { itemState: state, actionContext: rules({ capacityRules: { prefix: 1, suffix: 1 } }) });
  assert.equal(result.status, "unresolved"); assert.equal(result.eligibilityResult, null);
  assert.equal(result.selectionRequests.some(request => request.type === "modifier-addition"), false);
  assert.equal(JSON.stringify(state), before);
});
test("93 duplicate modifier is not evaluated against deferred replacement addition", () => {
  const state = item("magic", { prefixModifiers: [instance("mod:prefix")] }); const result = evaluate("currency:alteration", "magic", { itemState: state });
  assert.equal(result.eligibilityResult, null); assert.equal(JSON.stringify(result).includes(ENGINE_ELIGIBILITY_CODES.DUPLICATE_MODIFIER), false);
});
test("94 mod-group conflict is not evaluated against deferred replacement addition", () => {
  const state = item("rare", { prefixModifiers: [instance("mod:prefix")] }); const result = evaluate("currency:chaos", "rare", { itemState: state });
  assert.equal(result.eligibilityResult, null); assert.equal(JSON.stringify(result).includes(ENGINE_ELIGIBILITY_CODES.MOD_GROUP_CONFLICT), false);
});
test("95 replacement mutation order clears before deferred replacement", () => {
  for (const actionId of ["currency:alteration", "currency:chaos"]) {
    const result = evaluate(actionId, actionId.endsWith("alteration") ? "magic" : "rare");
    assert.deepEqual(result.mutationPlan.map(step => step.operation), ["clear-random-modifiers", "replace-random-modifiers"]);
    assert.equal(result.mutationPlan[0].selectionRequestId, result.selectionRequests.find(request => request.type === "modifier-removal").id);
    assert.equal(result.mutationPlan[1].selectionRequestId, null);
  }
});
test("96 replacement resolver deferral survives deliberately invalid modifier weights", () => {
  const base = catalog(); const bad = immutableCopy({ ...base, modifiers: { ...base.modifiers, "mod:prefix": { ...base.modifiers["mod:prefix"], spawnWeights: [{}] } } });
  for (const [actionId, rarity] of [["currency:alteration", "magic"], ["currency:chaos", "rare"]]) {
    const result = evaluate(actionId, rarity, { catalog: bad }); assert.equal(result.valid, true); assert.equal(result.status, "unresolved"); assert.equal(result.eligibilityResult, null);
  }
});
test("97 non-replacement additions still use the resolver state and conflicts", () => {
  for (const [actionId, rarity] of [["currency:augmentation", "magic"], ["currency:regal", "magic"], ["currency:exalted", "rare"]]) {
    const state = item(rarity, { prefixModifiers: [instance("mod:prefix")] }); const result = evaluate(actionId, rarity, { itemState: state });
    assert.ok(result.eligibilityResult); const duplicate = result.eligibilityResult.ineligible.find(candidate => candidate.modifierId === "mod:prefix");
    assert.ok(duplicate.reasons.some(entry => entry.code === ENGINE_ELIGIBILITY_CODES.DUPLICATE_MODIFIER));
  }
});
test("98 action source contains one centralized resolver invocation site", () => {
  const source = readFileSync(new URL("../crafting-actions.mjs", import.meta.url), "utf8");
  assert.equal(source.match(/resolveEligibleModifiers\(\{/g)?.length, 1);
});
test("99 request counts stay consistent with definitions and summaries", () => {
  for (const [actionId, rarity] of [["currency:transmutation", "normal"], ["currency:augmentation", "magic"], ["currency:alteration", "magic"], ["currency:regal", "magic"], ["currency:exalted", "rare"], ["currency:chaos", "rare"]]) {
    const result = evaluate(actionId, rarity); const definition = getCraftingActionDefinition(actionId);
    const additions = result.selectionRequests.filter(request => request.type === "modifier-addition"); const removals = result.selectionRequests.filter(request => request.type === "modifier-removal");
    assert.equal(result.summary.selectionRequestCount, additions.length); assert.equal(result.summary.removalRequestCount, removals.length);
    if (definition.selectionCount !== null && additions.length) assert.equal(additions[0].count, definition.selectionCount);
    if (definition.removalCount !== null && removals.length) assert.equal(removals[0].count, definition.removalCount);
  }
});
