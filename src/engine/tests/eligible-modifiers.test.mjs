import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ENGINE_ELIGIBILITY_CODES, compareTechnicalStrings, createItemState, createModifierCatalog, createRuleContext,
  immutableCopy, loadModifierCatalog, resolveEligibleModifiers
} from "../index.mjs";

function documents() {
  const makeMod = (id, generationType, group, tag, extra = {}) => ({
    modId: id, generationType, domain: "item", technicalStats: [{ id: `${id}:stat` }], tier: extra.tier ?? 2,
    requiredLevel: extra.requiredLevel ?? 10, spawnWeights: extra.spawnWeights ?? [{ tag, weight: 100 }, { tag: "default", weight: 0 }],
    generationWeights: extra.generationWeights ?? [], groups: extra.groups ?? [group], flags: [], source: extra.source ?? "poe2db"
  });
  const mods = [
    makeMod("mod:prefix", "prefix", "Damage", "bow"),
    makeMod("mod:suffix", "suffix", "Speed", "bow", { tier: 4 }),
    makeMod("mod:spear", "prefix", "SpearDamage", "spear")
  ];
  return {
    index: { classes: [{ id: "Bow" }, { id: "Spear" }] },
    bases: { bases: [
      { id: "base:bow", itemClass: "Bow", tags: ["bow", "weapon", "default"] },
      { id: "base:spear", itemClass: "Spear", tags: ["spear", "weapon", "default"] }
    ] },
    mods: { mods },
    affixGroups: { groups: mods.map((mod, index) => ({
      familyId: `family:${index}`, generationType: mod.generationType,
      tiers: [{ modId: mod.modId, technicalTier: mod.tier, displayTiers: { [mod.modId === "mod:spear" ? "Spear" : "Bow"]: index + 1 },
        requiredLevel: mod.requiredLevel, spawnWeights: mod.spawnWeights, generationWeights: mod.generationWeights,
        craftingSources: [], regularClasses: [mod.modId === "mod:spear" ? "Spear" : "Bow"], specialClasses: [], requiredBaseTagsAny: [] }]
    })) }
  };
}

const catalog = overrides => {
  const docs = documents();
  overrides?.(docs);
  return createModifierCatalog(docs);
};
const modifierInstance = (modId, generationType = "prefix", familyId = "family:0") => ({
  instanceId: `instance:${modId}`, modId, familyId, generationType, domain: "item", technicalTier: 1,
  statIds: ["stat"], values: [{}], source: "normal", appliedAtRevision: 0
});
const state = overrides => createItemState({ itemId: "item:1", baseTypeId: "base:bow", itemClassId: "Bow", itemLevel: 20, rarity: "rare", ...overrides });
// Synthetic caller input only. These values are not game limits or Engine defaults.
const TEST_CAPACITY_RULES = Object.freeze({ prefix: 10, suffix: 10 });
const resolve = ({ cat = catalog(), item = state(), ruleContext, actionContext = {}, options = {} } = {}) =>
  resolveEligibleModifiers({ itemState: item, catalog: cat, ruleContext, actionContext, options });
const find = (result, id) => [...result.eligible, ...result.ineligible, ...result.unresolved].find(entry => entry.modifierId === id);
const hasReason = (entry, code) => entry.reasons.some(reason => reason.code === code);

test("1 valid regular candidate with explicit test capacity is eligible", () => assert.equal(find(resolve({ options: { capacityRules: TEST_CAPACITY_RULES } }), "mod:prefix").status, "eligible"));
test("2 unknown item class invalidates context", () => { const result = resolve({ item: state({ itemClassId: "Unknown" }) }); assert.equal(result.valid, false); assert.equal(result.candidateCount, 0); });
test("3 unknown base type invalidates context", () => assert.equal(resolve({ item: state({ baseTypeId: "unknown" }) }).valid, false));
test("4 base and class mismatch invalidates context", () => assert.equal(resolve({ item: state({ baseTypeId: "base:spear" }) }).valid, false));
test("5 modifier from another class is ineligible", () => assert.equal(find(resolve(), "mod:spear").status, "ineligible"));
test("6 met item level passes", () => assert.equal(hasReason(find(resolve(), "mod:prefix"), "ENGINE_ELIGIBILITY_ITEM_LEVEL_MET"), true));
test("7 low item level is ineligible", () => assert.equal(hasReason(find(resolve({ item: state({ itemLevel: 9 }) }), "mod:prefix"), ENGINE_ELIGIBILITY_CODES.ITEM_LEVEL_NOT_MET), true));
test("8 technical tier is preserved", () => assert.equal(find(resolve(), "mod:prefix").technicalTier, 2));
test("9 display tier is class-specific", () => assert.equal(find(resolve(), "mod:prefix").displayTier, 1));
test("10 missing display tier does not replace technical tier", () => { const cat = catalog(d => { d.affixGroups.groups[0].tiers[0].displayTiers = {}; }); const entry = find(resolve({ cat }), "mod:prefix"); assert.equal(entry.displayTier, null); assert.equal(entry.technicalTier, 2); });
test("11 regular prefix is classified", () => assert.equal(find(resolve(), "mod:prefix").generationType, "prefix"));
test("12 regular suffix is classified", () => assert.equal(find(resolve(), "mod:suffix").generationType, "suffix"));

for (const [number, source] of [[13, "crafted"], [14, "essence"], [15, "desecrated"]]) test(`${number} ${source} source is excluded`, () => {
  const cat = catalog(d => { d.mods.mods[0].source = source; }); const entry = find(resolve({ cat }), "mod:prefix");
  assert.equal(entry.status, "ineligible"); assert.equal(hasReason(entry, ENGINE_ELIGIBILITY_CODES.SPECIAL_SOURCE_EXCLUDED), true);
});

test("16 unknown generation type is unresolved", () => { const base = catalog(); const cat = immutableCopy({ ...base, modifiers: { ...base.modifiers, "mod:prefix": { ...base.modifiers["mod:prefix"], generationType: "future" } } }); assert.equal(find(resolve({ cat }), "mod:prefix").status, "unresolved"); });
test("17 missing and unknown domain are distinct", () => { const missing = catalog(d => { delete d.mods.mods[0].domain; }); const unknown = immutableCopy({ ...missing, modifiers: { ...missing.modifiers, "mod:prefix": { ...missing.modifiers["mod:prefix"], domain: "future" } } }); assert.equal(hasReason(find(resolve({ cat: missing }), "mod:prefix"), ENGINE_ELIGIBILITY_CODES.DOMAIN_NOT_REQUIRED), true); assert.deepEqual(find(resolve({ cat: unknown }), "mod:prefix").reasons.find(r => r.code === ENGINE_ELIGIBILITY_CODES.DOMAIN_UNRESOLVED).details.status, "presentUnknown"); });
test("18 required missing domain is unresolved", () => { const cat = catalog(d => { delete d.mods.mods[0].domain; }); assert.equal(find(resolve({ cat, options: { capacityRules: { prefix: 3, suffix: 3 }, requireDomain: true } }), "mod:prefix").status, "unresolved"); });
test("19 positive weight passes", () => assert.deepEqual(find(resolve(), "mod:prefix").applicableWeight, { spawn: 100, generation: 1, spawnTag: "bow", generationTag: null }));
test("20 explicit zero weight is ineligible", () => { const cat = catalog(d => { d.affixGroups.groups[0].tiers[0].spawnWeights[0].weight = 0; }); assert.equal(hasReason(find(resolve({ cat }), "mod:prefix"), ENGINE_ELIGIBILITY_CODES.ZERO_WEIGHT), true); });
test("21 missing weight data is unresolved", () => { const cat = catalog(d => { delete d.affixGroups.groups[0].tiers[0].spawnWeights; delete d.mods.mods[0].spawnWeights; }); assert.equal(hasReason(find(resolve({ cat }), "mod:prefix"), ENGINE_ELIGIBILITY_CODES.WEIGHT_MISSING), true); });
test("22 invalid weight structure is a catalog error", () => { const base = catalog(); const cat = immutableCopy({ ...base, modifiers: { ...base.modifiers, "mod:prefix": { ...base.modifiers["mod:prefix"], spawnWeights: [{ tag: "bow", value: 2 }] } } }); const result = resolve({ cat }); assert.equal(result.valid, false); assert.equal(result.errors[0].code, ENGINE_ELIGIBILITY_CODES.CATALOG_INVALID); });
test("23 missing base tags is unresolved", () => { const base = catalog(); const cat = immutableCopy({ ...base, baseTypes: { ...base.baseTypes, "base:bow": { ...base.baseTypes["base:bow"], spawnTags: null } } }); assert.equal(hasReason(find(resolve({ cat }), "mod:prefix"), ENGINE_ELIGIBILITY_CODES.TAG_DATA_MISSING), true); });
test("24 explicit tag mismatch is ineligible", () => { const cat = catalog(d => { d.affixGroups.groups[0].tiers[0].spawnWeights = [{ tag: "staff", weight: 100 }]; }); assert.equal(hasReason(find(resolve({ cat }), "mod:prefix"), ENGINE_ELIGIBILITY_CODES.TAG_MISMATCH), true); });
test("25 duplicate modifier is excluded", () => { const item = state({ prefixModifiers: [modifierInstance("mod:prefix")] }); assert.equal(hasReason(find(resolve({ item }), "mod:prefix"), ENGINE_ELIGIBILITY_CODES.DUPLICATE_MODIFIER), true); });
test("26 technical mod-group conflict is excluded", () => { const item = state({ prefixModifiers: [modifierInstance("mod:prefix-other")] }); const base = catalog(); const cat = immutableCopy({ ...base, modifiers: { ...base.modifiers, "mod:prefix-other": { ...base.modifiers["mod:prefix"], id: "mod:prefix-other" } } }); assert.equal(hasReason(find(resolve({ cat, item }), "mod:prefix"), ENGINE_ELIGIBILITY_CODES.MOD_GROUP_CONFLICT), true); });
test("27 missing mod group is not inferred from names", () => { const item = state({ prefixModifiers: [modifierInstance("mod:prefix-other")] }); const base = catalog(); const cat = immutableCopy({ ...base, modifiers: { ...base.modifiers, "mod:prefix-other": { ...base.modifiers["mod:prefix"], id: "mod:prefix-other", modGroups: null } } }); assert.equal(hasReason(find(resolve({ cat, item }), "mod:suffix"), ENGINE_ELIGIBILITY_CODES.MOD_GROUP_UNRESOLVED), true); });
test("28 full explicit prefix capacity excludes prefixes and leaves suffix evaluation independent", () => {
  const item = state({ prefixModifiers: [modifierInstance("mod:spear")] });
  const result = resolve({ item, options: { capacityRules: { prefix: 1, suffix: 10 } } });
  assert.equal(hasReason(find(result, "mod:prefix"), ENGINE_ELIGIBILITY_CODES.PREFIX_CAPACITY_REACHED), true);
  assert.equal(find(result, "mod:suffix").status, "eligible");
});
test("29 full explicit suffix capacity excludes suffixes and leaves prefix evaluation independent", () => {
  const item = state({ suffixModifiers: [modifierInstance("mod:spear", "suffix")] });
  const result = resolve({ item, options: { capacityRules: { prefix: 10, suffix: 1 } } });
  assert.equal(hasReason(find(result, "mod:suffix"), ENGINE_ELIGIBILITY_CODES.SUFFIX_CAPACITY_REACHED), true);
  assert.equal(find(result, "mod:prefix").status, "eligible");
});
test("30 empty item without capacity rules leaves both regular affix sides unresolved and proves no default limits", () => {
  const result = resolve();
  for (const id of ["mod:prefix", "mod:suffix"]) {
    const entry = find(result, id);
    assert.equal(entry.status, "unresolved");
    assert.equal(hasReason(entry, ENGINE_ELIGIBILITY_CODES.CAPACITY_UNRESOLVED), true);
  }
  assert.equal(result.eligible.length, 0);
});

test("31 catalog is not mutated", () => { const cat = catalog(); const before = JSON.stringify(cat); resolve({ cat }); assert.equal(JSON.stringify(cat), before); });
test("32 item state is not mutated", () => { const item = state(); const before = JSON.stringify(item); resolve({ item }); assert.equal(JSON.stringify(item), before); });
test("33 rule context is not mutated", () => { const cat = catalog(); const item = state(); const ruleContext = createRuleContext({ itemState: item, catalog: cat }); const before = JSON.stringify(ruleContext); resolve({ cat, item, ruleContext }); assert.equal(JSON.stringify(ruleContext), before); });
test("34 action context is not mutated", () => { const value = { target: { type: "regular" } }; const before = JSON.stringify(value); resolve({ actionContext: value }); assert.equal(JSON.stringify(value), before); });
test("35 result is recursively immutable", () => { const result = resolve({ options: { capacityRules: TEST_CAPACITY_RULES } }); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.eligible)); assert.ok(Object.isFrozen(result.eligible[0].reasons[0].details)); });
test("36 identical resolutions are byte-identical", () => assert.equal(JSON.stringify(resolve()), JSON.stringify(resolve())));
test("37 permuted equivalent inputs have byte-identical technical ordering", () => {
  const base = catalog();
  const unresolved = { ...base.modifiers["mod:prefix"], id: "mod:unresolved", source: null };
  const modifierEntries = [...Object.entries(base.modifiers), [unresolved.id, unresolved]];
  const makeCatalog = (entries, tags, reverseSuffixWeights) => immutableCopy({
    ...base,
    baseTypes: { ...base.baseTypes, "base:bow": { ...base.baseTypes["base:bow"], spawnTags: tags } },
    modifiers: Object.fromEntries(entries.map(([id, modifier]) => [id, id === "mod:suffix" ? {
      ...modifier,
      spawnWeights: reverseSuffixWeights ? [{ tag: "bow", weight: 100 }, { tag: "staff", weight: 9 }] : [{ tag: "staff", weight: 9 }, { tag: "bow", weight: 100 }]
    } : modifier]))
  });
  const resultA = resolve({ cat: makeCatalog(modifierEntries, ["bow", "default", "weapon"], false), options: { capacityRules: { prefix: 10, suffix: 10 } } });
  const resultB = resolve({ cat: makeCatalog([...modifierEntries].reverse(), ["weapon", "default", "bow"], true), options: { capacityRules: { suffix: 10, prefix: 10 } } });
  assert.equal(JSON.stringify(resultA), JSON.stringify(resultB));
  assert.deepEqual(resultA.eligible.map(candidate => candidate.modifierId), ["mod:prefix", "mod:suffix"]);
  assert.deepEqual(resultA.ineligible.map(candidate => candidate.modifierId), ["mod:spear"]);
  assert.deepEqual(resultA.unresolved.map(candidate => candidate.modifierId), ["mod:unresolved"]);
  assert.deepEqual(find(resultA, "mod:unresolved").reasons.map(entry => entry.code), [
    "ENGINE_ELIGIBILITY_BASE_TYPE_MATCH", "ENGINE_ELIGIBILITY_CAPACITY_AVAILABLE", "ENGINE_ELIGIBILITY_DOMAIN_KNOWN",
    "ENGINE_ELIGIBILITY_MOD_GROUP_CLEAR", "ENGINE_ELIGIBILITY_GENERATION_TYPE_REGULAR", "ENGINE_ELIGIBILITY_ITEM_CLASS_MATCH",
    "ENGINE_ELIGIBILITY_ITEM_LEVEL_MET", "ENGINE_ELIGIBILITY_SPECIAL_SOURCE_EXCLUDED", "ENGINE_ELIGIBILITY_TAG_DATA_PRESENT",
    "ENGINE_ELIGIBILITY_POSITIVE_WEIGHT", "ENGINE_ELIGIBILITY_POSITIVE_WEIGHT"
  ]);
  assert.deepEqual(resultA.errors, []);
  assert.deepEqual(resultA.warnings.map(entry => `${entry.modifierId}|${entry.code}`), ["mod:unresolved|ENGINE_ELIGIBILITY_SPECIAL_SOURCE_EXCLUDED"]);
  assert.deepEqual(resultA.evaluatedRules, ["baseType", "capacity", "domain", "existingModifiers", "generationType", "itemClass", "itemLevel", "source", "tags", "weights"]);
});
test("38 result has no time random or absolute paths", () => assert.doesNotMatch(JSON.stringify(resolve()), /generatedAt|Math\.random|Date\(|[A-Za-z]:\\/));
test("39 empty candidate set is valid", () => { const base = catalog(); const cat = immutableCopy({ ...base, modifiers: {} }); const result = resolve({ cat }); assert.equal(result.valid, true); assert.equal(result.summary.total, 0); });

for (const [number, itemClassId] of [[40, "Spear"], [41, "Bow"], [42, "Body Armour"], [43, "Ring"], [44, "Jewel"]]) test(`${number} real ${itemClassId} sample resolves`, () => {
  const cat = loadModifierCatalog(); const base = Object.values(cat.baseTypes).find(row => row.itemClassId === itemClassId); assert.ok(base);
  const item = createItemState({ itemId: `sample:${itemClassId}`, baseTypeId: base.id, itemClassId, itemLevel: 86, rarity: "rare" });
  const result = resolveEligibleModifiers({ itemState: item, catalog: cat });
  assert.equal(result.valid, true); assert.equal(result.candidateCount, Object.keys(cat.modifiers).length);
  assert.equal(result.eligible.length, 0); assert.ok(result.unresolved.length > 0);
});

test("45 summary equals the three lists", () => { const r = resolve(); assert.equal(r.summary.total, r.eligible.length + r.ineligible.length + r.unresolved.length); assert.equal(r.summary.eligibleCount, r.eligible.length); assert.equal(r.summary.ineligibleCount, r.ineligible.length); assert.equal(r.summary.unresolvedCount, r.unresolved.length); });
test("46 candidate appears in exactly one list", () => { const r = resolve(); const ids = [...r.eligible, ...r.ineligible, ...r.unresolved].map(x => x.modifierId); assert.equal(ids.length, new Set(ids).size); });
test("47 safe exclusion outranks unresolved", () => { const cat = catalog(d => { delete d.mods.mods[0].domain; d.affixGroups.groups[0].tiers[0].spawnWeights[0].weight = 0; }); const entry = find(resolve({ cat, options: { requireDomain: true, capacityRules: { prefix: 3, suffix: 3 } } }), "mod:prefix"); assert.equal(entry.status, "ineligible"); });
test("48 unresolved required rule prevents eligible", () => assert.equal(find(resolve({ options: {} }), "mod:prefix").status, "unresolved"));
test("49 source and generation type remain separate", () => { const cat = catalog(d => { d.mods.mods[0].source = "crafted"; }); const entry = find(resolve({ cat }), "mod:prefix"); assert.equal(entry.source, "crafted"); assert.equal(entry.generationType, "prefix"); });
test("50 existing item-state and rule-set APIs remain exported", async () => { const api = await import("../index.mjs"); assert.equal(typeof api.createItemState, "function"); assert.equal(typeof api.evaluateRuleSets, "function"); });
test("51 explicit synthetic capacity with free slots permits both affix sides", () => {
  const result = resolve({ options: { capacityRules: TEST_CAPACITY_RULES } });
  assert.equal(find(result, "mod:prefix").status, "eligible"); assert.equal(find(result, "mod:suffix").status, "eligible");
});
test("52 catalog error outranks a simultaneous safe exclusion without hiding either reason", () => {
  const base = catalog();
  const cat = immutableCopy({ ...base, modifiers: { ...base.modifiers, "mod:prefix": { ...base.modifiers["mod:prefix"], spawnWeights: [{ tag: "bow", value: 1 }] } } });
  const item = state({ prefixModifiers: [modifierInstance("mod:prefix")] });
  const result = resolve({ cat, item, options: { capacityRules: TEST_CAPACITY_RULES } });
  const entry = find(result, "mod:prefix");
  assert.equal(result.valid, false); assert.equal(entry.status, "unresolved");
  assert.equal(hasReason(entry, ENGINE_ELIGIBILITY_CODES.CATALOG_INVALID), true);
  assert.equal(hasReason(entry, ENGINE_ELIGIBILITY_CODES.DUPLICATE_MODIFIER), true);
  assert.equal(result.unresolved.filter(candidate => candidate.modifierId === entry.modifierId).length, 1);
  assert.equal(result.ineligible.some(candidate => candidate.modifierId === entry.modifierId), false);
  assert.equal(result.eligible.some(candidate => candidate.modifierId === entry.modifierId), false);
});
test("53 technical comparator uses explicit JavaScript code-unit order", () => {
  const values = ["ä:mod", "a:mod", "A:mod", "z:mod", "_:mod"];
  assert.deepEqual([...values].sort(compareTechnicalStrings), ["A:mod", "_:mod", "a:mod", "z:mod", "ä:mod"]);
  assert.equal(compareTechnicalStrings("same", "same"), 0);
});
test("54 resolver source contains no locale-sensitive comparator", () => {
  const source = readFileSync(new URL("../eligible-modifier-resolver.mjs", import.meta.url), "utf8");
  assert.equal(source.includes(".localeCompare("), false);
  assert.equal(source.includes("Intl.Collator"), false);
});
test("55 existing modifier insertion order uses technical conflict tie-breakers", () => {
  const base = catalog();
  const existingA = { ...base.modifiers["mod:prefix"], id: "mod:existing-A", regularItemClassIds: ["Spear"] };
  const existingB = { ...base.modifiers["mod:prefix"], id: "mod:existing-B", regularItemClassIds: ["Spear"] };
  const cat = immutableCopy({ ...base, modifiers: { ...base.modifiers, [existingB.id]: existingB, [existingA.id]: existingA } });
  const instanceA = modifierInstance(existingA.id);
  const instanceB = { ...modifierInstance(existingB.id), instanceId: `instance:${existingB.id}` };
  const resultA = resolve({ cat, item: state({ prefixModifiers: [instanceB, instanceA] }), options: { capacityRules: TEST_CAPACITY_RULES } });
  const resultB = resolve({ cat, item: state({ prefixModifiers: [instanceA, instanceB] }), options: { capacityRules: TEST_CAPACITY_RULES } });
  assert.equal(JSON.stringify(resultA), JSON.stringify(resultB));
  assert.equal(find(resultA, "mod:prefix").reasons.find(entry => entry.code === ENGINE_ELIGIBILITY_CODES.MOD_GROUP_CONFLICT).details.existingModifierId, "mod:existing-A");
});
