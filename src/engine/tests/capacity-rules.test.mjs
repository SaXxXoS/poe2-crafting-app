import assert from "node:assert/strict";
import test from "node:test";
import * as browserEngine from "../browser.mjs";
import * as nodeEngine from "../index.mjs";

function documents() {
  const mods = [];
  for (const generationType of ["prefix", "suffix"]) {
    for (let index = 0; index < 4; index += 1) {
      mods.push({
        modId: `mod:${generationType}:${index}`,
        generationType,
        domain: "item",
        technicalStats: [{ id: `stat:${generationType}:${index}` }],
        tier: 1,
        requiredLevel: 1,
        spawnWeights: [{ tag: "bow", weight: 100 }, { tag: "default", weight: 0 }],
        generationWeights: [],
        groups: [`group:${generationType}:${index}`],
        flags: [],
        source: "poe2db"
      });
    }
  }
  return {
    index: { classes: [{ id: "Bow" }] },
    bases: { bases: [{ id: "base:bow", itemClass: "Bow", tags: ["bow", "weapon", "default"] }] },
    mods: { mods },
    affixGroups: { groups: mods.map(mod => ({
      familyId: `family:${mod.modId}`,
      generationType: mod.generationType,
      tiers: [{
        modId: mod.modId,
        technicalTier: 1,
        displayTiers: { Bow: 1 },
        requiredLevel: 1,
        spawnWeights: mod.spawnWeights,
        generationWeights: [],
        craftingSources: [],
        regularClasses: ["Bow"],
        specialClasses: [],
        requiredBaseTagsAny: []
      }]
    })) }
  };
}

const catalog = nodeEngine.createModifierCatalog(documents());
const modifierInstance = (generationType, index) => ({
  instanceId: `instance:${generationType}:${index}`,
  modId: `mod:${generationType}:${index}`,
  familyId: `family:mod:${generationType}:${index}`,
  generationType,
  domain: "item",
  technicalTier: 1,
  statIds: [`stat:${generationType}:${index}`],
  values: [{}],
  source: "normal",
  appliedAtRevision: 0
});
const item = (rarity, prefixes = 0, suffixes = 0) => nodeEngine.createItemState({
  itemId: `item:${rarity}:${prefixes}:${suffixes}`,
  baseTypeId: "base:bow",
  itemClassId: "Bow",
  itemLevel: 86,
  rarity,
  prefixModifiers: Array.from({ length: prefixes }, (_, index) => modifierInstance("prefix", index)),
  suffixModifiers: Array.from({ length: suffixes }, (_, index) => modifierInstance("suffix", index))
});
const resolve = (state, capacityRules) => nodeEngine.resolveEligibleModifiers({ itemState: state, catalog, options: capacityRules ? { capacityRules } : {} });
const candidate = (result, generationType, index) => [...result.eligible, ...result.ineligible, ...result.unresolved]
  .find(entry => entry.modifierId === `mod:${generationType}:${index}`);
const hasReason = (entry, code) => entry.reasons.some(reason => reason.code === code);

test("authoritative defaults define Magic 1/1 and Rare 3/3 without a Normal limit", () => {
  assert.deepEqual(nodeEngine.getDefaultCapacityRules(), {
    magic: { prefix: 1, suffix: 1 },
    rare: { prefix: 3, suffix: 3 }
  });
  assert.equal("normal" in nodeEngine.getDefaultCapacityRules(), false);
});

test("capacity defaults are recursively immutable and stable across mutation attempts", () => {
  const first = nodeEngine.getDefaultCapacityRules();
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.magic) && Object.isFrozen(first.rare));
  assert.throws(() => { first.magic.prefix = 99; }, TypeError);
  assert.deepEqual(nodeEngine.getDefaultCapacityRules().magic, { prefix: 1, suffix: 1 });
});

test("Node and browser entries expose deeply identical capacity rules", () => {
  assert.equal(typeof nodeEngine.getDefaultCapacityRules, "function");
  assert.equal(typeof browserEngine.getDefaultCapacityRules, "function");
  assert.deepEqual(browserEngine.getDefaultCapacityRules(), nodeEngine.getDefaultCapacityRules());
});

test("capacity module import does not mutate global configuration", async () => {
  const sentinel = Object.freeze({ CURRENT_MAX_ITEM_LEVEL: 123, sentinel: true });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "EXILEFORGE_CONFIG");
  try {
    globalThis.EXILEFORGE_CONFIG = sentinel;
    await import("../capacity-rules.mjs?side-effect-check=1");
    assert.equal(globalThis.EXILEFORGE_CONFIG, sentinel);
  } finally {
    if (previous) Object.defineProperty(globalThis, "EXILEFORGE_CONFIG", previous);
    else delete globalThis.EXILEFORGE_CONFIG;
  }
});

test("explicit Magic defaults make a valid augmentation capacity-resolved", () => {
  const result = nodeEngine.evaluateCraftingAction({
    actionId: "currency:augmentation",
    itemState: item("magic"),
    catalog,
    actionContext: { capacityRules: nodeEngine.getDefaultCapacityRules().magic }
  });
  assert.equal(result.status, "applicable");
});

test("a full Magic prefix is unavailable while an empty suffix remains available", () => {
  const result = resolve(item("magic", 1, 0), nodeEngine.getDefaultCapacityRules().magic);
  assert.equal(hasReason(candidate(result, "prefix", 1), nodeEngine.ENGINE_ELIGIBILITY_CODES.PREFIX_CAPACITY_REACHED), true);
  assert.equal(candidate(result, "suffix", 0).status, "eligible");
});

test("a full Magic suffix is unavailable while an empty prefix remains available", () => {
  const result = resolve(item("magic", 0, 1), nodeEngine.getDefaultCapacityRules().magic);
  assert.equal(hasReason(candidate(result, "suffix", 1), nodeEngine.ENGINE_ELIGIBILITY_CODES.SUFFIX_CAPACITY_REACHED), true);
  assert.equal(candidate(result, "prefix", 0).status, "eligible");
});

test("two Rare prefixes permit a third and three block a fourth", () => {
  const rules = nodeEngine.getDefaultCapacityRules().rare;
  assert.equal(candidate(resolve(item("rare", 2, 0), rules), "prefix", 2).status, "eligible");
  assert.equal(hasReason(candidate(resolve(item("rare", 3, 0), rules), "prefix", 3), nodeEngine.ENGINE_ELIGIBILITY_CODES.PREFIX_CAPACITY_REACHED), true);
});

test("three Rare suffixes block a fourth", () => {
  const result = resolve(item("rare", 0, 3), nodeEngine.getDefaultCapacityRules().rare);
  assert.equal(hasReason(candidate(result, "suffix", 3), nodeEngine.ENGINE_ELIGIBILITY_CODES.SUFFIX_CAPACITY_REACHED), true);
});

test("explicit Rare defaults allow Exalted capacity evaluation to pass", () => {
  const result = nodeEngine.evaluateCraftingAction({
    actionId: "currency:exalted",
    itemState: item("rare", 2, 0),
    catalog,
    actionContext: { capacityRules: nodeEngine.getDefaultCapacityRules().rare }
  });
  assert.equal(result.status, "applicable");
});

test("omitting capacity rules preserves unresolved behavior", () => {
  const result = resolve(item("magic"));
  assert.equal(candidate(result, "prefix", 0).status, "unresolved");
  assert.equal(hasReason(candidate(result, "prefix", 0), nodeEngine.ENGINE_ELIGIBILITY_CODES.CAPACITY_UNRESOLVED), true);
});
