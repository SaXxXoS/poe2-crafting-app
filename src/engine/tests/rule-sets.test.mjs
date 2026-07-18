import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGINE_RULE_ERROR_CODES, EngineValidationError, createItemState, createModifierCatalog, createRuleContext,
  evaluateRuleSets, getModifierDisplayTier, immutableCopy, loadModifierCatalog
} from "../index.mjs";

function documents(overrides = {}) {
  return {
    index: { classes: [{ id: "Bow" }, { id: "Spear" }] },
    bases: { bases: [
      { id: "base:bow", itemClass: "Bow", tags: ["bow", "weapon", "default"] },
      { id: "base:spear", itemClass: "Spear", tags: ["spear", "weapon", "default"] }
    ] },
    mods: { mods: [{
      modId: "mod:physical:1", generationType: "prefix", domain: "item", itemDomain: null,
      technicalStats: [{ id: "local_physical_damage" }], tier: 2, requiredLevel: 10,
      spawnWeights: [{ tag: "bow", weight: 1000 }, { tag: "default", weight: 0 }],
      generationWeights: [{ tag: "weapon", weight: 100 }], groups: ["PhysicalDamage"], flags: ["local"], source: "poe2db"
    }] },
    affixGroups: { groups: [{
      familyId: "family:physical", technicalSignature: "prefix|PhysicalDamage|local_physical_damage", generationType: "prefix",
      tiers: [{ modId: "mod:physical:1", technicalTier: 2, displayTiers: { Bow: 1 }, requiredLevel: 10,
        spawnWeights: [{ tag: "bow", weight: 1000 }, { tag: "default", weight: 0 }],
        generationWeights: [{ tag: "weapon", weight: 100 }], craftingSources: [] }]
    }] },
    ...overrides
  };
}
const state = overrides => createItemState({ itemId: "item:1", baseTypeId: "base:bow", itemClassId: "Bow", itemLevel: 20, rarity: "rare", ...overrides });
const context = (catalog, stateOverrides = {}, actionContext = { modId: "mod:physical:1" }) => createRuleContext({ itemState: state(stateOverrides), catalog, actionContext });
const hasError = (result, code) => result.errors.some(error => error.code === code);

test("1 valid base and item class pass", () => assert.equal(evaluateRuleSets(context(createModifierCatalog(documents()))).valid, true));
test("2 unknown item class is rejected", () => assert.equal(hasError(evaluateRuleSets(context(createModifierCatalog(documents()), { itemClassId: "Unknown" }, {})), ENGINE_RULE_ERROR_CODES.UNKNOWN_ITEM_CLASS), true));
test("3 unknown base type is rejected", () => assert.equal(hasError(evaluateRuleSets(context(createModifierCatalog(documents()), { baseTypeId: "base:unknown" }, {})), ENGINE_RULE_ERROR_CODES.UNKNOWN_BASE_TYPE), true));
test("4 base class mismatch is rejected", () => assert.equal(hasError(evaluateRuleSets(context(createModifierCatalog(documents()), { baseTypeId: "base:spear" }, {})), ENGINE_RULE_ERROR_CODES.BASE_CLASS_MISMATCH), true));
test("5 known modifier ID is found", () => assert.equal(evaluateRuleSets(context(createModifierCatalog(documents()))).errors.length, 0));
test("6 unknown modifier ID is rejected", () => assert.equal(hasError(evaluateRuleSets(context(createModifierCatalog(documents()), {}, { modId: "mod:unknown" })), ENGINE_RULE_ERROR_CODES.UNKNOWN_MODIFIER), true));
test("7 known modifier domain passes", () => assert.equal(evaluateRuleSets(context(createModifierCatalog(documents()))).errors.some(error => error.ruleSet === "domain"), false));

test("8 unknown modifier domain is rejected", () => {
  const catalog = createModifierCatalog(documents());
  const invalid = immutableCopy({ ...catalog, knownDomains: [], modifiers: { ...catalog.modifiers, "mod:physical:1": { ...catalog.modifiers["mod:physical:1"], domain: "unknown_domain" } } });
  assert.equal(hasError(evaluateRuleSets(context(invalid)), ENGINE_RULE_ERROR_CODES.UNKNOWN_MODIFIER_DOMAIN), true);
});

test("9 known generation type passes", () => assert.equal(evaluateRuleSets(context(createModifierCatalog(documents()))).errors.some(error => error.ruleSet === "generationType"), false));
test("10 unknown generation type is rejected", () => {
  const catalog = createModifierCatalog(documents());
  const invalid = immutableCopy({ ...catalog, modifiers: { ...catalog.modifiers, "mod:physical:1": { ...catalog.modifiers["mod:physical:1"], generationType: "unknown_generation" } } });
  assert.equal(hasError(evaluateRuleSets(context(invalid)), ENGINE_RULE_ERROR_CODES.UNKNOWN_GENERATION_TYPE), true);
});
test("11 met item level passes", () => assert.equal(hasError(evaluateRuleSets(context(createModifierCatalog(documents()))), ENGINE_RULE_ERROR_CODES.MODIFIER_ITEM_LEVEL_NOT_MET), false));
test("12 low item level is rejected", () => assert.equal(hasError(evaluateRuleSets(context(createModifierCatalog(documents()), { itemLevel: 9 })), ENGINE_RULE_ERROR_CODES.MODIFIER_ITEM_LEVEL_NOT_MET), true));

test("13 displayTier requires item-class context", () => {
  const catalog = createModifierCatalog(documents());
  assert.throws(() => getModifierDisplayTier(catalog, "mod:physical:1"), error => error instanceof EngineValidationError && error.code === ENGINE_RULE_ERROR_CODES.DISPLAY_TIER_CONTEXT_REQUIRED);
  assert.equal(getModifierDisplayTier(catalog, "mod:physical:1", "Bow"), 1);
});
test("14 technicalTier is not replaced by displayTier", () => {
  const mod = createModifierCatalog(documents()).modifiers["mod:physical:1"];
  assert.equal(mod.technicalTier, 2);
  assert.equal(mod.displayTiers.Bow, 1);
});
test("15 crafted and desecrated source labels do not replace generation type", () => {
  for (const source of ["crafted", "desecration"]) {
    const docs = documents(); docs.mods.mods[0].source = source;
    const mod = createModifierCatalog(docs).modifiers["mod:physical:1"];
    assert.equal(mod.generationType, "prefix"); assert.equal(mod.source, source);
  }
});
test("16 spawn-weight structure is read", () => assert.deepEqual(createModifierCatalog(documents()).modifiers["mod:physical:1"].spawnWeights[0], { tag: "bow", weight: 1000 }));
test("17 generation-weight structure is read", () => assert.deepEqual(createModifierCatalog(documents()).modifiers["mod:physical:1"].generationWeights[0], { tag: "weapon", weight: 100 }));
test("18 zero weight remains a valid technical value", () => {
  const result = evaluateRuleSets(context(createModifierCatalog(documents())));
  assert.equal(result.valid, true);
  assert.equal(createModifierCatalog(documents()).modifiers["mod:physical:1"].spawnWeights[1].weight, 0);
});
test("19 invalid weight structure is rejected", () => {
  const catalog = createModifierCatalog(documents());
  const invalid = immutableCopy({ ...catalog, modifiers: { ...catalog.modifiers, "mod:physical:1": { ...catalog.modifiers["mod:physical:1"], spawnWeights: [{ tag: "bow", value: 1 }] } } });
  assert.equal(hasError(evaluateRuleSets(context(invalid)), ENGINE_RULE_ERROR_CODES.INVALID_WEIGHT_STRUCTURE), true);
  const docs = documents(); docs.affixGroups.groups[0].tiers[0].spawnWeights = { tag: "bow", weight: 1 };
  assert.throws(() => createModifierCatalog(docs), error => error instanceof EngineValidationError && error.code === ENGINE_RULE_ERROR_CODES.INVALID_WEIGHT_STRUCTURE);
});
test("20 catalog inputs are not mutated", () => {
  const input = documents(); const before = structuredClone(input); createModifierCatalog(input); assert.deepEqual(input, before);
});
test("21 item state and rule context are not mutated", () => {
  const catalog = createModifierCatalog(documents()); const item = state(); const ruleContext = createRuleContext({ itemState: item, catalog, actionContext: { modId: "mod:physical:1" } });
  const beforeItem = JSON.stringify(item); const beforeContext = JSON.stringify(ruleContext); evaluateRuleSets(ruleContext);
  assert.equal(JSON.stringify(item), beforeItem); assert.equal(JSON.stringify(ruleContext), beforeContext); assert.ok(Object.isFrozen(ruleContext));
});
test("22 identical evaluations are byte-identical", () => {
  const ruleContext = context(createModifierCatalog(documents())); assert.equal(JSON.stringify(evaluateRuleSets(ruleContext)), JSON.stringify(evaluateRuleSets(ruleContext)));
});
test("23 error order is deterministic", () => {
  const ruleContext = context(createModifierCatalog(documents()), { itemClassId: "Unknown", baseTypeId: "base:unknown" }, { modId: "mod:unknown" });
  assert.deepEqual(evaluateRuleSets(ruleContext).errors.map(error => error.ruleSet), ["identity", "identity", "modifierReference"]);
});
test("24 results contain no time, path, or random values", () => assert.doesNotMatch(JSON.stringify(evaluateRuleSets(context(createModifierCatalog(documents())))), /generatedAt|[A-Za-z]:\\|Math\.random|Date\(/));

test("25 real Spear, Bow, Body Armour, Ring, and Jewel samples load by technical ID", () => {
  const catalog = loadModifierCatalog();
  for (const itemClassId of ["Spear", "Bow", "Body Armour", "Ring", "Jewel"]) {
    const base = Object.values(catalog.baseTypes).find(candidate => candidate.itemClassId === itemClassId);
    assert.ok(catalog.itemClasses[itemClassId]); assert.ok(base); assert.equal(base.itemClassId, itemClassId); assert.match(base.id, /^(Metadata\/Items\/|Jewel)/);
  }
});

test("26 missing domain remains absent without an unknown-domain error", () => {
  const docs = documents(); delete docs.mods.mods[0].domain;
  const catalog = createModifierCatalog(docs); const result = evaluateRuleSets(context(catalog));
  assert.equal(catalog.modifiers["mod:physical:1"].domain, null);
  assert.equal(hasError(result, ENGINE_RULE_ERROR_CODES.UNKNOWN_MODIFIER_DOMAIN), false);
  assert.equal(result.contextSummary.technicalDataStatus.domain, "notPresent");
  assert.equal(result.warnings.some(warning => warning.code === ENGINE_RULE_ERROR_CODES.RULE_DATA_NOT_AVAILABLE && warning.ruleSet === "domain"), true);
});

test("27 present unknown domain remains distinct from missing domain", () => {
  const catalog = createModifierCatalog(documents());
  const invalid = immutableCopy({ ...catalog, knownDomains: [], modifiers: { ...catalog.modifiers, "mod:physical:1": { ...catalog.modifiers["mod:physical:1"], domain: "unknown_domain" } } });
  const result = evaluateRuleSets(context(invalid));
  assert.equal(hasError(result, ENGINE_RULE_ERROR_CODES.UNKNOWN_MODIFIER_DOMAIN), true);
  assert.equal(result.contextSummary, null);
});

test("28 missing optional flags remain absent", () => {
  const docs = documents(); delete docs.mods.mods[0].flags;
  const catalog = createModifierCatalog(docs); const result = evaluateRuleSets(context(catalog));
  assert.equal(catalog.modifiers["mod:physical:1"].flags, null);
  assert.equal(result.contextSummary.technicalDataStatus.flags, "notPresent");
});

test("29 zero weight remains present and valid", () => {
  const result = evaluateRuleSets(context(createModifierCatalog(documents())));
  assert.equal(result.contextSummary.technicalDataStatus.spawnWeights, "presentKnown");
  assert.equal(hasError(result, ENGINE_RULE_ERROR_CODES.INVALID_WEIGHT_STRUCTURE), false);
});

test("30 missing and invalid weight data are distinguished", () => {
  const missingDocs = documents(); delete missingDocs.mods.mods[0].generationWeights; delete missingDocs.affixGroups.groups[0].tiers[0].generationWeights;
  const missing = evaluateRuleSets(context(createModifierCatalog(missingDocs)));
  assert.equal(missing.contextSummary.technicalDataStatus.generationWeights, "notPresent");
  assert.equal(hasError(missing, ENGINE_RULE_ERROR_CODES.INVALID_WEIGHT_STRUCTURE), false);
  const catalog = createModifierCatalog(documents());
  const invalidCatalog = immutableCopy({ ...catalog, modifiers: { ...catalog.modifiers, "mod:physical:1": { ...catalog.modifiers["mod:physical:1"], generationWeights: [{ tag: "weapon", value: 1 }] } } });
  const invalid = evaluateRuleSets(context(invalidCatalog));
  assert.equal(invalid.contextSummary, null);
  assert.equal(hasError(invalid, ENGINE_RULE_ERROR_CODES.INVALID_WEIGHT_STRUCTURE), true);
});
