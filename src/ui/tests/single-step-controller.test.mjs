import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createModifierCatalog, getDefaultCapacityRules } from "../../engine/browser.mjs";
import {
  SINGLE_STEP_ACTIONS,
  canRunSingleStep,
  capacityRulesForRarity,
  createSingleStepItem,
  runSingleStep
} from "../single-step-controller.mjs";

const catalog = createModifierCatalog({
  index: { classes: [{ id: "Bow" }] },
  bases: { bases: [{ id: "base:bow", itemClass: "Bow", tags: ["bow"] }] },
  mods: { mods: [
    { modId: "mod:prefix", generationType: "prefix", domain: "item", source: "normal", technicalStats: [{ id: "stat:prefix" }], group: "group:prefix" },
    { modId: "mod:suffix", generationType: "suffix", domain: "item", source: "normal", technicalStats: [{ id: "stat:suffix" }], group: "group:suffix" }
  ] },
  affixGroups: { groups: [
    { familyId: "family:prefix", generationType: "prefix", tiers: [{ modId: "mod:prefix", technicalTier: 1, displayTiers: { Bow: 1 }, requiredLevel: 1, regularClasses: ["Bow"], spawnWeights: [{ tag: "bow", weight: 100 }], generationWeights: [{ tag: "bow", weight: 100 }] }] },
    { familyId: "family:suffix", generationType: "suffix", tiers: [{ modId: "mod:suffix", technicalTier: 1, displayTiers: { Bow: 1 }, requiredLevel: 1, regularClasses: ["Bow"], spawnWeights: [{ tag: "bow", weight: 100 }], generationWeights: [{ tag: "bow", weight: 100 }] }] }
  ] }
});

const item = rarity => createSingleStepItem({ baseTypeId: "base:bow", itemClassId: "Bow", itemLevel: 86, rarity });

test("UI adapter creates a valid technical item state", () => {
  const state = item("magic");
  assert.equal(state.baseTypeId, "base:bow");
  assert.equal(state.itemLevel, 86);
  assert.equal(state.rarity, "magic");
});

test("Magic and Rare explicitly select authoritative capacity rules", () => {
  assert.equal(capacityRulesForRarity("magic"), getDefaultCapacityRules().magic);
  assert.equal(capacityRulesForRarity("rare"), getDefaultCapacityRules().rare);
});

test("Normal has no invented capacity rule", () => assert.equal(capacityRulesForRarity("normal"), undefined));

test("successful deterministic step adopts the resulting state", () => {
  const result = runSingleStep({ itemState: item("magic"), catalog, actionId: "currency:augmentation", seed: 0 });
  assert.equal(result.status, "successful");
  assert.equal(result.itemState.revision, 1);
  assert.equal(result.itemState.prefixModifiers.length + result.itemState.suffixModifiers.length, 1);
  assert.equal(result.selectionResult.selectedCandidateId, "mod:prefix");
});

test("inapplicable action preserves current state", () => {
  const before = item("normal");
  const result = runSingleStep({ itemState: before, catalog, actionId: "currency:augmentation", seed: 0 });
  assert.equal(result.status, "inapplicable");
  assert.equal(result.reasonCode, "ENGINE_ACTION_ITEM_RARITY_NOT_ALLOWED");
  assert.equal(result.itemState, before);
});

test("unresolved result preserves current state", () => {
  const incomplete = createModifierCatalog({
    index: { classes: [{ id: "Bow" }] },
    bases: { bases: [{ id: "base:bow", itemClass: "Bow" }] },
    mods: { mods: [{ modId: "mod:prefix", generationType: "prefix", technicalStats: [{ id: "stat" }], group: "group" }] },
    affixGroups: { groups: [{ familyId: "family", generationType: "prefix", tiers: [{ modId: "mod:prefix", regularClasses: ["Bow"] }] }] }
  });
  const before = item("magic");
  const result = runSingleStep({ itemState: before, catalog: incomplete, actionId: "currency:augmentation", seed: 0 });
  assert.equal(result.status, "unresolved");
  assert.equal(result.itemState, before);
});

test("error preserves current state", () => {
  const before = item("magic");
  const result = runSingleStep({ itemState: before, catalog: {}, actionId: "currency:augmentation", seed: 0 });
  assert.equal(result.status, "error");
  assert.equal(result.itemState, before);
});

test("reset is a fresh adapter state for changed inputs", () => {
  const previous = runSingleStep({ itemState: item("magic"), catalog, actionId: "currency:augmentation", seed: 0 }).itemState;
  const reset = createSingleStepItem({ baseTypeId: "base:bow", itemClassId: "Bow", itemLevel: 20, rarity: "rare" });
  assert.equal(previous.revision, 1);
  assert.equal(reset.revision, 0);
  assert.equal(reset.itemLevel, 20);
  assert.equal(reset.rarity, "rare");
  assert.equal(reset.prefixModifiers.length + reset.suffixModifiers.length, 0);
});

test("readiness rejects missing fields and unsupported actions", () => {
  assert.equal(canRunSingleStep({ itemState: null, catalog, actionId: SINGLE_STEP_ACTIONS[0].id }).enabled, false);
  assert.equal(canRunSingleStep({ itemState: item("magic"), catalog: null, actionId: SINGLE_STEP_ACTIONS[0].id }).enabled, false);
  assert.equal(canRunSingleStep({ itemState: item("magic"), catalog, actionId: "currency:chaos" }).enabled, false);
});

test("UI controller imports browser entry only and no Node loader", async () => {
  const source = await readFile(new URL("../single-step-controller.mjs", import.meta.url), "utf8");
  assert.match(source, /engine\/browser\.mjs/);
  assert.doesNotMatch(source, /node:/);
  assert.doesNotMatch(source, /loadModifierCatalog/);
});
