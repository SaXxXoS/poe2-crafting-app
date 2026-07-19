import {
  createItemState,
  createSeededRandom,
  CURRENT_MAX_ITEM_LEVEL,
  evaluateCraftingAction,
  getDefaultCapacityRules,
  selectModifierForRemoval,
  selectWeightedModifier,
  simulateCraftingStep
} from "../engine/browser.mjs";

export const SINGLE_STEP_ACTIONS = Object.freeze([
  Object.freeze({ id: "currency:transmutation", label: "Transmutation" }),
  Object.freeze({ id: "currency:augmentation", label: "Orb of Augmentation" }),
  Object.freeze({ id: "currency:regal", label: "Regal Orb" }),
  Object.freeze({ id: "currency:exalted", label: "Exalted Orb" }),
  Object.freeze({ id: "currency:annulment", label: "Sphäre der Annullierung" })
]);

const actionIds = new Set(SINGLE_STEP_ACTIONS.map(action => action.id));

export function validateItemLevel(rawValue) {
  const text = String(rawValue ?? "").trim();
  const value = text === "" ? Number.NaN : Number(text);
  const valid = Number.isInteger(value) && value >= 1 && value <= CURRENT_MAX_ITEM_LEVEL;
  return Object.freeze({
    valid,
    value: valid ? value : null,
    reason: valid ? null : `Item-Level muss eine ganze Zahl zwischen 1 und ${CURRENT_MAX_ITEM_LEVEL} sein.`
  });
}

export function optionalAffixGroupsFile(indexDocument) {
  const value = indexDocument?.affixGroupsFile;
  return typeof value === "string" && value.trim() ? value : null;
}

export function capacityRulesForRarity(rarity) {
  const defaults = getDefaultCapacityRules();
  if (rarity === "magic") return defaults.magic;
  if (rarity === "rare") return defaults.rare;
  return undefined;
}

export function capacityRulesForAction(actionId) {
  const defaults = getDefaultCapacityRules();
  if (actionId === "currency:transmutation" || actionId === "currency:augmentation") return defaults.magic;
  if (actionId === "currency:regal" || actionId === "currency:exalted") return defaults.rare;
  return undefined;
}

export function createSingleStepItem({ baseTypeId, itemClassId, itemLevel, rarity }) {
  return createItemState({
    itemId: `ui-single-step:${baseTypeId}`,
    baseTypeId,
    itemClassId,
    itemLevel,
    rarity
  });
}

export function canRunSingleStep({ itemState, catalog, actionId, busy = false, itemLevelValidation = null }) {
  if (busy) return Object.freeze({ enabled: false, reason: "Crafting-Schritt wird ausgeführt." });
  if (itemLevelValidation && !itemLevelValidation.valid) return Object.freeze({ enabled: false, reason: itemLevelValidation.reason });
  if (!itemState) return Object.freeze({ enabled: false, reason: "Wähle zuerst eine gültige Basis und ein Item-Level." });
  if (!actionIds.has(actionId)) return Object.freeze({ enabled: false, reason: "Wähle eine unterstützte Crafting-Währung." });
  if (!catalog && actionId !== "currency:annulment") return Object.freeze({ enabled: false, reason: "Der Modifier-Katalog ist noch nicht verfügbar." });
  if (actionId === "currency:annulment") {
    const actionResult = evaluateCraftingAction({ actionId, itemState, catalog, actionContext: {} });
    if (actionResult.status !== "applicable") return Object.freeze({ enabled: false, reason: diagnosticMessageDe(firstDiagnostic(actionResult, actionResult.status), actionResult.status), actionResult });
    return Object.freeze({ enabled: true, reason: "Bereit für genau einen Crafting-Schritt.", actionResult });
  }
  return Object.freeze({ enabled: true, reason: "Bereit für genau einen Crafting-Schritt." });
}

function firstDiagnostic(result, status = result?.status) {
  const diagnostics = [...(result?.errors ?? []), ...(result?.reasons ?? [])];
  const expectedOutcome = status === "inapplicable" ? "fail" : status === "unresolved" ? "unresolved" : "error";
  return diagnostics.find(entry => entry?.outcome === expectedOutcome)
    ?? diagnostics.find(entry => entry?.outcome !== "pass")
    ?? result?.reasons?.[0]
    ?? null;
}

const DIAGNOSTIC_MESSAGES_DE = Object.freeze({
  ENGINE_ACTION_NO_REMOVABLE_MODIFIER: "Dieser Gegenstand besitzt keinen entfernbaren regulären Präfix- oder Suffix-Modifikator.",
  ENGINE_ACTION_ITEM_RARITY_NOT_ALLOWED: "Diese Crafting-Währung ist für die aktuelle Seltenheit nicht anwendbar.",
  ENGINE_SIMULATOR_REQUEST_MISMATCH: "Der Crafting-Zustand ist veraltet. Bitte führe den Schritt mit dem aktuellen Gegenstand erneut aus.",
  ENGINE_SIMULATOR_STATE_MISMATCH: "Der Gegenstand hat sich seit der Auswahl verändert. Bitte starte den Crafting-Schritt erneut.",
  ENGINE_SIMULATOR_CANDIDATE_MISMATCH: "Der ausgewählte Modifikator ist auf dem aktuellen Gegenstand nicht mehr vorhanden.",
  ENGINE_SIMULATOR_SELECTION_INVALID: "Die Modifikatorauswahl ist ungültig. Der Gegenstand wurde nicht verändert.",
  ENGINE_SIMULATOR_SELECTION_MISSING: "Es konnte kein Modifikator für diesen Crafting-Schritt ausgewählt werden.",
  ENGINE_SIMULATOR_ITEM_STATE_INVALID: "Der aktuelle Gegenstandszustand ist ungültig.",
  ENGINE_ACTION_CONTEXT_INVALID: "Der aktuelle Gegenstandszustand konnte nicht geprüft werden."
});

export function diagnosticMessageDe(diagnostic, status = "error") {
  if (diagnostic?.code && DIAGNOSTIC_MESSAGES_DE[diagnostic.code]) return DIAGNOSTIC_MESSAGES_DE[diagnostic.code];
  if (status === "inapplicable") return "Diese Crafting-Währung ist für den aktuellen Gegenstand nicht anwendbar.";
  if (status === "unresolved") return "Dieser Crafting-Schritt kann mit den verfügbaren Daten nicht sicher ausgeführt werden.";
  return "Ein technischer Engine-Fehler ist aufgetreten. Der Gegenstand wurde nicht verändert.";
}

export function runSingleStep({ itemState, catalog, actionId, seed = 0, itemLevelValidation = null }) {
  const readiness = canRunSingleStep({ itemState, catalog, actionId, itemLevelValidation });
  if (!readiness.enabled) {
    if (readiness.actionResult) {
      const diagnostic = firstDiagnostic(readiness.actionResult, readiness.actionResult.status);
      return Object.freeze({
        status: readiness.actionResult.status,
        message: readiness.reason,
        reasonCode: diagnostic?.code ?? null,
        itemState,
        actionResult: readiness.actionResult,
        selectionResult: null,
        simulationResult: null
      });
    }
    return Object.freeze({ status: "error", message: readiness.reason, itemState, actionResult: null, selectionResult: null, simulationResult: null });
  }

  try {
    const capacityRules = capacityRulesForAction(actionId);
    const actionContext = capacityRules ? { capacityRules } : {};
    const actionResult = readiness.actionResult ?? evaluateCraftingAction({ actionId, itemState, catalog, actionContext });

    if (actionResult.status !== "applicable") {
      const diagnostic = firstDiagnostic(actionResult, actionResult.status);
      return Object.freeze({
        status: actionResult.status,
        message: diagnosticMessageDe(diagnostic, actionResult.status),
        reasonCode: diagnostic?.code ?? null,
        itemState,
        actionResult,
        selectionResult: null,
        simulationResult: null
      });
    }

    const request = actionResult.selectionRequests[0];
    const selectionResult = request.type === "modifier-removal"
      ? selectModifierForRemoval(request, { rngState: createSeededRandom(seed) })
      : selectWeightedModifier(request, { rngState: createSeededRandom(seed) });
    if (selectionResult.status !== "selected") {
      const diagnostic = firstDiagnostic(selectionResult);
      return Object.freeze({
        status: selectionResult.status === "inapplicable" ? "inapplicable" : "error",
        message: diagnosticMessageDe(diagnostic, selectionResult.status),
        reasonCode: diagnostic?.code ?? null,
        itemState,
        actionResult,
        selectionResult,
        simulationResult: null
      });
    }

    const simulationResult = simulateCraftingStep({ itemState, actionResult, selectionResults: [selectionResult] });
    if (simulationResult.status !== "simulated") {
      const diagnostic = firstDiagnostic(simulationResult);
      return Object.freeze({
        status: simulationResult.status,
        message: diagnosticMessageDe(diagnostic, simulationResult.status),
        reasonCode: diagnostic?.code ?? null,
        itemState,
        actionResult,
        selectionResult,
        simulationResult
      });
    }

    return Object.freeze({
      status: "successful",
      message: actionId === "currency:annulment"
        ? "Die Sphäre der Annullierung wurde erfolgreich angewendet."
        : "Der Crafting-Schritt wurde erfolgreich simuliert.",
      reasonCode: null,
      itemState: simulationResult.resultingItemState,
      previousItemState: itemState,
      actionResult,
      selectionResult,
      simulationResult
    });
  } catch (error) {
    return Object.freeze({
      status: "error",
      message: diagnosticMessageDe({ code: error?.code ?? null }, "error"),
      reasonCode: error?.code ?? null,
      itemState,
      actionResult: null,
      selectionResult: null,
      simulationResult: null
    });
  }
}
