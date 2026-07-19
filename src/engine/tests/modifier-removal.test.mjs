import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ENGINE_REMOVAL_CODES, createItemState, createModifierRemovalRequest, createSeededRandom,
  nextSeededRandom, selectModifierForRemoval, validateModifierRemovalSelection
} from "../index.mjs";

const instance = (instanceId, generationType, source = "normal") => ({
  instanceId, modId: `mod:${instanceId}`, familyId: `family:${instanceId}`, generationType,
  domain: "item", technicalTier: 2, displayTier: 1, statIds: [`stat:${instanceId}`],
  values: [{ min: 1, max: 2 }], source, appliedAtRevision: 0, metadata: { marker: instanceId }
});
const state = (changes = {}) => createItemState({
  itemId: "item:removal", baseTypeId: "base:bow", itemClassId: "Bow", itemLevel: 86, rarity: "rare",
  prefixModifiers: [instance("z-prefix", "prefix"), instance("a-prefix", "prefix")],
  suffixModifiers: [instance("m-suffix", "suffix")],
  implicitModifiers: [instance("implicit", "implicit", "implicit")],
  craftedModifiers: [instance("crafted", "prefix", "crafted")],
  desecratedModifiers: [instance("desecrated", "suffix", "desecrated")],
  ...changes
});
const request = changes => createModifierRemovalRequest({ actionId: "currency:annulment", itemState: state(changes) });
const clone = value => structuredClone(value);
const code = result => result.errors[0]?.code;

test("1 request contains every regular explicit modifier exactly once", () => {
  const result = request();
  assert.deepEqual(result.candidates.map(entry => entry.instanceId), ["a-prefix", "m-suffix", "z-prefix"]);
  assert.equal(new Set(result.candidates.map(entry => entry.instanceId)).size, 3);
});
test("2 implicit crafted and desecrated modifiers are excluded", () => {
  assert.deepEqual(request().candidates.map(entry => entry.listName), ["prefixModifiers", "suffixModifiers", "prefixModifiers"]);
});
test("3 each candidate keeps complete technical instance data", () => {
  const candidate = request().candidates[0];
  assert.deepEqual(candidate, { instanceId: "a-prefix", modifierId: "mod:a-prefix", listName: "prefixModifiers", generationType: "prefix", source: "normal", familyId: "family:a-prefix", domain: "item", technicalTier: 2, displayTier: 1, statIds: ["stat:a-prefix"], values: [{ min: 1, max: 2 }], appliedAtRevision: 0, metadata: { marker: "a-prefix" } });
});
test("4 candidate order is independent of modifier-list insertion order", () => {
  const reversed = request({ prefixModifiers: [instance("a-prefix", "prefix"), instance("z-prefix", "prefix")] });
  assert.equal(reversed.deterministicKey, request().deterministicKey);
});
test("5 request is byte-deterministic", () => assert.equal(JSON.stringify(request()), JSON.stringify(request())));
test("6 request and nested data are immutable", () => {
  const result = request();
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.candidates)); assert.ok(Object.isFrozen(result.candidates[0].metadata));
});
test("7 request construction does not mutate item state", () => {
  const itemState = state(); const before = JSON.stringify(itemState); createModifierRemovalRequest({ actionId: "currency:annulment", itemState }); assert.equal(JSON.stringify(itemState), before);
});
test("8 candidates are uniformly partitioned by count", () => {
  assert.equal(selectModifierForRemoval(request(), { random: () => 0 }).selectedInstanceId, "a-prefix");
  assert.equal(selectModifierForRemoval(request(), { random: () => 1 / 3 }).selectedInstanceId, "m-suffix");
  assert.equal(selectModifierForRemoval(request(), { random: () => 2 / 3 }).selectedInstanceId, "z-prefix");
});
test("9 same seed produces byte-identical selection", () => {
  const seeded = createSeededRandom(731); assert.equal(JSON.stringify(selectModifierForRemoval(request(), { rngState: seeded })), JSON.stringify(selectModifierForRemoval(request(), { rngState: seeded })));
});
test("10 seeded selection returns the central next RNG state", () => {
  const seeded = createSeededRandom(731); assert.deepEqual(selectModifierForRemoval(request(), { rngState: seeded }).nextRngState, nextSeededRandom(seeded).nextRngState);
});
test("11 seeded selection does not mutate RNG state", () => {
  const seeded = createSeededRandom(12); const before = JSON.stringify(seeded); selectModifierForRemoval(request(), { rngState: seeded }); assert.equal(JSON.stringify(seeded), before);
});
test("12 suitable deterministic seeds can choose different candidates", () => {
  const selected = new Set([0, 1, 2, 3, 4, 5, 10, 100].map(seed => selectModifierForRemoval(request(), { rngState: createSeededRandom(seed) }).selectedInstanceId)); assert.ok(selected.size > 1);
});
test("13 invalid random output is a structured error", () => assert.equal(code(selectModifierForRemoval(request(), { random: () => 1 })), ENGINE_REMOVAL_CODES.RNG_OUTPUT_INVALID));
test("14 missing or competing RNG sources are rejected", () => {
  assert.equal(code(selectModifierForRemoval(request())), ENGINE_REMOVAL_CODES.RNG_INVALID);
  assert.equal(code(selectModifierForRemoval(request(), { random: () => 0, rngState: createSeededRandom(1) })), ENGINE_REMOVAL_CODES.RNG_INVALID);
});
test("15 manipulated request candidate is rejected", () => {
  const bad = clone(request()); bad.candidates[0].modifierId = "mod:foreign"; assert.equal(code(selectModifierForRemoval(bad, { random: () => 0 })), ENGINE_REMOVAL_CODES.REQUEST_MISMATCH);
});
test("16 manipulated deterministic key is rejected", () => {
  const bad = clone(request()); bad.deterministicKey += " "; assert.equal(code(selectModifierForRemoval(bad, { random: () => 0 })), ENGINE_REMOVAL_CODES.REQUEST_MISMATCH);
});
test("17 removal implementation has no ambient random time or crypto source", () => {
  const source = readFileSync(new URL("../modifier-removal.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Math\.random|Date\.now|new Date|crypto\.|randomUUID/);
});
test("18 empty regular pool creates an explicit non-executable request", () => {
  const result = request({ prefixModifiers: [], suffixModifiers: [] }); assert.equal(result.executable, false); assert.deepEqual(result.candidates, []);
  const selection = selectModifierForRemoval(result); assert.equal(selection.status, "inapplicable"); assert.equal(selection.reasons[0].code, ENGINE_REMOVAL_CODES.EMPTY_POOL);
});
test("19 selection validator accepts an authentic injected draw", () => assert.equal(validateModifierRemovalSelection(request(), selectModifierForRemoval(request(), { random: () => 0.5 })).valid, true));
test("20 selection validator rejects a forged draw-to-index mapping", () => {
  const selection = clone(selectModifierForRemoval(request(), { random: () => 0 })); selection.randomValue = 0.9; assert.equal(validateModifierRemovalSelection(request(), selection).valid, false);
});
test("21 selection validator rejects a forged seeded transition", () => {
  const selection = clone(selectModifierForRemoval(request(), { rngState: createSeededRandom(4) })); selection.nextRngState.state += 1; assert.equal(validateModifierRemovalSelection(request(), selection).valid, false);
});
