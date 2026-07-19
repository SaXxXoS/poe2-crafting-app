import { ENGINE_ACTION_CODES } from "./errors.mjs";
import { canonicalTechnicalString } from "./canonical-serialization.mjs";
import { validateModifierCatalog } from "./catalog-validation.mjs";
import { compareTechnicalStrings, resolveEligibleModifiers } from "./eligible-modifier-resolver.mjs";
import { immutableCopy } from "./immutability.mjs";
import { createModifierRemovalRequest } from "./modifier-removal.mjs";
import { createRuleContext } from "./rule-context.mjs";
import { validateItemState } from "./validation.mjs";

const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const compareNumbers = (left, right) => left === right ? 0 : left < right ? -1 : 1;
const compareFields = values => values.find(value => value !== 0) ?? 0;
const reason = (code, outcome, message, rule, path, details = {}) => ({ code, outcome, message, rule, path, details });
const compareReasons = (left, right) => compareFields([
  compareTechnicalStrings(left.rule ?? "", right.rule ?? ""),
  compareTechnicalStrings(left.code ?? "", right.code ?? ""),
  compareTechnicalStrings(left.outcome ?? "", right.outcome ?? ""),
  compareTechnicalStrings(left.path ?? "", right.path ?? ""),
  compareTechnicalStrings(canonicalTechnicalString(left.details), canonicalTechnicalString(right.details))
]);
const compareCandidates = (left, right) => compareFields([
  compareTechnicalStrings(left.generationType ?? "", right.generationType ?? ""),
  compareTechnicalStrings(left.modifierId ?? "", right.modifierId ?? ""),
  compareNumbers(left.technicalTier ?? -1, right.technicalTier ?? -1)
]);
const compareRequests = (left, right) => compareFields([
  compareTechnicalStrings(left.type, right.type), compareTechnicalStrings(left.id, right.id)
]);

const definition = input => immutableCopy(input);
const definitions = [
  definition({ id: "currency:annulment", category: "currency", technicalName: "annulment", inputRarities: ["normal", "magic", "rare"], rarityTransition: null, operationType: "remove-modifier", requiresCatalog: false, requiresEligibilityResolution: false, requiresRandomSelection: false, requiresRandomRemoval: true, selectionCount: 0, removalCount: 1, preservesExistingModifiers: true, notes: ["Only regular explicit prefix and suffix instances are removable."] }),
  definition({ id: "currency:alteration", category: "currency", technicalName: "alteration", inputRarities: ["magic"], rarityTransition: null, operationType: "reroll-modifiers", requiresCatalog: true, requiresEligibilityResolution: true, requiresRandomSelection: true, requiresRandomRemoval: true, selectionCount: null, removalCount: null, preservesExistingModifiers: false, notes: ["Replacement counts require explicit caller rules."] }),
  definition({ id: "currency:augmentation", category: "currency", technicalName: "augmentation", inputRarities: ["magic"], rarityTransition: null, operationType: "add-modifier", requiresCatalog: true, requiresEligibilityResolution: true, requiresRandomSelection: true, requiresRandomRemoval: false, selectionCount: 1, removalCount: 0, preservesExistingModifiers: true, notes: ["Capacity is never inferred."] }),
  definition({ id: "currency:chaos", category: "currency", technicalName: "chaos", inputRarities: ["rare"], rarityTransition: null, operationType: "reroll-modifiers", requiresCatalog: true, requiresEligibilityResolution: true, requiresRandomSelection: true, requiresRandomRemoval: true, selectionCount: null, removalCount: null, preservesExistingModifiers: false, notes: ["PoE2 replacement counts require explicit caller rules."] }),
  definition({ id: "currency:exalted", category: "currency", technicalName: "exalted", inputRarities: ["rare"], rarityTransition: null, operationType: "add-modifier", requiresCatalog: true, requiresEligibilityResolution: true, requiresRandomSelection: true, requiresRandomRemoval: false, selectionCount: 1, removalCount: 0, preservesExistingModifiers: true, notes: ["Capacity is never inferred."] }),
  definition({ id: "currency:regal", category: "currency", technicalName: "regal", inputRarities: ["magic"], rarityTransition: { from: "magic", to: "rare" }, operationType: "add-and-upgrade", requiresCatalog: true, requiresEligibilityResolution: true, requiresRandomSelection: true, requiresRandomRemoval: false, selectionCount: 1, removalCount: 0, preservesExistingModifiers: true, notes: ["Modifier selection is deferred."] }),
  definition({ id: "currency:transmutation", category: "currency", technicalName: "transmutation", inputRarities: ["normal"], rarityTransition: { from: "normal", to: "magic" }, operationType: "add-and-upgrade", requiresCatalog: true, requiresEligibilityResolution: true, requiresRandomSelection: true, requiresRandomRemoval: false, requiresEmptyModifiers: true, selectionCount: 1, removalCount: 0, preservesExistingModifiers: true, notes: ["Target Magic capacity must be supplied explicitly by the caller."] })
].sort((left, right) => compareTechnicalStrings(left.id, right.id));
const registry = new Map(definitions.map(entry => [entry.id, entry]));

export function listCraftingActionDefinitions() {
  return immutableCopy(definitions);
}

export function getCraftingActionDefinition(actionId) {
  return registry.get(actionId) ?? null;
}

function emptyResult(actionId, definitionValue, entry) {
  return immutableCopy({
    valid: false, actionId: typeof actionId === "string" ? actionId : null, status: "error", definition: definitionValue,
    contextSummary: null, reasons: [entry], errors: [entry], warnings: [], evaluatedRules: [], eligibilityResult: null,
    selectionRequests: [], mutationPlan: [], summary: { applicable: false, requiresRandomSelection: definitionValue?.requiresRandomSelection ?? false,
      requiresRandomRemoval: definitionValue?.requiresRandomRemoval ?? false, selectionRequestCount: 0, removalRequestCount: 0,
      wouldChangeRarity: false, wouldPreserveExistingModifiers: definitionValue?.preservesExistingModifiers ?? false,
      unresolvedRuleCount: 0, failedRuleCount: 0 }
  });
}

function validateActionContext(actionContext) {
  if (!isRecord(actionContext)) return "actionContext must be an object.";
  const allowed = new Set(["capacityRules", "selectionCountRules", "rarityRules", "removalRules"]);
  if (Object.keys(actionContext).some(key => !allowed.has(key))) return "actionContext contains an unknown rule field.";
  for (const field of allowed) if (actionContext[field] !== undefined && !isRecord(actionContext[field])) return `${field} must be an object.`;
  const capacity = actionContext.capacityRules;
  if (capacity && Object.entries(capacity).some(([key, value]) => !["prefix", "suffix"].includes(key) || !Number.isInteger(value) || value < 0)) return "capacityRules is invalid.";
  for (const field of ["selectionCountRules", "removalRules"]) if (actionContext[field] && Object.values(actionContext[field]).some(value => !Number.isInteger(value) || value < 0)) return `${field} is invalid.`;
  return null;
}

function additionRequest(action, itemState, catalog, count, candidates, eligibilityResult, capacityRules) {
  const compact = candidates.map(candidate => ({ modifierId: candidate.modifierId, generationType: candidate.generationType,
    technicalTier: candidate.technicalTier, displayTier: candidate.displayTier, source: candidate.source ?? null,
    familyId: candidate.catalogReferences?.familyId ?? null, itemLevelRequirement: candidate.itemLevelRequirement,
    rawSpawnWeights: catalog.modifiers[candidate.modifierId]?.spawnWeights ?? null,
    rawGenerationWeights: catalog.modifiers[candidate.modifierId]?.generationWeights ?? null,
    applicableWeight: candidate.applicableWeight })).sort(compareCandidates);
  const weighting = { mode: "raw-technical-weights", normalized: false };
  const replacementPolicy = "without-replacement";
  const constraints = { generationTypes: [...new Set(compact.map(entry => entry.generationType))].sort(compareTechnicalStrings) };
  const sourceResult = { mode: eligibilityResult.contextSummary.mode };
  const keyCandidates = compact.map(({ displayTier, ...candidate }) => candidate);
  const keyPayload = { keyVersion: 1, actionId: action.id, type: "modifier-addition", count,
    item: { itemId: itemState.itemId, revision: itemState.revision, itemClassId: itemState.itemClassId, baseTypeId: itemState.baseTypeId, rarity: itemState.rarity },
    candidateStatus: "eligible", candidates: keyCandidates, weighting, replacementPolicy, constraints,
    capacityRules: capacityRules ?? null };
  const deterministicKey = canonicalTechnicalString(keyPayload);
  return { id: `selection:${deterministicKey}`, type: "modifier-addition", actionId: action.id, executable: true, count, candidateStatus: "eligible",
    candidates: compact, weighting, replacementPolicy, constraints, sourceResult, deterministicKey };
}

function deferredRemovalRequest(action, itemState, count) {
  const candidates = [...itemState.prefixModifiers, ...itemState.suffixModifiers].map(instance => ({ instanceId: instance.instanceId,
    modifierId: instance.modId, familyId: instance.familyId, generationType: instance.generationType, domain: instance.domain,
    technicalTier: instance.technicalTier, statIds: instance.statIds, source: instance.source, appliedAtRevision: instance.appliedAtRevision })).sort((left, right) => compareFields([
      compareTechnicalStrings(left.modifierId, right.modifierId), compareTechnicalStrings(left.instanceId, right.instanceId)
    ]));
  const replacementPolicy = "without-replacement";
  const constraints = { regularModifiersOnly: true };
  const keyPayload = { keyVersion: 1, actionId: action.id, type: "modifier-removal", count,
    item: { itemId: itemState.itemId, revision: itemState.revision, itemClassId: itemState.itemClassId, baseTypeId: itemState.baseTypeId, rarity: itemState.rarity },
    candidateStatus: "existing", candidates, weighting: { mode: "none", normalized: false }, replacementPolicy, constraints, executable: false };
  const deterministicKey = canonicalTechnicalString(keyPayload);
  return { id: `selection:${deterministicKey}`, type: "modifier-removal", actionId: action.id, count, candidateStatus: "existing", executable: false,
    candidates, weighting: { mode: "none", normalized: false }, replacementPolicy, constraints,
    sourceResult: { prefixCount: itemState.prefixModifiers.length, suffixCount: itemState.suffixModifiers.length },
    deferredReason: "Replacement removal selection remains deferred.", deterministicKey };
}

export function evaluateCraftingAction({ actionId, itemState, catalog, ruleContext = null, actionContext = {}, options = {} } = {}) {
  const action = getCraftingActionDefinition(actionId);
  if (!action) return emptyResult(actionId, null, reason(ENGINE_ACTION_CODES.UNKNOWN, "error", "Unknown crafting action ID.", "action", "actionId", { actionId: actionId ?? null }));
  const contextIssue = validateActionContext(actionContext);
  if (contextIssue || !isRecord(options)) return emptyResult(actionId, action, reason(ENGINE_ACTION_CODES.CONTEXT_INVALID, "error", contextIssue ?? "options must be an object.", "context", contextIssue ? "actionContext" : "options", {}));
  if (action.requiresCatalog) {
    try {
      validateModifierCatalog(catalog);
    } catch (error) {
      return emptyResult(actionId, action, reason(ENGINE_ACTION_CODES.CATALOG_INVALID, "error", "Crafting action requires a structurally valid modifier catalog.", "catalog", error.path ?? "catalog", { catalogError: { code: error.code ?? null, message: error.message, path: error.path ?? "catalog", details: error.details ?? {} } }));
    }
  }
  let context;
  try {
    if (ruleContext) {
      context = ruleContext;
      if (context.itemState !== itemState || context.catalog !== catalog) throw new Error("Rule context does not reference the supplied item state and catalog.");
    } else if (action.requiresCatalog) {
      context = createRuleContext({ itemState, catalog, actionContext });
    } else {
      validateItemState(itemState);
      context = Object.freeze({ itemState, catalog: null, actionContext: immutableCopy(actionContext) });
    }
  } catch (error) {
    return emptyResult(actionId, action, reason(ENGINE_ACTION_CODES.CONTEXT_INVALID, "error", error.message, "context", error.path ?? "context", { code: error.code ?? null, details: error.details ?? {} }));
  }

  const reasons = [];
  const errors = [];
  const warnings = [];
  const replacementAction = action.operationType === "reroll-modifiers";
  const add = (...args) => reasons.push(reason(...args));
  if (action.inputRarities.includes(itemState.rarity)) add(ENGINE_ACTION_CODES.ITEM_RARITY_ALLOWED, "pass", "Item rarity is allowed for this action.", "rarity", "itemState.rarity", { rarity: itemState.rarity });
  else add(ENGINE_ACTION_CODES.ITEM_RARITY_NOT_ALLOWED, "fail", "Item rarity is not allowed for this action.", "rarity", "itemState.rarity", { rarity: itemState.rarity, allowed: action.inputRarities });
  if (action.requiresEmptyModifiers) {
    const prefixCount = itemState.prefixModifiers.length;
    const suffixCount = itemState.suffixModifiers.length;
    add(ENGINE_ACTION_CODES.EXISTING_MODIFIERS_NOT_ALLOWED, prefixCount + suffixCount === 0 ? "pass" : "fail",
      prefixCount + suffixCount === 0 ? "Action requires and received an item without existing modifiers." : "Action does not allow existing modifiers.",
      "existingModifiers", "itemState", { prefixCount, suffixCount });
  }
  if (action.operationType === "remove-modifier") {
    const prefixCount = itemState.prefixModifiers.length;
    const suffixCount = itemState.suffixModifiers.length;
    const removableCount = prefixCount + suffixCount;
    add(removableCount ? ENGINE_ACTION_CODES.REMOVABLE_MODIFIER_AVAILABLE : ENGINE_ACTION_CODES.NO_REMOVABLE_MODIFIER,
      removableCount ? "pass" : "fail",
      removableCount ? "At least one regular explicit modifier can be removed." : "Item has no removable regular explicit modifier.",
      "existingModifiers", "itemState", { prefixCount, suffixCount, removableCount });
  }
  if (action.rarityTransition) add(ENGINE_ACTION_CODES.RARITY_TRANSITION_AVAILABLE, "pass", "Rarity transition is defined by the action contract.", "rarityTransition", "definition.rarityTransition", action.rarityTransition);

  const explicitCount = action.selectionCount ?? actionContext.selectionCountRules?.[action.id] ?? null;
  if (action.requiresRandomSelection && (!Number.isInteger(explicitCount) || explicitCount < 1)) add(ENGINE_ACTION_CODES.SELECTION_COUNT_UNRESOLVED, "unresolved", "A reliable modifier selection count was not supplied.", "selectionCount", "actionContext.selectionCountRules", { actionId: action.id });
  else if (action.requiresRandomSelection) add(ENGINE_ACTION_CODES.SELECTION_REQUIRED, "pass", "Modifier selection is required and will be deferred.", "selectionCount", "definition.selectionCount", { count: explicitCount });

  const removalCount = action.removalCount ?? actionContext.removalRules?.[action.id] ?? null;
  if (action.requiresRandomRemoval && (!Number.isInteger(removalCount) || removalCount < 0)) add(ENGINE_ACTION_CODES.REMOVAL_RULE_UNRESOLVED, "unresolved", "A reliable removal rule was not supplied.", "removal", "actionContext.removalRules", { actionId: action.id });
  else if (action.requiresRandomRemoval) add(ENGINE_ACTION_CODES.RANDOM_REMOVAL_REQUIRED, "pass",
    action.operationType === "remove-modifier" ? "Exactly one regular explicit modifier will be selected for removal." : "Random removal is required and will be deferred.",
    "removal", action.removalCount !== null ? "definition.removalCount" : "actionContext.removalRules", { count: removalCount });

  let eligibilityResult = null;
  if (replacementAction) {
    add(ENGINE_ACTION_CODES.ELIGIBILITY_UNRESOLVED, "unresolved", "Replacement addition eligibility is deferred until a safe post-removal projection exists.", "eligibility", "mutationPlan.replace-random-modifiers", { evaluationState: "post-removal-not-available" });
  } else if (action.requiresEligibilityResolution) {
    eligibilityResult = resolveEligibleModifiers({ itemState, catalog, ruleContext: context, actionContext,
      options: { ...options, capacityRules: actionContext.capacityRules ?? options.capacityRules } });
    if (!eligibilityResult.valid) {
      const entry = reason(ENGINE_ACTION_CODES.CATALOG_INVALID, "error", "Eligibility resolution reported catalog or context errors.", "eligibility", "eligibilityResult.errors", { errors: eligibilityResult.errors });
      reasons.push(entry); errors.push(entry);
    } else if (eligibilityResult.eligible.length) add(ENGINE_ACTION_CODES.ELIGIBILITY_AVAILABLE, "pass", "Eligible regular modifiers are available.", "eligibility", "eligibilityResult.eligible", { count: eligibilityResult.eligible.length });
    else if (eligibilityResult.unresolved.length) add(ENGINE_ACTION_CODES.ELIGIBILITY_UNRESOLVED, "unresolved", "Modifier eligibility cannot be resolved safely.", "eligibility", "eligibilityResult.unresolved", { count: eligibilityResult.unresolved.length });
    else add(ENGINE_ACTION_CODES.NO_ELIGIBLE_MODIFIER, "fail", "No eligible regular modifier is available.", "eligibility", "eligibilityResult.eligible", { count: 0 });
  }

  add(ENGINE_ACTION_CODES.MUTATION_DEFERRED, "pass", "All item changes remain a non-executed mutation plan.", "mutation", "mutationPlan", {});
  reasons.sort(compareReasons); errors.sort(compareReasons); warnings.sort(compareReasons);
  const status = errors.length ? "error" : reasons.some(entry => entry.outcome === "fail") ? "inapplicable"
    : reasons.some(entry => entry.outcome === "unresolved") ? "unresolved" : "applicable";
  const selectionRequests = [];
  try {
    if (status === "applicable" && action.requiresRandomSelection) selectionRequests.push(additionRequest(action, itemState, catalog, explicitCount, eligibilityResult.eligible, eligibilityResult, actionContext.capacityRules ?? options.capacityRules ?? null));
    if (status === "applicable" && action.operationType === "remove-modifier") selectionRequests.push(createModifierRemovalRequest({ actionId: action.id, itemState }));
    else if ((status === "applicable" || status === "unresolved") && action.requiresRandomRemoval && Number.isInteger(removalCount) && removalCount >= 0
      && action.inputRarities.includes(itemState.rarity)) selectionRequests.push(deferredRemovalRequest(action, itemState, removalCount));
  } catch (error) {
    return emptyResult(actionId, action, reason(error.code ?? ENGINE_ACTION_CODES.CONTEXT_INVALID, "error", error.message, "request", error.path ?? "request", error.details ?? {}));
  }
  selectionRequests.sort(compareRequests);
  const mutationPlan = [];
  if (action.rarityTransition) mutationPlan.push({ sequence: mutationPlan.length, operation: "set-rarity", rarity: action.rarityTransition.to, applied: false });
  if (action.preservesExistingModifiers) mutationPlan.push({ sequence: mutationPlan.length, operation: "preserve-existing-modifiers", applied: false });
  if (action.requiresRandomRemoval) mutationPlan.push({ sequence: mutationPlan.length,
    operation: action.operationType === "remove-modifier" ? "remove-selected-modifier" : "clear-random-modifiers",
    selectionRequestId: selectionRequests.find(entry => entry.type === "modifier-removal")?.id ?? null, applied: false });
  if (action.requiresRandomSelection) mutationPlan.push({ sequence: mutationPlan.length, operation: action.operationType === "reroll-modifiers" ? "replace-random-modifiers" : "add-selected-modifier", selectionRequestId: selectionRequests.find(entry => entry.type === "modifier-addition")?.id ?? null, applied: false });
  return immutableCopy({ valid: errors.length === 0, actionId, status, definition: action,
    contextSummary: { itemId: itemState.itemId, revision: itemState.revision, itemClassId: itemState.itemClassId, baseTypeId: itemState.baseTypeId, itemLevel: itemState.itemLevel, rarity: itemState.rarity },
    reasons, errors, warnings, evaluatedRules: ["action", "context", "eligibility", "existingModifiers", "mutation", "rarity", "removal", "selectionCount"], eligibilityResult,
    selectionRequests, mutationPlan, summary: { applicable: status === "applicable", requiresRandomSelection: action.requiresRandomSelection,
      requiresRandomRemoval: action.requiresRandomRemoval, selectionRequestCount: selectionRequests.filter(entry => entry.type === "modifier-addition").length,
      removalRequestCount: selectionRequests.filter(entry => entry.type === "modifier-removal").length, wouldChangeRarity: Boolean(action.rarityTransition),
      wouldPreserveExistingModifiers: action.preservesExistingModifiers, unresolvedRuleCount: reasons.filter(entry => entry.outcome === "unresolved").length,
      failedRuleCount: reasons.filter(entry => entry.outcome === "fail").length }
  });
}
