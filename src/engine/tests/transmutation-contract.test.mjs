import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGINE_ACTION_CODES,
  createItemState,
  createModifierCatalog,
  createSeededRandom,
  evaluateCraftingAction,
  getDefaultCapacityRules,
  selectWeightedModifier,
  serializeItemState,
  simulateCraftingStep
} from "../index.mjs";

const modifier = ({ id, generationType, weight, requiredLevel = 1, classes = ["Bow"], tag = "bow" }) => ({
  modId: id,
  generationType,
  domain: "item",
  technicalStats: [{ id: `${id}:stat` }],
  tier: 1,
  requiredLevel,
  spawnWeights: [{ tag, weight }],
  generationWeights: [],
  groups: [`family:${id}`],
  flags: [],
  source: "poe2db",
  classes
});

function documents() {
  const modifiers = [
    modifier({ id: "mod:prefix-low", generationType: "prefix", weight: 1 }),
    modifier({ id: "mod:suffix-low", generationType: "suffix", weight: 3 }),
    modifier({ id: "mod:prefix-high-level", generationType: "prefix", weight: 50, requiredLevel: 50 }),
    modifier({ id: "mod:wand-only", generationType: "suffix", weight: 50, classes: ["Wand"], tag: "wand" })
  ];
  return {
    index: { classes: [{ id: "Bow" }, { id: "Wand" }] },
    bases: { bases: [
      { id: "base:bow", itemClass: "Bow", tags: ["bow", "weapon", "default"] },
      { id: "base:wand", itemClass: "Wand", tags: ["wand", "weapon", "default"] }
    ] },
    mods: { mods: modifiers },
    affixGroups: { groups: modifiers.map(entry => ({
      familyId: entry.groups[0],
      generationType: entry.generationType,
      tiers: [{
        modId: entry.modId,
        technicalTier: 1,
        displayTiers: Object.fromEntries(entry.classes.map(itemClass => [itemClass, 1])),
        requiredLevel: entry.requiredLevel,
        spawnWeights: entry.spawnWeights,
        generationWeights: [],
        craftingSources: [],
        regularClasses: entry.classes,
        specialClasses: [],
        requiredBaseTagsAny: []
      }]
    })) }
  };
}

const catalog = () => createModifierCatalog(documents());
const magicCapacity = () => getDefaultCapacityRules().magic;
const normal = (changes = {}) => createItemState({
  itemId: "item:transmutation",
  baseTypeId: "base:bow",
  itemClassId: "Bow",
  itemLevel: 10,
  rarity: "normal",
  metadata: { retained: { marker: "technical-metadata" } },
  ...changes
});
const instance = generationType => ({
  instanceId: `instance:${generationType}`,
  modId: `mod:${generationType}-low`,
  familyId: `family:mod:${generationType}-low`,
  generationType,
  domain: "item",
  technicalTier: 1,
  displayTier: 1,
  statIds: [`mod:${generationType}-low:stat`],
  values: [],
  source: "normal",
  appliedAtRevision: 0,
  metadata: {}
});
const evaluate = (itemState = normal(), cat = catalog(), actionContext = { capacityRules: magicCapacity() }) =>
  evaluateCraftingAction({ actionId: "currency:transmutation", itemState, catalog: cat, actionContext });
const execute = (itemState = normal(), random = 0, cat = catalog()) => {
  const actionResult = evaluate(itemState, cat);
  const selectionResult = selectWeightedModifier(actionResult.selectionRequests[0], { random: () => random });
  return { actionResult, selectionResult, result: simulateCraftingStep({ itemState, actionResult, selectionResults: [selectionResult] }) };
};

test("1 definition declares exactly one selected modifier", () => {
  const result = evaluate();
  assert.equal(result.definition.selectionCount, 1);
  assert.equal(result.selectionRequests[0].count, 1);
});

test("2 normal empty item is applicable with explicit Magic capacity", () => assert.equal(evaluate().status, "applicable"));

test("3 successful transmutation changes Normal to Magic", () => assert.equal(execute().result.resultingItemState.rarity, "magic"));

test("4 successful transmutation adds exactly one modifier", () => {
  const state = execute().result.resultingItemState;
  assert.equal(state.prefixModifiers.length + state.suffixModifiers.length, 1);
});

test("5 controlled low roll can select the eligible prefix", () => {
  const { selectionResult, result } = execute(normal(), 0);
  assert.equal(selectionResult.selectedCandidateId, "mod:prefix-low");
  assert.equal(result.resultingItemState.prefixModifiers.length, 1);
});

test("6 controlled high roll can select the eligible suffix", () => {
  const { selectionResult, result } = execute(normal(), 0.999999);
  assert.equal(selectionResult.selectedCandidateId, "mod:suffix-low");
  assert.equal(result.resultingItemState.suffixModifiers.length, 1);
});

test("7 item level and class constraints filter the request", () => {
  assert.deepEqual(evaluate().selectionRequests[0].candidates.map(candidate => candidate.modifierId), ["mod:prefix-low", "mod:suffix-low"]);
});

test("8 weighted selection uses the existing raw technical weights", () => {
  const request = evaluate().selectionRequests[0];
  assert.deepEqual(request.candidates.map(candidate => [candidate.modifierId, candidate.applicableWeight.spawn]), [["mod:prefix-low", 1], ["mod:suffix-low", 3]]);
  assert.equal(selectWeightedModifier(request, { random: () => 0.249999 }).selectedCandidateId, "mod:prefix-low");
  assert.equal(selectWeightedModifier(request, { random: () => 0.25 }).selectedCandidateId, "mod:suffix-low");
});

test("9 seeded RNG selection is deterministic", () => {
  const request = evaluate().selectionRequests[0];
  const first = selectWeightedModifier(request, { rngState: createSeededRandom(12345) });
  const second = selectWeightedModifier(request, { rngState: createSeededRandom(12345) });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("10 success increments revision exactly once and retains item identity", () => {
  const input = normal({ revision: 7 });
  const state = execute(input).result.resultingItemState;
  assert.equal(state.revision, 8);
  assert.equal(state.itemId, input.itemId);
});

test("11 success preserves opaque metadata", () => assert.deepEqual(execute().result.resultingItemState.metadata, normal().metadata));

test("12 success does not mutate inputs, catalog, or capacity rules", () => {
  const itemState = normal(); const cat = catalog(); const capacityRules = magicCapacity();
  const before = [itemState, cat, capacityRules].map(JSON.stringify);
  const actionResult = evaluate(itemState, cat, { capacityRules });
  const selectionResult = selectWeightedModifier(actionResult.selectionRequests[0], { random: () => 0 });
  simulateCraftingStep({ itemState, actionResult, selectionResults: [selectionResult] });
  assert.deepEqual([itemState, cat, capacityRules].map(JSON.stringify), before);
});

test("13 success is byte-deterministic for equal input and controlled RNG", () => {
  const first = execute(normal(), 0.8).result.resultingItemState;
  const second = execute(normal(), 0.8).result.resultingItemState;
  assert.equal(serializeItemState(first), serializeItemState(second));
});

test("14 Magic item is inapplicable", () => assert.equal(evaluate(normal({ rarity: "magic" })).status, "inapplicable"));

test("15 Rare item is inapplicable", () => assert.equal(evaluate(normal({ rarity: "rare" })).status, "inapplicable"));

test("16 Normal item with a prefix is inapplicable", () => {
  const result = evaluate(normal({ prefixModifiers: [instance("prefix")] }));
  assert.equal(result.status, "inapplicable");
  assert.ok(result.reasons.some(entry => entry.code === ENGINE_ACTION_CODES.EXISTING_MODIFIERS_NOT_ALLOWED && entry.outcome === "fail"));
});

test("17 Normal item with a suffix is inapplicable", () => assert.equal(evaluate(normal({ suffixModifiers: [instance("suffix")] })).status, "inapplicable"));

test("18 Normal item with multiple affixes is inapplicable", () => assert.equal(evaluate(normal({ prefixModifiers: [instance("prefix")], suffixModifiers: [instance("suffix")] })).status, "inapplicable"));

test("19 missing explicit target capacity remains unresolved", () => assert.equal(evaluate(normal(), catalog(), {}).status, "unresolved"));

test("20 incomplete authoritative catalog weights remain unresolved and atomic", () => {
  const docs = documents();
  for (const entry of docs.mods.mods) entry.spawnWeights = null;
  for (const family of docs.affixGroups.groups) for (const tier of family.tiers) tier.spawnWeights = null;
  const cat = createModifierCatalog(docs); const itemState = normal(); const before = JSON.stringify(itemState);
  const actionResult = evaluate(itemState, cat);
  const result = simulateCraftingStep({ itemState, actionResult, selectionResults: [] });
  assert.equal(actionResult.status, "unresolved");
  assert.equal(result.status, "unresolved");
  assert.equal(result.resultingItemState, null);
  assert.equal(JSON.stringify(itemState), before);
});

test("21 missing catalog is a structured error", () => {
  const result = evaluateCraftingAction({ actionId: "currency:transmutation", itemState: normal(), catalog: null, actionContext: { capacityRules: magicCapacity() } });
  assert.equal(result.status, "error");
  assert.equal(result.errors[0].code, ENGINE_ACTION_CODES.CATALOG_INVALID);
});

test("22 malformed item state is a structured error", () => {
  const result = evaluateCraftingAction({ actionId: "currency:transmutation", itemState: { rarity: "normal" }, catalog: catalog(), actionContext: { capacityRules: magicCapacity() } });
  assert.equal(result.status, "error");
  assert.equal(result.errors[0].code, ENGINE_ACTION_CODES.CONTEXT_INVALID);
});

test("23 evaluation and simulation expose stable technical action data", () => {
  const { actionResult, selectionResult, result } = execute();
  assert.equal(actionResult.actionId, "currency:transmutation");
  assert.equal(selectionResult.requestId, actionResult.selectionRequests[0].id);
  assert.equal(result.actionId, "currency:transmutation");
  assert.deepEqual(result.appliedOperations.map(operation => operation.operation), ["set-rarity", "preserve-existing-modifiers", "add-selected-modifier"]);
});

test("24 every non-success status preserves the input without a partial state or revision", () => {
  const cases = [
    { itemState: normal({ rarity: "magic" }), actionResult: null, status: "inapplicable" },
    { itemState: normal(), actionResult: null, actionContext: {}, status: "unresolved" },
    { itemState: normal(), actionResult: null, catalog: null, status: "error" }
  ];
  for (const entry of cases) {
    const itemBefore = JSON.stringify(entry.itemState);
    const actionResult = evaluateCraftingAction({
      actionId: "currency:transmutation",
      itemState: entry.itemState,
      catalog: entry.catalog === null ? null : catalog(),
      actionContext: entry.actionContext ?? { capacityRules: magicCapacity() }
    });
    const result = simulateCraftingStep({ itemState: entry.itemState, actionResult, selectionResults: [] });
    assert.equal(actionResult.status, entry.status);
    assert.equal(result.status, entry.status);
    assert.equal(result.resultingItemState, null);
    assert.equal(result.resultingItemRevision, null);
    assert.equal(JSON.stringify(entry.itemState), itemBefore);
  }
});
