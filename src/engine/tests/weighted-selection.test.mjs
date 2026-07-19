import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ENGINE_WEIGHT_SELECTION_CODES, EngineValidationError, createItemState, createModifierCatalog,
  createSeededRandom, evaluateCraftingAction, nextSeededRandom, selectWeightedModifier
} from "../index.mjs";

const candidate = (modifierId, weight, changes = {}) => ({
  modifierId, generationType: "prefix", familyId: `family:${modifierId}`, technicalTier: 1,
  applicableWeight: { spawn: weight, generation: 1, spawnTag: "bow", generationTag: null },
  rawSpawnWeights: [{ tag: "bow", weight }], rawGenerationWeights: [], ...changes
});
const request = (candidates = [candidate("mod:a", 1)], changes = {}) => ({
  id: "selection:test", deterministicKey: "key:test", type: "modifier-addition", actionId: "currency:augmentation",
  executable: true, count: 1, candidateStatus: "eligible", candidates,
  weighting: { mode: "raw-technical-weights", normalized: false }, replacementPolicy: "without-replacement",
  constraints: { generationTypes: ["prefix"] }, sourceResult: { mode: "regular" }, ...changes
});
const selectAt = (value, input = request()) => selectWeightedModifier(input, { random: () => value });
const code = result => result.reasons[0]?.code;

test("1 seeded RNG state is explicit, immutable, and deterministic", () => {
  const state = createSeededRandom(123); const a = nextSeededRandom(state); const b = nextSeededRandom(state);
  assert.ok(Object.isFrozen(state)); assert.ok(Object.isFrozen(a)); assert.deepEqual(a, b); assert.equal(state.state, 123);
  assert.ok(a.value >= 0 && a.value < 1); assert.notDeepEqual(a.nextRngState, state);
});
test("2 invalid seeds are structured", () => {
  for (const seed of [-1, 2 ** 32, 1.5, NaN, Infinity, "1", true, null, 1n]) assert.throws(() => createSeededRandom(seed), error => error instanceof EngineValidationError && error.code === ENGINE_WEIGHT_SELECTION_CODES.SEED_INVALID && JSON.stringify(error.details).length > 0);
});
test("3 continued seeded state produces a reproducible sequence", () => {
  const start = createSeededRandom(77); const first = nextSeededRandom(start); const second = nextSeededRandom(first.nextRngState);
  const repeatFirst = nextSeededRandom(createSeededRandom(77)); const repeatSecond = nextSeededRandom(repeatFirst.nextRngState);
  assert.deepEqual([first.value, second.value], [repeatFirst.value, repeatSecond.value]);
});
test("4 one positive candidate is selected", () => {
  const result = selectAt(0.999999999); assert.equal(result.status, "selected"); assert.equal(result.valid, true);
  assert.equal(result.selectedCandidateId, "mod:a"); assert.equal(result.selectedIndex, 0); assert.equal(result.totalWeight, 1);
});
test("5 weighted interval boundaries use target less than cumulative weight", () => {
  const pool = request([candidate("mod:a", 1), candidate("mod:b", 3), candidate("mod:c", 6)]);
  for (const [randomValue, expected] of [[0, "mod:a"], [0.099999999, "mod:a"], [0.1, "mod:b"], [0.399999999, "mod:b"], [0.4, "mod:c"], [0.999999999, "mod:c"]]) {
    const result = selectAt(randomValue, pool); assert.equal(result.selectedCandidateId, expected); assert.equal(result.targetWeight, randomValue * 10);
  }
});
test("6 zero-weight candidates remain present but are never selected", () => {
  const pool = request([candidate("mod:zero", 0), candidate("mod:positive", 2)]);
  for (const value of [0, 0.5, 0.999999]) assert.equal(selectAt(value, pool).selectedCandidateId, "mod:positive");
  assert.equal(pool.candidates.length, 2);
});
test("7 all-zero weights are inapplicable", () => {
  const result = selectAt(0, request([candidate("mod:a", 0), candidate("mod:b", 0)]));
  assert.equal(result.status, "inapplicable"); assert.equal(result.valid, true); assert.equal(code(result), ENGINE_WEIGHT_SELECTION_CODES.NO_POSITIVE_WEIGHT);
});
test("8 negative weight is a structured error", () => {
  const result = selectAt(0, request([candidate("mod:a", -1)])); assert.equal(result.status, "error"); assert.equal(code(result), ENGINE_WEIGHT_SELECTION_CODES.WEIGHT_INVALID);
});
test("9 NaN weight is a structured error", () => assert.equal(code(selectAt(0, request([candidate("mod:a", NaN)]))), ENGINE_WEIGHT_SELECTION_CODES.WEIGHT_INVALID));
test("10 positive and negative Infinity weights are structured errors", () => {
  for (const weight of [Infinity, -Infinity]) assert.equal(code(selectAt(0, request([candidate("mod:a", weight)]))), ENGINE_WEIGHT_SELECTION_CODES.WEIGHT_INVALID);
});
test("11 missing effective weight is a structured error", () => {
  const value = candidate("mod:a", 1); delete value.applicableWeight;
  assert.equal(code(selectAt(0, request([value]))), ENGINE_WEIGHT_SELECTION_CODES.WEIGHT_INVALID);
});
test("12 empty candidate pool is inapplicable", () => assert.equal(code(selectAt(0, request([]))), ENGINE_WEIGHT_SELECTION_CODES.EMPTY_POOL));
test("13 non-executable request is inapplicable", () => assert.equal(code(selectAt(0, request(undefined, { executable: false }))), ENGINE_WEIGHT_SELECTION_CODES.REQUEST_NOT_EXECUTABLE));
test("14 null zero and multiple counts are unsupported", () => {
  for (const count of [null, 0, 2]) assert.equal(code(selectAt(0, request(undefined, { count }))), ENGINE_WEIGHT_SELECTION_CODES.COUNT_UNSUPPORTED);
});
test("15 removal request is unsupported", () => assert.equal(code(selectAt(0, request(undefined, { type: "modifier-removal" }))), ENGINE_WEIGHT_SELECTION_CODES.REQUEST_TYPE_UNSUPPORTED));
test("16 missing request and invalid candidates are structured errors", () => {
  assert.equal(code(selectWeightedModifier(undefined, { random: () => 0 })), ENGINE_WEIGHT_SELECTION_CODES.REQUEST_INVALID);
  for (const value of [null, {}, { modifierId: "mod:a" }, candidate("", 1)]) assert.equal(code(selectAt(0, request([value]))), ENGINE_WEIGHT_SELECTION_CODES.CANDIDATE_INVALID);
});
test("17 duplicate technical candidate identity is rejected", () => {
  assert.equal(code(selectAt(0, request([candidate("mod:a", 1), candidate("mod:a", 2)]))), ENGINE_WEIGHT_SELECTION_CODES.CANDIDATE_DUPLICATE);
});
test("18 invalid injected RNG outputs are structured", () => {
  for (const value of [-1, 1, NaN, Infinity, -Infinity, "0", null, true, 1n, Symbol("rng")]) {
    const result = selectWeightedModifier(request(), { random: () => value }); assert.equal(result.status, "error"); assert.equal(code(result), ENGINE_WEIGHT_SELECTION_CODES.RNG_OUTPUT_INVALID); assert.ok(JSON.stringify(result));
  }
});
test("19 throwing random source is contained", () => {
  const result = selectWeightedModifier(request(), { random: () => { throw new RangeError("fixture"); } });
  assert.equal(result.status, "error"); assert.equal(code(result), ENGINE_WEIGHT_SELECTION_CODES.RNG_OUTPUT_INVALID);
});
test("20 exactly one valid random source is required", () => {
  for (const options of [{}, { random: () => 0, rngState: createSeededRandom(1) }, { random: 0 }, null]) assert.equal(code(selectWeightedModifier(request(), options)), ENGINE_WEIGHT_SELECTION_CODES.RNG_STATE_INVALID);
});
test("21 large finite decimal weights select without integer rounding", () => {
  const pool = request([candidate("mod:small", 0.000001), candidate("mod:large", Number.MAX_VALUE / 4)]);
  assert.equal(selectAt(0, pool).selectedCandidateId, "mod:small"); assert.equal(selectAt(Number.EPSILON, pool).selectedCandidateId, "mod:large");
});
test("22 overflowing total weight is a structured error", () => {
  const pool = request([candidate("mod:a", Number.MAX_VALUE), candidate("mod:b", Number.MAX_VALUE)]);
  assert.equal(code(selectAt(0, pool)), ENGINE_WEIGHT_SELECTION_CODES.TOTAL_WEIGHT_INVALID);
});
test("23 candidate order is selection semantics and is not sorted", () => {
  const a = request([candidate("mod:a", 1), candidate("mod:b", 3)]); const b = request([...a.candidates].reverse());
  assert.equal(selectAt(0.2, a).selectedCandidateId, "mod:a"); assert.equal(selectAt(0.2, b).selectedCandidateId, "mod:b");
  assert.deepEqual(a.candidates.map(entry => entry.modifierId), ["mod:a", "mod:b"]);
});
test("24 raw and generation weights are not used as selection weights", () => {
  const a = candidate("mod:a", 1, { rawSpawnWeights: [{ tag: "bow", weight: 999999 }], applicableWeight: { spawn: 1, generation: 999, spawnTag: "bow", generationTag: "weapon" } });
  const b = candidate("mod:b", 3, { rawSpawnWeights: [{ tag: "bow", weight: 1 }], applicableWeight: { spawn: 3, generation: 0.001, spawnTag: "bow", generationTag: "weapon" } });
  assert.equal(selectAt(0.2, request([a, b])).selectedCandidateId, "mod:a");
});
test("25 recursively frozen request is byte-identically unchanged", () => {
  const input = structuredClone(request([candidate("mod:a", 1), candidate("mod:b", 3)]));
  const freeze = value => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; };
  freeze(input); const before = JSON.stringify(input); selectAt(0.5, input); assert.equal(JSON.stringify(input), before);
});
test("26 selection result is recursively immutable", () => {
  const result = selectAt(0); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.selectedCandidate)); assert.ok(Object.isFrozen(result.errors)); assert.throws(() => { result.status = "changed"; }, TypeError);
});
test("27 same request and seed produce byte-identical results", () => {
  const input = request([candidate("mod:a", 1), candidate("mod:b", 3)]); const state = createSeededRandom(1234);
  assert.equal(JSON.stringify(selectWeightedModifier(input, { rngState: state })), JSON.stringify(selectWeightedModifier(input, { rngState: state })));
});
test("28 different seeds can select different candidates", () => {
  const input = request([candidate("mod:a", 1), candidate("mod:b", 1)]);
  const selected = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(seed => selectWeightedModifier(input, { rngState: createSeededRandom(seed) }).selectedCandidateId));
  assert.equal(selected.size, 2);
});
test("29 forwarded RNG state reproduces a sequence", () => {
  const input = request([candidate("mod:a", 1), candidate("mod:b", 1)]); let state = createSeededRandom(42); const sequence = [];
  for (let index = 0; index < 5; index += 1) { const selected = selectWeightedModifier(input, { rngState: state }); sequence.push(selected.selectedCandidateId); state = selected.nextRngState; }
  let repeat = createSeededRandom(42); const repeated = [];
  for (let index = 0; index < 5; index += 1) { const selected = selectWeightedModifier(input, { rngState: repeat }); repeated.push(selected.selectedCandidateId); repeat = selected.nextRngState; }
  assert.deepEqual(sequence, repeated);
});
test("30 independent calls have no global RNG coupling", () => {
  const input = request([candidate("mod:a", 1), candidate("mod:b", 1)]); const state = createSeededRandom(99);
  const first = selectWeightedModifier(input, { rngState: state }); selectWeightedModifier(input, { rngState: createSeededRandom(1) }); const second = selectWeightedModifier(input, { rngState: state }); assert.deepEqual(first, second);
});

function actionDocuments() {
  const mods = [candidate("mod:a", 1), candidate("mod:b", 3)].map(entry => ({ modId: entry.modifierId, generationType: "prefix", domain: "item", technicalStats: [{ id: `${entry.modifierId}:stat` }], tier: 1, requiredLevel: 1, spawnWeights: [{ tag: "bow", weight: entry.applicableWeight.spawn }], generationWeights: [], groups: [entry.familyId], flags: [], source: "poe2db" }));
  return { index: { classes: [{ id: "Bow" }] }, bases: { bases: [{ id: "base:bow", itemClass: "Bow", tags: ["bow", "weapon", "default"] }] }, mods: { mods }, affixGroups: { groups: mods.map((mod, index) => ({ familyId: `family:${index}`, generationType: "prefix", tiers: [{ modId: mod.modId, technicalTier: 1, displayTiers: { Bow: 1 }, requiredLevel: 1, spawnWeights: mod.spawnWeights, generationWeights: [], craftingSources: [], regularClasses: ["Bow"], specialClasses: [], requiredBaseTagsAny: [] }] })) } };
}
const actionSelection = actionId => {
  const catalog = createModifierCatalog(actionDocuments()); const rarity = actionId === "currency:exalted" ? "rare" : "magic";
  const item = createItemState({ itemId: `item:${actionId}`, baseTypeId: "base:bow", itemClassId: "Bow", itemLevel: 86, rarity });
  const before = JSON.stringify(item); const action = evaluateCraftingAction({ actionId, itemState: item, catalog, actionContext: { capacityRules: { prefix: 3, suffix: 3 } } });
  return { action, item, before };
};
test("31 augmentation request is consumed directly without mutating action or item", () => {
  const { action, item, before } = actionSelection("currency:augmentation"); const actionBefore = JSON.stringify(action); const selection = selectAt(0.75, action.selectionRequests[0]);
  assert.equal(action.selectionRequests[0].executable, true); assert.equal(selection.selectedCandidateId, "mod:b"); assert.equal(JSON.stringify(action), actionBefore); assert.equal(JSON.stringify(item), before);
});
test("32 regal and exalted requests are consumed directly and deterministically", () => {
  for (const actionId of ["currency:regal", "currency:exalted"]) { const { action } = actionSelection(actionId); const selection = selectWeightedModifier(action.selectionRequests[0], { rngState: createSeededRandom(5) }); assert.equal(selection.status, "selected"); assert.ok(["mod:a", "mod:b"].includes(selection.selectedCandidateId)); }
});
test("33 production selection code has no ambient randomness, time, crypto, sorting, catalog, or resolver dependency", () => {
  const source = readFileSync(new URL("../weighted-selection.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Math\.random|Date\.now|node:crypto|\.sort\(|resolveEligibleModifiers|evaluateRuleSets|catalog/i);
});
