import { canonicalTechnicalString } from "./canonical-serialization.mjs";
import { ENGINE_SIMULATOR_CODES } from "./errors.mjs";
import { immutableCopy } from "./immutability.mjs";
import { reviseItemState } from "./item-state.mjs";
import { validateItemState } from "./validation.mjs";

const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const issue = (code, message, path, details = {}) => ({ code, message, path, details });
const technicalEqual = (left, right) => {
  try { return canonicalTechnicalString(left) === canonicalTechnicalString(right); } catch { return false; }
};

function output(actionResult, itemState, status, entry = null, success = {}) {
  return immutableCopy({
    valid: status !== "error",
    status,
    actionId: typeof actionResult?.actionId === "string" ? actionResult.actionId : null,
    originalItemRevision: Number.isInteger(itemState?.revision) ? itemState.revision : null,
    resultingItemRevision: success.resultingItemState?.revision ?? null,
    resultingItemState: success.resultingItemState ?? null,
    appliedOperations: success.appliedOperations ?? [],
    consumedSelectionRequestIds: success.consumedSelectionRequestIds ?? [],
    reasons: entry ? [entry] : [],
    errors: status === "error" && entry ? [entry] : [],
    warnings: []
  });
}

function failure(actionResult, itemState, code, message, path, details = {}, status = "error") {
  return output(actionResult, itemState, status, issue(code, message, path, details));
}

function requestContext(request) {
  if (typeof request?.deterministicKey !== "string" || request.id !== `selection:${request.deterministicKey}`) return null;
  try {
    const payload = JSON.parse(request.deterministicKey);
    if (!isRecord(payload) || !isRecord(payload.item)) return null;
    const keyCandidates = Array.isArray(request.candidates) ? request.candidates.map(({ displayTier, ...candidate }) => candidate) : null;
    const fieldsMatch = payload.actionId === request.actionId && payload.type === request.type && payload.count === request.count
      && payload.candidateStatus === request.candidateStatus && payload.replacementPolicy === request.replacementPolicy
      && canonicalTechnicalString(payload.candidates) === canonicalTechnicalString(keyCandidates)
      && canonicalTechnicalString(payload.weighting) === canonicalTechnicalString(request.weighting)
      && canonicalTechnicalString(payload.constraints) === canonicalTechnicalString(request.constraints);
    return fieldsMatch ? payload : null;
  } catch {
    return null;
  }
}

function selectedModifier(candidate, itemState, actionId, requestId) {
  return {
    instanceId: `simulated:${itemState.itemId}:${itemState.revision + 1}:${actionId}:${candidate.modifierId}`,
    modId: candidate.modifierId,
    familyId: candidate.familyId ?? null,
    generationType: candidate.generationType,
    domain: candidate.domain ?? null,
    technicalTier: candidate.technicalTier ?? null,
    displayTier: candidate.displayTier ?? null,
    statIds: candidate.statIds ?? [],
    values: candidate.values ?? [],
    source: candidate.source ?? "normal",
    appliedAtRevision: itemState.revision + 1,
    metadata: { actionId, selectionRequestId: requestId }
  };
}

export function simulateCraftingStep(input = {}) {
  if (!isRecord(input)) return failure(null, null, ENGINE_SIMULATOR_CODES.INPUT_INVALID, "Simulator input must be an object.", "input");
  const { itemState, actionResult } = input;
  const selectionResults = input.selectionResults ?? [];
  if (!Array.isArray(selectionResults)) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.INPUT_INVALID, "selectionResults must be an array.", "selectionResults");
  try { validateItemState(itemState); } catch (error) {
    return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.ITEM_STATE_INVALID, "Item state is invalid.", "itemState", { causeCode: error?.code ?? null, causePath: error?.path ?? null });
  }
  if (!isRecord(actionResult)) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.INPUT_INVALID, "Action result must be an object.", "actionResult");
  if (actionResult.status === "error") return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.ACTION_NOT_EXECUTABLE, "Action result is not valid for execution.", "actionResult");
  if (actionResult.status === "inapplicable") return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.ACTION_NOT_EXECUTABLE, "Action result is inapplicable.", "actionResult.status", {}, "inapplicable");
  if (actionResult.status === "unresolved") return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.ACTION_NOT_EXECUTABLE, "Action result is unresolved.", "actionResult.status", {}, "unresolved");
  if (actionResult.valid !== true) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.ACTION_NOT_EXECUTABLE, "Action result is not valid for execution.", "actionResult");
  if (actionResult.status !== "applicable" || actionResult.summary?.applicable !== true) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.MUTATION_PLAN_INVALID, "Applicable action result contract is inconsistent.", "actionResult.status");
  if (!Array.isArray(actionResult.mutationPlan) || !Array.isArray(actionResult.selectionRequests)) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.MUTATION_PLAN_INVALID, "Action result requires mutationPlan and selectionRequests arrays.", "actionResult");

  const operations = actionResult.mutationPlan;
  if (!operations.length || operations.some((entry, index) => !isRecord(entry) || entry.sequence !== index || entry.applied !== false || typeof entry.operation !== "string")) {
    return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.MUTATION_PLAN_INVALID, "Mutation plan must be a contiguous unapplied operation list.", "actionResult.mutationPlan");
  }
  const supported = new Set(["set-rarity", "preserve-existing-modifiers", "add-selected-modifier"]);
  const unsupported = operations.find(entry => !supported.has(entry.operation));
  if (unsupported) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.OPERATION_UNSUPPORTED, "Mutation-plan operation is not supported by the single-step simulator.", `actionResult.mutationPlan[${unsupported.sequence}].operation`, { operation: unsupported.operation }, "unresolved");
  const rarityOperations = operations.filter(entry => entry.operation === "set-rarity");
  const additionOperations = operations.filter(entry => entry.operation === "add-selected-modifier");
  if (rarityOperations.length > 1 || additionOperations.length > 1) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.MUTATION_PLAN_INVALID, "Single-step simulator permits at most one rarity change and one modifier addition.", "actionResult.mutationPlan");
  if (operations.filter(entry => entry.operation === "preserve-existing-modifiers").length > 1) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.MUTATION_PLAN_INVALID, "Preserve operation is duplicated.", "actionResult.mutationPlan");
  if (rarityOperations.length && additionOperations.length && rarityOperations[0].sequence > additionOperations[0].sequence) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.MUTATION_PLAN_INVALID, "Rarity change must precede modifier addition in the explicit mutation plan.", "actionResult.mutationPlan");
  if (!rarityOperations.length && !additionOperations.length) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.ACTION_NOT_EXECUTABLE, "Mutation plan contains no executable state change.", "actionResult.mutationPlan", {}, "inapplicable");

  let request = null;
  let selection = null;
  let candidate = null;
  if (additionOperations.length) {
    const operation = additionOperations[0];
    const matchingRequests = actionResult.selectionRequests.filter(entry => entry?.id === operation.selectionRequestId);
    if (matchingRequests.length !== 1 || actionResult.selectionRequests.length !== 1) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.REQUEST_MISMATCH, "Addition operation must reference exactly one unique selection request.", `actionResult.mutationPlan[${operation.sequence}].selectionRequestId`);
    request = matchingRequests[0];
    if (request.type !== "modifier-addition" || request.executable !== true || request.count !== 1 || !Array.isArray(request.candidates) || !request.candidates.length) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.REQUEST_MISMATCH, "Referenced addition request is not executable with count 1.", "actionResult.selectionRequests[0]");
    const context = requestContext(request);
    if (!context) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.REQUEST_MISMATCH, "Selection request identity is invalid.", "actionResult.selectionRequests[0]");
    const expected = context.item;
    if (expected.itemId !== itemState.itemId || expected.revision !== itemState.revision || expected.baseTypeId !== itemState.baseTypeId || expected.itemClassId !== itemState.itemClassId || expected.rarity !== itemState.rarity || context.actionId !== actionResult.actionId) {
      return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.STATE_MISMATCH, "Action selection request does not belong to the supplied item state.", "actionResult.selectionRequests[0].deterministicKey");
    }
    if (selectionResults.length !== 1) return failure(actionResult, itemState, selectionResults.length ? ENGINE_SIMULATOR_CODES.SELECTION_INVALID : ENGINE_SIMULATOR_CODES.SELECTION_MISSING, "Exactly one matching selection result is required.", "selectionResults");
    selection = selectionResults[0];
    if (!isRecord(selection) || selection.valid !== true || selection.status !== "selected" || !isRecord(selection.selectedCandidate)) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.SELECTION_INVALID, "Selection result must be a valid selected result.", "selectionResults[0]");
    if (selection.requestId !== request.id || selection.deterministicKey !== request.deterministicKey) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.REQUEST_MISMATCH, "Selection result references a different request.", "selectionResults[0].requestId");
    if (!Number.isInteger(selection.selectedIndex) || selection.selectedIndex < 0 || selection.selectedIndex >= request.candidates.length) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.CANDIDATE_MISMATCH, "Selected candidate index is invalid.", "selectionResults[0].selectedIndex");
    candidate = request.candidates[selection.selectedIndex];
    if (selection.selectedCandidateId !== candidate.modifierId || !technicalEqual(selection.selectedCandidate, candidate)) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.CANDIDATE_MISMATCH, "Selected candidate does not byte-match the referenced request candidate.", "selectionResults[0].selectedCandidate");
    const existing = [...itemState.prefixModifiers, ...itemState.suffixModifiers, ...itemState.craftedModifiers, ...itemState.desecratedModifiers];
    if (existing.some(entry => entry.modId === candidate.modifierId)) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.DUPLICATE_MODIFIER, "Selected modifier already exists on the item.", "selectionResults[0].selectedCandidate.modifierId", { modifierId: candidate.modifierId });
    if (!["prefix", "suffix"].includes(candidate.generationType)) return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.CANDIDATE_MISMATCH, "Selected candidate has an unsupported generation type.", "selectionResults[0].selectedCandidate.generationType");
  } else if (actionResult.selectionRequests.length || selectionResults.length) {
    return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.SELECTION_INVALID, "Selection requests or results are not referenced by the mutation plan.", "selectionResults");
  }

  if (rarityOperations.length) {
    const rarity = rarityOperations[0].rarity;
    if (typeof rarity !== "string" || rarity === itemState.rarity || !actionResult.definition?.inputRarities?.includes(itemState.rarity) || actionResult.definition?.rarityTransition?.to !== rarity) {
      return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.STATE_MISMATCH, "Rarity operation does not match the action and input item.", `actionResult.mutationPlan[${rarityOperations[0].sequence}]`);
    }
  } else if (actionResult.definition?.rarityTransition) {
    return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.MUTATION_PLAN_INVALID, "Action rarity transition is missing from the mutation plan.", "actionResult.mutationPlan");
  }

  try {
    const changes = {};
    if (rarityOperations.length) changes.rarity = rarityOperations[0].rarity;
    if (candidate) {
      const listName = candidate.generationType === "prefix" ? "prefixModifiers" : "suffixModifiers";
      changes[listName] = [...itemState[listName], selectedModifier(candidate, itemState, actionResult.actionId, request.id)];
    }
    const resultingItemState = reviseItemState(itemState, changes);
    const appliedOperations = operations.map(entry => ({ sequence: entry.sequence, operation: entry.operation, selectionRequestId: entry.selectionRequestId ?? null, rarity: entry.rarity ?? null }));
    return output(actionResult, itemState, "simulated", null, { resultingItemState, appliedOperations, consumedSelectionRequestIds: request ? [request.id] : [] });
  } catch (error) {
    return failure(actionResult, itemState, ENGINE_SIMULATOR_CODES.INVARIANT, "Validated mutation plan could not produce a valid item state.", "resultingItemState", { causeCode: error?.code ?? null, causePath: error?.path ?? null });
  }
}
