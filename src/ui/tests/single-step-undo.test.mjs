import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createItemState, createModifierCatalog, reviseItemState } from "../../engine/browser.mjs";
import { runSingleStep } from "../single-step-controller.mjs";
import {
  adoptSingleStepResult,
  applySingleStepUndo,
  canUndoSingleStep,
  restoreSingleStepUndo,
  undoTargetFromResult
} from "../single-step-undo.mjs";

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

const before = () => createItemState({
  itemId: "undo:item",
  baseTypeId: "base:bow",
  itemClassId: "Bow",
  itemLevel: 86,
  rarity: "magic",
  metadata: { source: "undo-test", nested: { retained: true } }
});

test("successful result exposes exactly its authoritative previous item state", () => {
  const previousItemState = before();
  const itemState = reviseItemState(previousItemState, { rarity: "rare" });
  const target = undoTargetFromResult({ status: "successful", previousItemState, itemState });
  assert.equal(target, previousItemState);
  assert.equal(Object.isFrozen(target), true);
  assert.equal(Object.isFrozen(target.metadata.nested), true);
});

test("non-successful results and exceptions represented without a result expose no undo target", () => {
  const previousItemState = before();
  for (const status of ["inapplicable", "unresolved", "error"]) {
    assert.equal(undoTargetFromResult({ status, previousItemState }), null);
  }
  assert.equal(undoTargetFromResult(null), null);
});

test("undo readiness requires one target and rejects busy execution", () => {
  assert.equal(canUndoSingleStep({ undoItemState: before() }), true);
  assert.equal(canUndoSingleStep({ undoItemState: before(), busy: true }), false);
  assert.equal(canUndoSingleStep({ undoItemState: null }), false);
});

test("undo restores the exact immutable state without copying or mutation", () => {
  const target = before();
  const snapshot = JSON.stringify(target);
  assert.equal(restoreSingleStepUndo(target), target);
  assert.equal(JSON.stringify(target), snapshot);
  assert.equal(restoreSingleStepUndo(null), null);
});

test("successful results are adopted while every non-success preserves current state and clears undo", () => {
  const currentItemState = before();
  const successfulItemState = reviseItemState(currentItemState, { rarity: "rare" });
  const success = adoptSingleStepResult({
    currentItemState,
    result: { status: "successful", previousItemState: currentItemState, itemState: successfulItemState }
  });
  assert.equal(success.itemState, successfulItemState);
  assert.equal(success.undoItemState, currentItemState);
  for (const status of ["inapplicable", "unresolved", "error"]) {
    const result = { status, itemState: currentItemState };
    const transition = adoptSingleStepResult({ currentItemState, result });
    assert.equal(transition.itemState, currentItemState);
    assert.equal(transition.undoItemState, null);
    assert.equal(transition.result, result);
  }
});

test("undo consumes the single target without preserving a redo state", () => {
  const target = before();
  const currentItemState = reviseItemState(target, { rarity: "rare" });
  const transition = applySingleStepUndo({ currentItemState, undoItemState: target });
  assert.equal(transition.itemState, target);
  assert.equal(transition.undoItemState, null);
  assert.equal(transition.result, null);
  assert.equal(transition.undone, true);
  const second = applySingleStepUndo({ currentItemState: transition.itemState, undoItemState: transition.undoItemState });
  assert.equal(second.itemState, target);
  assert.equal(second.undone, false);
});

test("all four supported actions restore exact pre-craft rarity, revision, and modifiers", () => {
  const transmutationBefore = createItemState({ itemId: "t", baseTypeId: "base:bow", itemClassId: "Bow", itemLevel: 86, rarity: "normal" });
  const transmutation = runSingleStep({ itemState: transmutationBefore, catalog, actionId: "currency:transmutation", seed: 0 });
  const augmentationBefore = transmutation.itemState;
  const augmentation = runSingleStep({ itemState: augmentationBefore, catalog, actionId: "currency:augmentation", seed: 0 });
  const regalBefore = createItemState({ itemId: "r", baseTypeId: "base:bow", itemClassId: "Bow", itemLevel: 86, rarity: "magic" });
  const regal = runSingleStep({ itemState: regalBefore, catalog, actionId: "currency:regal", seed: 0 });
  const exaltedBefore = createItemState({ itemId: "e", baseTypeId: "base:bow", itemClassId: "Bow", itemLevel: 86, rarity: "rare" });
  const exalted = runSingleStep({ itemState: exaltedBefore, catalog, actionId: "currency:exalted", seed: 0 });
  for (const [expected, result] of [[transmutationBefore, transmutation], [augmentationBefore, augmentation], [regalBefore, regal], [exaltedBefore, exalted]]) {
    assert.equal(result.status, "successful");
    const adopted = adoptSingleStepResult({ currentItemState: expected, result });
    const undone = applySingleStepUndo({ currentItemState: adopted.itemState, undoItemState: adopted.undoItemState });
    assert.equal(undone.itemState, expected);
    assert.equal(undone.itemState.rarity, expected.rarity);
    assert.equal(undone.itemState.revision, expected.revision);
    assert.equal(undone.itemState.prefixModifiers, expected.prefixModifiers);
    assert.equal(undone.itemState.suffixModifiers, expected.suffixModifiers);
  }
});

test("undo state preserves identity, revision, rarity, modifiers, metadata, and history", () => {
  const target = before();
  assert.equal(target.itemId, "undo:item");
  assert.equal(target.baseTypeId, "base:bow");
  assert.equal(target.itemLevel, 86);
  assert.equal(target.revision, 0);
  assert.equal(target.rarity, "magic");
  assert.deepEqual(target.prefixModifiers, []);
  assert.deepEqual(target.suffixModifiers, []);
  assert.deepEqual(target.metadata, { source: "undo-test", nested: { retained: true } });
  assert.deepEqual(target.history, []);
});

test("production undo path does not call simulator, RNG, catalog loading, capacity rules, or history mutation", async () => {
  const appSource = await readFile(new URL("../../../app.js", import.meta.url), "utf8");
  const undoSource = appSource.match(/function undoSingleStep\(\)[\s\S]*?\n  }/)?.[0] ?? "";
  assert.match(undoSource, /applySingleStepUndo/);
  assert.doesNotMatch(undoSource, /runSingleStep|simulateCraftingStep|nextUiSeed|crypto|getRandomValues|Catalog|capacity|history|push\(|\[\]/);
});

test("app keeps one scalar undo target, clears it on reset and new attempts, and never creates redo", async () => {
  const appSource = await readFile(new URL("../../../app.js", import.meta.url), "utf8");
  assert.match(appSource, /undoItemState:\s*null/);
  assert.doesNotMatch(appSource, /undo(Item)?History|redo(Item)?State/);
  assert.match(appSource, /function resetSingleStep\(\)[\s\S]*?undoItemState = null/);
  assert.match(appSource, /function executeSingleStep\(\)[\s\S]*?undoItemState = null[\s\S]*?runSingleStep/);
  assert.match(appSource, /adoptSingleStepResult/);
  assert.match(appSource, /function undoSingleStep\(\)[\s\S]*?undoItemState = transition\.undoItemState/);
});

test("button is a disabled non-action button and uses existing responsive controls", async () => {
  const html = await readFile(new URL("../../../index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../../../style.css", import.meta.url), "utf8");
  const button = html.match(/<button id="singleStepUndoBtn"[^>]*>/)?.[0] ?? "";
  assert.match(button, /type="button"/);
  assert.match(button, /disabled/);
  assert.doesNotMatch(button, /data-action|action-id/);
  assert.match(css, /@media\(max-width:520px\)\{\.single-step-actions,.single-step-summary\{grid-template-columns:1fr\}\}/);
});

test("undo status is plain text and the previous result is removed", async () => {
  const appSource = await readFile(new URL("../../../app.js", import.meta.url), "utf8");
  const undoSource = appSource.match(/function undoSingleStep\(\)[\s\S]*?\n  }/)?.[0] ?? "";
  assert.match(undoSource, /result = transition\.result/);
  assert.match(undoSource, /Letzter Crafting-Schritt wurde rückgängig gemacht\./);
  assert.match(appSource, /singleStepReadiness'\)\.textContent = statusMessage/);
  assert.doesNotMatch(undoSource, /innerHTML/);
});

test("catalog text payload remains delegated to the existing safe result renderer", async () => {
  const rendererSource = await readFile(new URL("../single-step-result-renderer.mjs", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../../../app.js", import.meta.url), "utf8");
  assert.match(rendererSource, /node\.textContent = String\(value\)/);
  assert.doesNotMatch(rendererSource, /innerHTML/);
  assert.doesNotMatch(appSource.match(/function undoSingleStep\(\)[\s\S]*?\n  }/)?.[0] ?? "", /innerHTML|createElement/);
});
