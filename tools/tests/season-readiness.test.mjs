import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertBaselineAllowed, baselineFromSnapshot, compareSnapshots, hash } from "../lib/season-readiness.mjs";

function emptySnapshot() {
  return { schemaVersion: 1, sourceSnapshot: "fixture", content: {
    itemClasses: {}, bases: {}, affixFamilies: {}, modifiers: {}, regularTiers: {},
    vocabularies: { statIds: [], modGroups: [], spawnTags: [], generationTypes: ["prefix", "suffix"], modDomains: [], itemDomains: [], modifierFlags: [], craftingActions: ["add"], craftingSources: ["Essenz"], craftingCategories: ["essences", "omens", "currencies"], equipmentFields: [], craftingFields: ["essences.essences[].id"] },
    crafting: { essences: {}, essenceEffects: {}, omens: {}, currencies: {}, craftedModifiers: {}, desecratedModifiers: {}, methods: {} }
  } };
}
function clone(value) { return structuredClone(value); }
function compare(mutate) { const before = emptySnapshot(); const after = clone(before); mutate?.(after.content); after.sourceSnapshot = hash(after.content); return compareSnapshots(before, after); }

test("A no changes is GREEN", () => assert.equal(compare().status, "green"));
test("B new base type is GREEN", () => assert.equal(compare(content => { content.bases.base1 = { id: "base1", name: "Base" }; }).status, "green"));
test("C new regular affix family is GREEN", () => assert.equal(compare(content => { content.affixFamilies.family1 = { id: "family1", generationType: "prefix" }; }).status, "green"));
test("D new known essence variant is YELLOW", () => assert.equal(compare(content => { content.crafting.essences.essence2 = { id: "essence2", nameEn: "Known variant" }; }).status, "yellow"));
test("E new crafting currency is YELLOW", () => assert.equal(compare(content => { content.crafting.currencies.currency2 = { id: "currency2", nameEn: "Currency" }; }).status, "yellow"));
test("F unknown generation type is RED", () => assert.equal(compare(content => { content.vocabularies.generationTypes.push("seasonal_mutation"); }).status, "red"));
test("G unknown behavioral rule field is RED", () => assert.equal(compare(content => { content.vocabularies.craftingFields.push("currencies.currencies[].targetingRule"); }).status, "red"));
test("H removed modifier is at least YELLOW", () => { const before = emptySnapshot(); before.content.modifiers.mod1 = { id: "mod1" }; const after = clone(before); delete after.content.modifiers.mod1; assert.notEqual(compareSnapshots(before, after).status, "green"); });
test("I known weight value changes are GREEN and reported", () => { const before = emptySnapshot(); before.content.modifiers.mod1 = { id: "mod1", values: [], requiredLevel: 1, spawnWeights: [{ tag: "default", weight: 1 }], generationWeights: [] }; const after = clone(before); after.content.modifiers.mod1.spawnWeights[0].weight = 2; const result = compareSnapshots(before, after); assert.equal(result.status, "green"); assert.equal(result.summary.changedSpawnWeights, 1); });
test("J audit comparison never overwrites baseline", () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "season-readiness-")); const file = path.join(dir, "baseline.json"); const baseline = baselineFromSnapshot(emptySnapshot(), "fixed"); fs.writeFileSync(file, JSON.stringify(baseline)); const beforeHash = hash(fs.readFileSync(file, "utf8")); compareSnapshots(baseline.snapshot, clone(baseline.snapshot)); assert.equal(hash(fs.readFileSync(file, "utf8")), beforeHash); });
test("K baseline guard fails for RED status", () => assert.throws(() => assertBaselineAllowed({ coverage: { visibleEligibleMods: 1, poe2dbMods: 1, missing: {} }, parity: { passed: true }, groupAudit: { passed: true }, seasonStatus: "red" }), /RED/));
