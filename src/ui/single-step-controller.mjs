import {
  createItemState,
  createSeededRandom,
  evaluateCraftingAction,
  getDefaultCapacityRules,
  selectWeightedModifier,
  simulateCraftingStep
} from "../engine/browser.mjs";

export const SINGLE_STEP_ACTIONS = Object.freeze([
  Object.freeze({ id: "currency:augmentation", label: "Orb of Augmentation" }),
  Object.freeze({ id: "currency:regal", label: "Regal Orb" }),
  Object.freeze({ id: "currency:exalted", label: "Exalted Orb" })
]);

const actionIds = new Set(SINGLE_STEP_ACTIONS.map(action => action.id));

export function capacityRulesForRarity(rarity) {
  const defaults = getDefaultCapacityRules();
  if (rarity === "magic") return defaults.magic;
  if (rarity === "rare") return defaults.rare;
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

export function canRunSingleStep({ itemState, catalog, actionId, busy = false }) {
  if (busy) return Object.freeze({ enabled: false, reason: "Crafting-Schritt wird ausgeführt." });
  if (!itemState) return Object.freeze({ enabled: false, reason: "Wähle zuerst eine gültige Basis und ein Item-Level." });
  if (!catalog) return Object.freeze({ enabled: false, reason: "Der Modifier-Katalog ist noch nicht verfügbar." });
  if (!actionIds.has(actionId)) return Object.freeze({ enabled: false, reason: "Wähle eine unterstützte Crafting-Währung." });
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

export function runSingleStep({ itemState, catalog, actionId, seed = 0 }) {
  const readiness = canRunSingleStep({ itemState, catalog, actionId });
  if (!readiness.enabled) {
    return Object.freeze({ status: "error", message: readiness.reason, itemState, actionResult: null, selectionResult: null, simulationResult: null });
  }

  try {
    const capacityRules = capacityRulesForRarity(itemState.rarity);
    const actionContext = capacityRules ? { capacityRules } : {};
    const actionResult = evaluateCraftingAction({ actionId, itemState, catalog, actionContext });

    if (actionResult.status !== "applicable") {
      const diagnostic = firstDiagnostic(actionResult, actionResult.status);
      return Object.freeze({
        status: actionResult.status,
        message: diagnostic?.message ?? "Die Engine konnte diesen Schritt nicht ausführen.",
        reasonCode: diagnostic?.code ?? null,
        itemState,
        actionResult,
        selectionResult: null,
        simulationResult: null
      });
    }

    const request = actionResult.selectionRequests[0];
    const selectionResult = selectWeightedModifier(request, { rngState: createSeededRandom(seed) });
    if (selectionResult.status !== "selected") {
      const diagnostic = firstDiagnostic(selectionResult);
      return Object.freeze({
        status: selectionResult.status === "inapplicable" ? "inapplicable" : "error",
        message: diagnostic?.message ?? "Die gewichtete Auswahl ist fehlgeschlagen.",
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
        message: diagnostic?.message ?? "Die Simulation ist fehlgeschlagen.",
        reasonCode: diagnostic?.code ?? null,
        itemState,
        actionResult,
        selectionResult,
        simulationResult
      });
    }

    return Object.freeze({
      status: "successful",
      message: "Der Crafting-Schritt wurde erfolgreich simuliert.",
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
      message: error?.message ?? "Unbekannter Engine-Fehler.",
      reasonCode: error?.code ?? null,
      itemState,
      actionResult: null,
      selectionResult: null,
      simulationResult: null
    });
  }
}
