import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGINE_ERROR_CODES, EngineValidationError, createItemState, deserializeItemState,
  reviseItemState, serializeItemState
} from "../index.mjs";

const baseInput = overrides => ({
  itemId: "item:test:1",
  baseTypeId: "Metadata/Items/Weapons/TwoHandWeapons/Bows/FourBow1",
  itemClassId: "Bow",
  itemLevel: 86,
  rarity: "rare",
  metadata: { note: "fixture", nested: { retained: true } },
  ...overrides
});
const prefix = overrides => ({
  instanceId: "instance:prefix:1",
  modId: "poe2db:d52bfd214b693d568fe4",
  familyId: "prefix|PhysicalDamage|local_maximum_added_physical_damage,local_minimum_added_physical_damage",
  generationType: "prefix",
  domain: "item",
  technicalTier: 9,
  displayTier: 9,
  statIds: ["local_minimum_added_physical_damage", "local_maximum_added_physical_damage"],
  values: [{ min: 1, max: 2 }, { min: 4, max: 5 }],
  source: "normal",
  appliedAtRevision: 0,
  metadata: {},
  ...overrides
});
const expectCode = (fn, code) => assert.throws(fn, error => error instanceof EngineValidationError && error.code === code && typeof error.path === "string" && error.details && typeof error.details === "object");

test("1 minimal valid item state is created", () => {
  const state = createItemState(baseInput());
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.revision, 0);
  assert.ok(Object.isFrozen(state));
});

test("2 creation does not mutate input", () => {
  const input = baseInput({ prefixModifiers: [prefix()] });
  const before = structuredClone(input);
  createItemState(input);
  assert.deepEqual(input, before);
});

test("3 nested input values are not shared", () => {
  const input = baseInput({ prefixModifiers: [prefix()] });
  const state = createItemState(input);
  input.metadata.nested.retained = false;
  input.prefixModifiers[0].values[0].min = 99;
  assert.equal(state.metadata.nested.retained, true);
  assert.equal(state.prefixModifiers[0].values[0].min, 1);
});

test("4 identical inputs serialize byte-identically", () => assert.equal(serializeItemState(createItemState(baseInput())), serializeItemState(createItemState(baseInput()))));

test("5 serialize-deserialize roundtrip is lossless", () => {
  const serialized = serializeItemState(createItemState(baseInput({ prefixModifiers: [prefix()] })));
  assert.equal(serializeItemState(deserializeItemState(serialized)), serialized);
});

test("6 item level below one is rejected", () => expectCode(() => createItemState(baseInput({ itemLevel: 0 })), ENGINE_ERROR_CODES.INVALID_ITEM_LEVEL));
test("7 item level above 86 is rejected", () => expectCode(() => createItemState(baseInput({ itemLevel: 87 })), ENGINE_ERROR_CODES.INVALID_ITEM_LEVEL));
test("8 unknown rarity is rejected", () => expectCode(() => createItemState(baseInput({ rarity: "mythic" })), ENGINE_ERROR_CODES.INVALID_RARITY));
test("9 missing itemId is rejected", () => expectCode(() => createItemState(baseInput({ itemId: undefined })), ENGINE_ERROR_CODES.INVALID_IDENTITY));
test("10 missing modifier instanceId is rejected", () => expectCode(() => createItemState(baseInput({ prefixModifiers: [prefix({ instanceId: undefined })] })), ENGINE_ERROR_CODES.INVALID_MODIFIER));
test("11 duplicate modifier instanceId is rejected", () => expectCode(() => createItemState(baseInput({ prefixModifiers: [prefix()], suffixModifiers: [{ ...prefix(), generationType: "suffix" }] })), ENGINE_ERROR_CODES.DUPLICATE_MODIFIER_INSTANCE));
test("12 invalid modifier structure is rejected", () => expectCode(() => createItemState(baseInput({ prefixModifiers: [prefix({ values: [1] })] })), ENGINE_ERROR_CODES.INVALID_MODIFIER));
test("13 invalid revision is rejected", () => expectCode(() => createItemState(baseInput({ revision: -1 })), ENGINE_ERROR_CODES.INVALID_REVISION));
test("14 invalid history is rejected", () => expectCode(() => createItemState(baseInput({ revision: 1, history: [{ sequence: 0, previousRevision: 1, nextRevision: 1, actionType: "engine.item.created", actionId: "init", input: {}, result: {}, metadata: {} }] })), ENGINE_ERROR_CODES.INVALID_HISTORY));

test("15 displayTier remains item-class-specific and does not become technicalTier", () => {
  const state = createItemState(baseInput({ prefixModifiers: [prefix({ technicalTier: null, displayTier: 1 })] }));
  assert.equal(state.prefixModifiers[0].technicalTier, null);
  assert.equal(state.prefixModifiers[0].displayTier, 1);
});

test("16 revising creates a new state and leaves previous bytes unchanged", () => {
  const previous = createItemState(baseInput());
  const before = serializeItemState(previous);
  const next = reviseItemState(previous, { quality: 20, metadata: { reason: "test" } });
  assert.equal(serializeItemState(previous), before);
  assert.equal(previous.revision, 0);
  assert.equal(next.revision, 1);
  assert.equal(next.itemId, previous.itemId);
  assert.notEqual(next, previous);
});

test("17 serialization adds no time, path, or random values", () => {
  const serialized = serializeItemState(createItemState(baseInput()));
  assert.doesNotMatch(serialized, /generatedAt|appliedAt|[A-Za-z]:\\|Math\.random|Date\(/);
});

test("18 unknown metadata is retained but unknown engine fields are rejected", () => {
  const state = createItemState(baseInput({ metadata: { futureDescription: { arbitrary: true } } }));
  assert.equal(state.metadata.futureDescription.arbitrary, true);
  expectCode(() => createItemState({ ...baseInput(), engineRule: true }), ENGINE_ERROR_CODES.UNKNOWN_ENGINE_FIELD);
});

test("special modifier categories retain prefix or suffix generation types", () => {
  const crafted = prefix({ instanceId: "instance:crafted:1", source: "crafted" });
  const desecrated = prefix({ instanceId: "instance:desecrated:1", generationType: "suffix", source: "desecration" });
  const state = createItemState(baseInput({ craftedModifiers: [crafted], desecratedModifiers: [desecrated] }));
  assert.equal(state.craftedModifiers[0].generationType, "prefix");
  assert.equal(state.desecratedModifiers[0].generationType, "suffix");
});
