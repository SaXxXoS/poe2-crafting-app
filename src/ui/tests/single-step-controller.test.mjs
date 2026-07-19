import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createItemState, createModifierCatalog, evaluateCraftingAction, getDefaultCapacityRules } from "../../engine/browser.mjs";
import {
  SINGLE_STEP_ACTIONS,
  canRunSingleStep,
  capacityRulesForAction,
  capacityRulesForRarity,
  createSingleStepItem,
  diagnosticMessageDe,
  optionalAffixGroupsFile,
  validateItemLevel,
  runSingleStep
} from "../single-step-controller.mjs";
import { renderSingleStepResult } from "../single-step-result-renderer.mjs";
import { undoTargetFromResult } from "../single-step-undo.mjs";

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
const modifier = (instanceId, generationType, source = "normal") => ({ instanceId, modId: generationType === "prefix" ? "mod:prefix" : "mod:suffix", familyId: `family:${generationType}`, generationType, domain: "item", technicalTier: 1, displayTier: 1, statIds: [`stat:${generationType}`], values: [], source, appliedAtRevision: 0, metadata: {} });
const affixedItem = (changes = {}) => createItemState({ itemId: "item:annulment-ui", baseTypeId: "base:bow", itemClassId: "Bow", itemLevel: 86, rarity: "rare", prefixModifiers: [modifier("instance:prefix", "prefix")], suffixModifiers: [modifier("instance:suffix", "suffix")], ...changes });

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

test("single-step actions expose Transmutation first with the authoritative action id", () => {
  assert.deepEqual(SINGLE_STEP_ACTIONS.map(action => action.id), [
    "currency:transmutation",
    "currency:augmentation",
    "currency:regal",
    "currency:exalted",
    "currency:annulment"
  ]);
  assert.equal(SINGLE_STEP_ACTIONS[0].label, "Transmutation");
  assert.equal(SINGLE_STEP_ACTIONS.at(-1).label, "Sphäre der Annullierung");
});

test("actions explicitly select the matching authoritative capacity without a Normal rule", () => {
  const defaults = getDefaultCapacityRules();
  assert.equal(capacityRulesForAction("currency:transmutation"), defaults.magic);
  assert.equal(capacityRulesForAction("currency:augmentation"), defaults.magic);
  assert.equal(capacityRulesForAction("currency:regal"), defaults.rare);
  assert.equal(capacityRulesForAction("currency:exalted"), defaults.rare);
  assert.equal(capacityRulesForAction("currency:unknown"), undefined);
  assert.equal(capacityRulesForRarity("normal"), undefined);
});

test("successful Transmutation adopts one deterministic modifier and changes Normal to Magic", () => {
  const before = item("normal");
  const serializedBefore = JSON.stringify(before);
  const result = runSingleStep({ itemState: before, catalog, actionId: "currency:transmutation", seed: 0 });
  assert.equal(result.status, "successful");
  assert.equal(result.previousItemState, before);
  assert.equal(result.itemState.rarity, "magic");
  assert.equal(result.itemState.revision, before.revision + 1);
  assert.equal(result.itemState.prefixModifiers.length + result.itemState.suffixModifiers.length, 1);
  assert.equal(JSON.stringify(before), serializedBefore);
});

test("controlled seeded Transmutation can select a prefix and a suffix", () => {
  const prefix = runSingleStep({ itemState: item("normal"), catalog, actionId: "currency:transmutation", seed: 0 });
  const suffixSeed = Array.from({ length: 1000 }, (_, seed) => seed)
    .find(seed => runSingleStep({ itemState: item("normal"), catalog, actionId: "currency:transmutation", seed }).itemState.suffixModifiers.length === 1);
  assert.equal(prefix.itemState.prefixModifiers.length, 1);
  assert.notEqual(suffixSeed, undefined);
  const suffix = runSingleStep({ itemState: item("normal"), catalog, actionId: "currency:transmutation", seed: suffixSeed });
  assert.equal(suffix.itemState.suffixModifiers.length, 1);
});

test("manual Augmentation continues from the successful Transmutation state", () => {
  const transmuted = runSingleStep({ itemState: item("normal"), catalog, actionId: "currency:transmutation", seed: 0 });
  const augmented = runSingleStep({ itemState: transmuted.itemState, catalog, actionId: "currency:augmentation", seed: 0 });
  assert.equal(augmented.status, "successful");
  assert.equal(augmented.itemState.rarity, "magic");
  assert.equal(augmented.itemState.revision, 2);
  assert.equal(augmented.itemState.prefixModifiers.length + augmented.itemState.suffixModifiers.length, 2);
});

test("Transmutation rejects Magic, Rare, and every affixed Normal shape without mutation", () => {
  const prefixState = runSingleStep({ itemState: item("normal"), catalog, actionId: "currency:transmutation", seed: 0 }).itemState;
  const suffixSeed = Array.from({ length: 1000 }, (_, seed) => seed)
    .find(seed => runSingleStep({ itemState: item("normal"), catalog, actionId: "currency:transmutation", seed }).itemState.suffixModifiers.length === 1);
  const suffixState = runSingleStep({ itemState: item("normal"), catalog, actionId: "currency:transmutation", seed: suffixSeed }).itemState;
  const cases = [
    item("magic"),
    item("rare"),
    { ...prefixState, rarity: "normal" },
    { ...suffixState, rarity: "normal" },
    { ...prefixState, rarity: "normal", suffixModifiers: suffixState.suffixModifiers }
  ];
  for (const before of cases) {
    const serializedBefore = JSON.stringify(before);
    const result = runSingleStep({ itemState: before, catalog, actionId: "currency:transmutation", seed: 0 });
    assert.equal(result.status, "inapplicable");
    assert.equal(result.itemState, before);
    assert.equal(JSON.stringify(before), serializedBefore);
  }
});

test("Augmentation, Regal, and Exalted remain executable through the shared pipeline", () => {
  const augmentation = runSingleStep({ itemState: item("magic"), catalog, actionId: "currency:augmentation", seed: 0 });
  const regal = runSingleStep({ itemState: item("magic"), catalog, actionId: "currency:regal", seed: 0 });
  const exalted = runSingleStep({ itemState: item("rare"), catalog, actionId: "currency:exalted", seed: 0 });
  assert.equal(augmentation.status, "successful");
  assert.equal(regal.status, "successful");
  assert.equal(regal.itemState.rarity, "rare");
  assert.equal(exalted.status, "successful");
});

test("Transmutation unresolved weight data preserves the Normal state", () => {
  const incomplete = createModifierCatalog({
    index: { classes: [{ id: "Bow" }] },
    bases: { bases: [{ id: "base:bow", itemClass: "Bow", tags: ["bow"] }] },
    mods: { mods: [{ modId: "mod:prefix", generationType: "prefix", domain: "item", source: "normal", technicalStats: [{ id: "stat" }], group: "group" }] },
    affixGroups: { groups: [{ familyId: "family", generationType: "prefix", tiers: [{ modId: "mod:prefix", regularClasses: ["Bow"], spawnWeights: null }] }] }
  });
  const before = item("normal");
  const result = runSingleStep({ itemState: before, catalog: incomplete, actionId: "currency:transmutation", seed: 0 });
  assert.equal(result.status, "unresolved");
  assert.equal(result.itemState, before);
});

test("Transmutation controller contains one simulator call and no direct random selection", async () => {
  const source = await readFile(new URL("../single-step-controller.mjs", import.meta.url), "utf8");
  const runSource = source.match(/export function runSingleStep[\s\S]*?\n}/)?.[0] ?? "";
  const appSource = await readFile(new URL("../../../app.js", import.meta.url), "utf8");
  const executeSource = appSource.match(/function executeSingleStep\(\)[\s\S]*?\n  }/)?.[0] ?? "";
  assert.equal((runSource.match(/simulateCraftingStep\s*\(/g) ?? []).length, 1);
  assert.equal((executeSource.match(/runSingleStep\s*\(/g) ?? []).length, 1);
  assert.equal((appSource.match(/singleStepRunBtn'\)\.addEventListener\('click', executeSingleStep\)/g) ?? []).length, 1);
  assert.doesNotMatch(runSource, /Math\.random/);
  assert.match(runSource, /selectWeightedModifier/);
  assert.match(runSource, /createSeededRandom/);
});

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

test("raw item-level validation accepts only integers from 1 through 86", () => {
  for (const rawValue of ["", "0", "-1", "87", "10.5", "not-a-number"]) {
    const validation = validateItemLevel(rawValue);
    assert.equal(validation.valid, false, String(rawValue));
    assert.equal(validation.value, null, String(rawValue));
  }
  assert.deepEqual(validateItemLevel("1"), { valid: true, value: 1, reason: null });
  assert.deepEqual(validateItemLevel("86"), { valid: true, value: 86, reason: null });
});

test("invalid raw item level prevents execution without replacing the item state", () => {
  const before = item("magic");
  const validation = validateItemLevel("87");
  const result = runSingleStep({ itemState: before, catalog, actionId: "currency:augmentation", seed: 0, itemLevelValidation: validation });
  assert.equal(result.status, "error");
  assert.equal(result.itemState, before);
  assert.equal(result.actionResult, null);
  assert.match(result.message, /ganze Zahl zwischen 1 und 86/);
});

test("missing affixGroupsFile introduces no fallback catalog request", async () => {
  assert.equal(optionalAffixGroupsFile({ classes: [] }), null);
  assert.equal(optionalAffixGroupsFile({ affixGroupsFile: "" }), null);
  assert.equal(optionalAffixGroupsFile({ affixGroupsFile: "affix-groups.json" }), "affix-groups.json");
  const appSource = await readFile(new URL("../../../app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /affixGroupsFile\s*\|\|/);
  assert.doesNotMatch(appSource, /APP_DATA_ROOT[^\n]*affix-groups\.json/);
});

test("UI controller imports browser entry only and no Node loader", async () => {
  const source = await readFile(new URL("../single-step-controller.mjs", import.meta.url), "utf8");
  assert.match(source, /engine\/browser\.mjs/);
  assert.doesNotMatch(source, /node:/);
  assert.doesNotMatch(source, /loadModifierCatalog/);
});

test("Annulment readiness delegates applicability to the engine", () => {
  assert.equal(canRunSingleStep({ itemState: item("rare"), catalog, actionId: "currency:annulment" }).enabled, false);
  assert.equal(canRunSingleStep({ itemState: affixedItem(), catalog, actionId: "currency:annulment" }).enabled, true);
  for (const [field, special] of [["implicitModifiers", modifier("instance:implicit", "implicit", "implicit")], ["craftedModifiers", modifier("instance:crafted", "prefix", "crafted")], ["desecratedModifiers", modifier("instance:desecrated", "suffix", "desecrated")]]) {
    const specialOnly = affixedItem({ prefixModifiers: [], suffixModifiers: [], [field]: [special] });
    assert.equal(canRunSingleStep({ itemState: specialOnly, catalog, actionId: "currency:annulment" }).enabled, false, field);
  }
});

test("Annulment controller removes exactly one regular modifier without changing rarity", () => {
  const before = affixedItem(); const snapshot = JSON.stringify(before);
  const result = runSingleStep({ itemState: before, catalog, actionId: "currency:annulment", seed: 0 });
  assert.equal(result.status, "successful"); assert.equal(result.itemState.rarity, before.rarity); assert.equal(result.itemState.revision, 1);
  assert.equal(result.itemState.prefixModifiers.length + result.itemState.suffixModifiers.length, 1);
  assert.equal(result.simulationResult.removedModifier.instanceId, result.selectionResult.selectedInstanceId);
  assert.deepEqual(result.simulationResult.selectionResult, result.selectionResult);
  assert.equal(JSON.stringify(before), snapshot);
});

test("controlled Annulment seeds can remove a prefix and a suffix", () => {
  const before = affixedItem();
  const prefixSeed = Array.from({ length: 1000 }, (_, seed) => seed).find(seed => runSingleStep({ itemState: before, catalog, actionId: "currency:annulment", seed }).simulationResult?.removedModifier?.generationType === "prefix");
  const suffixSeed = Array.from({ length: 1000 }, (_, seed) => seed).find(seed => runSingleStep({ itemState: before, catalog, actionId: "currency:annulment", seed }).simulationResult?.removedModifier?.generationType === "suffix");
  assert.notEqual(prefixSeed, undefined); assert.notEqual(suffixSeed, undefined);
  assert.equal(runSingleStep({ itemState: before, catalog, actionId: "currency:annulment", seed: prefixSeed }).itemState.prefixModifiers.length, 0);
  assert.equal(runSingleStep({ itemState: before, catalog, actionId: "currency:annulment", seed: suffixSeed }).itemState.suffixModifiers.length, 0);
});

test("Annulment inapplicable and technical diagnostics are German", () => {
  const before = item("rare"); const snapshot = JSON.stringify(before);
  const engineResult = evaluateCraftingAction({ actionId: "currency:annulment", itemState: before, catalog, actionContext: {} });
  const result = runSingleStep({ itemState: before, catalog, actionId: "currency:annulment", seed: 0 });
  assert.equal(engineResult.status, "inapplicable");
  assert.equal(result.status, "inapplicable");
  assert.deepEqual(result.actionResult, engineResult);
  assert.equal(result.reasonCode, "ENGINE_ACTION_NO_REMOVABLE_MODIFIER");
  assert.match(result.message, /keinen entfernbaren regulären Präfix- oder Suffix-Modifikator/);
  assert.equal(result.itemState, before);
  assert.equal(result.itemState.revision, before.revision);
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(result.selectionResult, null);
  assert.equal(result.simulationResult, null);
  assert.equal(undoTargetFromResult(result), null);
  assert.match(diagnosticMessageDe({ code: "ENGINE_SIMULATOR_REQUEST_MISMATCH" }), /veraltet/);
  assert.match(diagnosticMessageDe({ code: "ENGINE_SIMULATOR_CANDIDATE_MISMATCH" }), /nicht mehr vorhanden/);
  assert.doesNotMatch(result.message, /Annulment|Orb|Modifier/);
});

test("special-only Annulment remains inapplicable without selection simulation or undo", () => {
  for (const [field, special] of [["implicitModifiers", modifier("instance:implicit-only", "implicit", "implicit")], ["craftedModifiers", modifier("instance:crafted-only", "prefix", "crafted")], ["desecratedModifiers", modifier("instance:desecrated-only", "suffix", "desecrated")]]) {
    const before = affixedItem({ prefixModifiers: [], suffixModifiers: [], [field]: [special] });
    const result = runSingleStep({ itemState: before, catalog, actionId: "currency:annulment", seed: 4294967295 });
    assert.equal(result.status, "inapplicable", field);
    assert.equal(result.reasonCode, "ENGINE_ACTION_NO_REMOVABLE_MODIFIER", field);
    assert.equal(result.itemState, before, field);
    assert.equal(result.itemState.revision, 0, field);
    assert.equal(result.selectionResult, null, field);
    assert.equal(result.simulationResult, null, field);
    assert.equal(undoTargetFromResult(result), null, field);
  }
});

class TestElement {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.className = "";
    this.hidden = false;
    this.value = "";
  }

  set textContent(value) {
    this.value = String(value);
    this.children = [];
  }

  get textContent() {
    return this.value + this.children.map(child => child.textContent).join("");
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.value = "";
    this.children = [...children];
  }
}

const testDocument = { createElement: tagName => new TestElement(tagName) };
const descendantTags = node => [node.tagName, ...node.children.flatMap(descendantTags)];

test("single-step result renders all dynamic values as text without injected elements", () => {
  const payloads = [
    "<img src=x onerror=globalThis.__catalogXss=1>",
    "<script>globalThis.__catalogXss=2</script>",
    "<svg onload=globalThis.__catalogXss=3></svg>",
    "\"><img src=x onerror=globalThis.__catalogXss=4>",
    "<>&\"'`"
  ];

  for (const payload of payloads) {
    const container = new TestElement("div");
    const itemState = item("magic");
    renderSingleStepResult({
      document: testDocument,
      container,
      currentItemState: itemState,
      actionLabel: payload,
      modifierDisplay: () => payload,
      result: {
        status: payload,
        message: payload,
        reasonCode: payload,
        itemState,
        previousItemState: itemState,
        selectionResult: {
          selectedCandidate: {
            modifierId: "mod:prefix",
            generationType: "prefix",
            displayTier: payload,
            applicableWeight: { spawn: payload }
          }
        }
      }
    });

    assert.match(container.textContent, new RegExp(payload.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(descendantTags(container).filter(tag => ["img", "script", "svg"].includes(tag)), []);
    assert.equal(globalThis.__catalogXss, undefined);
  }
});

test("Transmutation result renders catalog payloads as inert visible text", () => {
  const payloads = [
    "<img src=x onerror=globalThis.__transmutationXss=1>",
    "<script>globalThis.__transmutationXss=2</script>",
    "<svg onload=globalThis.__transmutationXss=3></svg>"
  ];
  for (const payload of payloads) {
    const container = new TestElement("div");
    const before = item("normal");
    const after = runSingleStep({ itemState: before, catalog, actionId: "currency:transmutation", seed: 0 }).itemState;
    renderSingleStepResult({
      document: testDocument,
      container,
      currentItemState: after,
      actionLabel: "Transmutation",
      modifierDisplay: () => payload,
      result: {
        status: "successful",
        message: "success",
        itemState: after,
        previousItemState: before,
        selectionResult: {
          selectedCandidate: {
            modifierId: "mod:prefix",
            generationType: "prefix",
            displayTier: 1,
            applicableWeight: { spawn: 100 }
          }
        }
      }
    });
    assert.match(container.textContent, /Transmutation/);
    assert.match(container.textContent, new RegExp(payload.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(descendantTags(container).filter(tag => ["img", "script", "svg"].includes(tag)), []);
    assert.equal(globalThis.__transmutationXss, undefined);
  }
});

test("Annulment result renders a German removal result without addition wording", () => {
  const container = new TestElement("div");
  const before = affixedItem();
  const result = runSingleStep({ itemState: before, catalog, actionId: "currency:annulment", seed: 0 });
  renderSingleStepResult({ document: testDocument, container, result, currentItemState: result.itemState, actionLabel: "Sphäre der Annullierung", modifierDisplay: id => id === "mod:prefix" ? "Erhöhter physischer Schaden" : "Erhöhte Angriffsgeschwindigkeit" });
  assert.match(container.textContent, /Sphäre der Annullierung/);
  assert.match(container.textContent, /Erfolgreich/);
  assert.match(container.textContent, /Entfernter (Präfix|Suffix) · T1/);
  assert.match(container.textContent, /Dieser reguläre Modifikator wurde entfernt/);
  assert.match(container.textContent, /SeltenheitSelten → Selten/);
  assert.doesNotMatch(container.textContent, /hinzugefügt|Orb of Annulment|Annulment Orb|\bAnnulment\b|Code:/);
});

test("Annulment UI uses only the German visible action name", async () => {
  const controllerSource = await readFile(new URL("../single-step-controller.mjs", import.meta.url), "utf8");
  const rendererSource = await readFile(new URL("../single-step-result-renderer.mjs", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../../../app.js", import.meta.url), "utf8");
  assert.match(controllerSource, /label: "Sphäre der Annullierung"/);
  assert.doesNotMatch(`${controllerSource}\n${rendererSource}\n${appSource}`, /Orb of Annulment|Annulment Orb/);
});

test("Annulment UI delegates removal and RNG selection to the browser engine", async () => {
  const controllerSource = await readFile(new URL("../single-step-controller.mjs", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../../../app.js", import.meta.url), "utf8");
  const runSource = controllerSource.match(/export function runSingleStep[\s\S]*?\n}/)?.[0] ?? "";
  const executeSource = appSource.match(/function executeSingleStep\(\)[\s\S]*?\n  }/)?.[0] ?? "";
  assert.match(runSource, /selectModifierForRemoval/);
  assert.equal((runSource.match(/simulateCraftingStep\s*\(/g) ?? []).length, 1);
  assert.doesNotMatch(`${runSource}\n${executeSource}`, /prefixModifiers\s*=|suffixModifiers\s*=|\.splice\(|\.filter\(/);
});

test("single-step controls and removal details retain the 390px responsive contract", async () => {
  const css = await readFile(new URL("../../../style.css", import.meta.url), "utf8");
  assert.match(css, /@media\(max-width:520px\)\{\.single-step-actions,.single-step-summary\{grid-template-columns:1fr\}\}/);
  assert.match(css, /\.single-step-mod\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere/);
  assert.match(css, /body\{[^}]*overflow-x:hidden/);
});
