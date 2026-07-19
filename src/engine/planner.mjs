import { canonicalTechnicalString } from "./canonical-serialization.mjs";
import { evaluateCraftingAction } from "./crafting-actions.mjs";
import { ENGINE_PLANNER_CODES } from "./errors.mjs";
import { immutableCopy } from "./immutability.mjs";
import { classifyPlannerSimulatorResult } from "./planner-status.mjs";
import { simulateCraftingStep } from "./single-step-simulator.mjs";
import { validateItemState } from "./validation.mjs";
import { enumerateWeightedCandidates } from "./weighted-selection.mjs";

export const PLANNER_LIMITS = Object.freeze({ maxDepth: 8, maxPaths: 1000 });
export const PLANNER_SUPPORTED_ACTIONS = Object.freeze(["currency:augmentation", "currency:regal", "currency:exalted"]);

const actionOrder = new Map(PLANNER_SUPPORTED_ACTIONS.map((id, index) => [id, index]));
const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const issue = (code, message, path, details = {}) => ({ code, message, path, details });
const compareText = (left, right) => left === right ? 0 : left < right ? -1 : 1;
const compareNumber = (left, right) => left === right ? 0 : left < right ? -1 : 1;
const compareTransitions = (left, right) => compareNumber(right.stepProbability, left.stepProbability)
  || compareNumber(actionOrder.get(left.actionId), actionOrder.get(right.actionId))
  || compareText(left.candidate.modifierId, right.candidate.modifierId)
  || compareNumber(left.candidateIndex, right.candidateIndex);
const compareStepSequences = (left, right) => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const compared = compareNumber(actionOrder.get(left[index].action), actionOrder.get(right[index].action))
      || compareText(left[index].selectedModifierId, right[index].selectedModifierId);
    if (compared) return compared;
  }
  return compareNumber(left.length, right.length);
};
const comparePaths = (left, right) => Number(right.targetReached) - Number(left.targetReached)
  || compareNumber(left.depth, right.depth)
  || compareNumber(right.cumulativeProbability, left.cumulativeProbability)
  || compareStepSequences(left.steps, right.steps);

function result(status, code, message, initialItemState, values = {}, entry = null) {
  return immutableCopy({
    valid: status !== "error", status, code, message, initialItemState: initialItemState ?? null,
    targetReached: values.targetReached ?? false, paths: values.paths ?? [], exploredNodeCount: values.exploredNodeCount ?? 0,
    generatedTransitionCount: values.generatedTransitionCount ?? 0, truncated: values.truncated ?? false,
    diagnostics: values.diagnostics ?? [], errors: status === "error" && entry ? [entry] : [], warnings: []
  });
}

function stateKey(state) {
  const modifier = entry => ({ modId: entry.modId, familyId: entry.familyId, generationType: entry.generationType,
    domain: entry.domain, technicalTier: entry.technicalTier, displayTier: entry.displayTier, statIds: entry.statIds,
    values: entry.values, source: entry.source });
  const sorted = values => values.map(modifier).sort((left, right) => compareText(canonicalTechnicalString(left), canonicalTechnicalString(right)));
  return canonicalTechnicalString({ schemaVersion: state.schemaVersion, baseTypeId: state.baseTypeId, itemClassId: state.itemClassId,
    itemLevel: state.itemLevel, rarity: state.rarity, quality: state.quality, sockets: state.sockets,
    prefixModifiers: sorted(state.prefixModifiers), suffixModifiers: sorted(state.suffixModifiers),
    implicitModifiers: sorted(state.implicitModifiers), craftedModifiers: sorted(state.craftedModifiers),
    desecratedModifiers: sorted(state.desecratedModifiers), metadata: state.metadata });
}

function selectionResult(request, enumeration) {
  return immutableCopy({ valid: true, status: "selected", requestId: request.id, deterministicKey: request.deterministicKey,
    selectedCandidate: enumeration.candidate, selectedCandidateId: enumeration.candidate.modifierId,
    selectedIndex: enumeration.index, randomValue: null, targetWeight: null, totalWeight: enumeration.totalWeight,
    rngState: null, nextRngState: null, reasons: [], errors: [], warnings: [] });
}

function target(targetPredicate, itemState) {
  try {
    const value = targetPredicate(itemState);
    if (typeof value !== "boolean") throw new TypeError("targetPredicate must return a boolean.");
    return { value };
  } catch (error) {
    return { error: issue(ENGINE_PLANNER_CODES.TARGET_PREDICATE_ERROR, "Target predicate could not evaluate an item state.", "targetPredicate", { name: error?.name ?? null, message: error?.message ?? null }) };
  }
}

/**
 * Deterministically enumerates bounded multi-step paths using existing action evaluation and single-step simulation.
 */
export function planCraftingPaths(options = {}) {
  if (!isRecord(options)) return result("error", ENGINE_PLANNER_CODES.INPUT_INVALID, "Planner options must be an object.", null, {}, issue(ENGINE_PLANNER_CODES.INPUT_INVALID, "Planner options must be an object.", "options"));
  const { initialItemState, catalog, allowedActions, maxDepth, maxPaths, targetPredicate } = options;
  try { validateItemState(initialItemState); } catch (error) {
    const entry = issue(ENGINE_PLANNER_CODES.ITEM_STATE_INVALID, "Initial item state is invalid.", "initialItemState", { causeCode: error?.code ?? null, causePath: error?.path ?? null });
    return result("error", entry.code, entry.message, null, {}, entry);
  }
  if (!Array.isArray(allowedActions) || !allowedActions.length) {
    const entry = issue(ENGINE_PLANNER_CODES.INPUT_INVALID, "allowedActions must be a non-empty array.", "allowedActions");
    return result("error", entry.code, entry.message, initialItemState, {}, entry);
  }
  const unsupported = allowedActions.find(action => !PLANNER_SUPPORTED_ACTIONS.includes(action));
  if (unsupported || new Set(allowedActions).size !== allowedActions.length) {
    const entry = issue(unsupported ? ENGINE_PLANNER_CODES.ACTION_UNSUPPORTED : ENGINE_PLANNER_CODES.INPUT_INVALID,
      unsupported ? "Planner action is not supported." : "allowedActions must not contain duplicates.", "allowedActions", { actionId: unsupported ?? null });
    return result("error", entry.code, entry.message, initialItemState, {}, entry);
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > PLANNER_LIMITS.maxDepth) {
    const entry = issue(ENGINE_PLANNER_CODES.INPUT_INVALID, "maxDepth is outside the supported safety range.", "maxDepth", { maximum: PLANNER_LIMITS.maxDepth });
    return result("error", entry.code, entry.message, initialItemState, {}, entry);
  }
  if (!Number.isInteger(maxPaths) || maxPaths < 1 || maxPaths > PLANNER_LIMITS.maxPaths) {
    const entry = issue(ENGINE_PLANNER_CODES.INPUT_INVALID, "maxPaths is outside the supported safety range.", "maxPaths", { maximum: PLANNER_LIMITS.maxPaths });
    return result("error", entry.code, entry.message, initialItemState, {}, entry);
  }
  if (typeof targetPredicate !== "function") {
    const entry = issue(ENGINE_PLANNER_CODES.INPUT_INVALID, "targetPredicate must be a function.", "targetPredicate");
    return result("error", entry.code, entry.message, initialItemState, {}, entry);
  }
  const actionContext = options.actionContext ?? {};
  const actionContexts = options.actionContexts ?? {};
  if (!isRecord(actionContext) || !isRecord(actionContexts)) {
    const entry = issue(ENGINE_PLANNER_CODES.INPUT_INVALID, "Action contexts must be objects.", "actionContext");
    return result("error", entry.code, entry.message, initialItemState, {}, entry);
  }
  const orderedActions = PLANNER_SUPPORTED_ACTIONS.filter(action => allowedActions.includes(action));
  const initialTarget = target(targetPredicate, initialItemState);
  if (initialTarget.error) return result("error", initialTarget.error.code, initialTarget.error.message, initialItemState, {}, initialTarget.error);
  const initialPath = { targetReached: initialTarget.value, depth: 0, cumulativeProbability: 1, initialItemState, resultingItemState: initialItemState, steps: [] };
  if (initialTarget.value) return result("target-reached", ENGINE_PLANNER_CODES.TARGET_REACHED, "Initial item state satisfies the target.", initialItemState,
    { targetReached: true, paths: [initialPath], exploredNodeCount: 1, generatedTransitionCount: 0, truncated: false, diagnostics: [] });

  const queue = [initialPath];
  const paths = [];
  const diagnostics = [];
  const visited = new Map([[stateKey(initialItemState), { depth: 0, probability: 1 }]]);
  let exploredNodeCount = 0;
  let generatedTransitionCount = 0;
  let truncated = false;
  let sawUnresolved = false;

  while (queue.length) {
    const path = queue.shift();
    exploredNodeCount += 1;
    const transitions = [];
    for (const actionId of orderedActions) {
      const specific = actionContexts[actionId] ?? actionContext;
      const actionResult = evaluateCraftingAction({ actionId, itemState: path.resultingItemState, catalog, actionContext: specific });
      if (actionResult.status === "error") {
        const entry = issue(ENGINE_PLANNER_CODES.ACTION_ERROR, "Crafting action evaluation failed.", "actionResult", { actionId, errors: actionResult.errors });
        return result("error", entry.code, entry.message, initialItemState, {}, entry);
      }
      if (actionResult.status === "inapplicable") { diagnostics.push({ depth: path.depth, actionId, status: "inapplicable", code: actionResult.reasons[0]?.code ?? null }); continue; }
      if (actionResult.status === "unresolved") { sawUnresolved = true; diagnostics.push({ depth: path.depth, actionId, status: "unresolved", code: actionResult.reasons.find(entry => entry.outcome === "unresolved")?.code ?? null }); continue; }
      const request = actionResult.selectionRequests[0];
      const enumeration = enumerateWeightedCandidates(request);
      if (enumeration.status === "error") {
        const entry = issue(ENGINE_PLANNER_CODES.WEIGHT_ENUMERATION_ERROR, "Weighted candidate enumeration failed.", "selectionRequest", { actionId, errors: enumeration.errors });
        return result("error", entry.code, entry.message, initialItemState, {}, entry);
      }
      if (enumeration.status !== "enumerated") { diagnostics.push({ depth: path.depth, actionId, status: enumeration.status, code: enumeration.reasons[0]?.code ?? null }); continue; }
      for (const entry of enumeration.candidates) transitions.push({ actionId, actionResult, request, candidate: entry.candidate,
        candidateIndex: entry.index, candidateWeight: entry.weight, totalWeight: enumeration.totalWeight, stepProbability: entry.probability });
    }
    transitions.sort(compareTransitions);
    if (path.depth >= maxDepth) {
      if (transitions.length) truncated = true;
      continue;
    }
    for (const transition of transitions) {
      const simulation = simulateCraftingStep({ itemState: path.resultingItemState, actionResult: transition.actionResult,
        selectionResults: [selectionResult(transition.request, { candidate: transition.candidate, index: transition.candidateIndex, totalWeight: transition.totalWeight })] });
      const simulationStatus = classifyPlannerSimulatorResult(simulation);
      if (simulationStatus === "error") {
        const entry = issue(ENGINE_PLANNER_CODES.SIMULATOR_ERROR, "Single-step simulation failed.", "simulatorResult", { actionId: transition.actionId, errors: simulation.errors });
        return result("error", entry.code, entry.message, initialItemState, {}, entry);
      }
      if (simulationStatus === "inapplicable" || simulationStatus === "unresolved") {
        sawUnresolved ||= simulationStatus === "unresolved";
        diagnostics.push({ depth: path.depth, actionId: transition.actionId, status: simulationStatus, code: simulation.reasons[0]?.code ?? null });
        continue;
      }
      const cumulativeProbability = path.cumulativeProbability * transition.stepProbability;
      const targetResult = target(targetPredicate, simulation.resultingItemState);
      if (targetResult.error) return result("error", targetResult.error.code, targetResult.error.message, initialItemState, {}, targetResult.error);
      const step = { index: path.steps.length, action: transition.actionId, selectedModifierId: transition.candidate.modifierId,
        selectedModifier: transition.candidate, candidateWeight: transition.candidateWeight, totalWeight: transition.totalWeight,
        stepProbability: transition.stepProbability, cumulativeProbability, itemStateBefore: path.resultingItemState,
        itemStateAfter: simulation.resultingItemState, simulatorResult: { status: simulation.status, actionId: simulation.actionId,
          originalItemRevision: simulation.originalItemRevision, resultingItemRevision: simulation.resultingItemRevision,
          appliedOperations: simulation.appliedOperations, consumedSelectionRequestIds: simulation.consumedSelectionRequestIds } };
      const nextPath = { targetReached: targetResult.value, depth: path.depth + 1, cumulativeProbability, initialItemState,
        resultingItemState: simulation.resultingItemState, steps: [...path.steps, step] };
      generatedTransitionCount += 1;
      paths.push(nextPath);
      const key = stateKey(simulation.resultingItemState);
      const previous = visited.get(key);
      if (!targetResult.value && (!previous || nextPath.depth < previous.depth
        || nextPath.depth === previous.depth && nextPath.cumulativeProbability > previous.probability)) {
        visited.set(key, { depth: nextPath.depth, probability: nextPath.cumulativeProbability });
        queue.push(nextPath);
      }
    }
    queue.sort(comparePaths);
  }
  paths.sort(comparePaths);
  if (paths.length > maxPaths) truncated = true;
  const returnedPaths = paths.slice(0, maxPaths);
  const targetReached = returnedPaths.some(path => path.targetReached);
  if (targetReached) return result("target-reached", ENGINE_PLANNER_CODES.TARGET_REACHED, "At least one target path was found.", initialItemState,
    { targetReached, paths: returnedPaths, exploredNodeCount, generatedTransitionCount, truncated, diagnostics });
  if (truncated) return result("truncated", ENGINE_PLANNER_CODES.TRUNCATED, "Planner search reached a configured boundary.", initialItemState,
    { paths: returnedPaths, exploredNodeCount, generatedTransitionCount, truncated, diagnostics });
  if (!returnedPaths.length && sawUnresolved) return result("unresolved", ENGINE_PLANNER_CODES.UNRESOLVED, "No path could be resolved with the supplied context.", initialItemState,
    { paths: returnedPaths, exploredNodeCount, generatedTransitionCount, truncated, diagnostics });
  if (!returnedPaths.length) return result("no-path", ENGINE_PLANNER_CODES.NO_PATH, "No executable crafting path was found.", initialItemState,
    { paths: returnedPaths, exploredNodeCount, generatedTransitionCount, truncated, diagnostics });
  return result("completed", ENGINE_PLANNER_CODES.COMPLETED, "Planner search completed.", initialItemState,
    { paths: returnedPaths, exploredNodeCount, generatedTransitionCount, truncated, diagnostics });
}
