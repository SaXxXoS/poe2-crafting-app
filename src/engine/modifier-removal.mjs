import { canonicalTechnicalString } from "./canonical-serialization.mjs";
import { ENGINE_REMOVAL_CODES } from "./errors.mjs";
import { immutableCopy } from "./immutability.mjs";
import { nextSeededRandom } from "./random-source.mjs";
import { validateItemState } from "./validation.mjs";

const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const issue = (code, message, path, details = {}) => ({ code, message, path, details });
const compareTechnicalStrings = (left, right) => left === right ? 0 : left < right ? -1 : 1;
const technicalEqual = (left, right) => {
  try { return canonicalTechnicalString(left) === canonicalTechnicalString(right); } catch { return false; }
};

function regularCandidates(itemState) {
  return [
    ...itemState.prefixModifiers.map(instance => ({ listName: "prefixModifiers", instance })),
    ...itemState.suffixModifiers.map(instance => ({ listName: "suffixModifiers", instance }))
  ].map(({ listName, instance }) => ({
    instanceId: instance.instanceId,
    modifierId: instance.modId,
    listName,
    generationType: instance.generationType,
    source: instance.source,
    familyId: instance.familyId,
    domain: instance.domain,
    technicalTier: instance.technicalTier,
    displayTier: instance.displayTier,
    statIds: instance.statIds,
    values: instance.values,
    appliedAtRevision: instance.appliedAtRevision,
    metadata: instance.metadata
  })).sort((left, right) => compareTechnicalStrings(left.instanceId, right.instanceId));
}

export function createModifierRemovalRequest({ actionId, itemState } = {}) {
  validateItemState(itemState);
  if (typeof actionId !== "string" || !actionId.trim()) throw new TypeError("actionId must be a non-empty technical identifier.");
  const candidates = regularCandidates(itemState);
  const executable = candidates.length > 0;
  const weighting = { mode: "uniform-candidate-count", normalized: true };
  const constraints = { regularExplicitModifiersOnly: true, excludedLists: ["implicitModifiers", "craftedModifiers", "desecratedModifiers"] };
  const keyPayload = {
    keyVersion: 1,
    actionId,
    type: "modifier-removal",
    count: 1,
    item: {
      itemId: itemState.itemId,
      revision: itemState.revision,
      itemClassId: itemState.itemClassId,
      baseTypeId: itemState.baseTypeId,
      rarity: itemState.rarity
    },
    candidateStatus: "existing",
    candidates,
    weighting,
    replacementPolicy: "without-replacement",
    constraints,
    executable
  };
  const deterministicKey = canonicalTechnicalString(keyPayload);
  return immutableCopy({
    id: `selection:${deterministicKey}`,
    type: "modifier-removal",
    actionId,
    executable,
    count: 1,
    candidateStatus: "existing",
    candidates,
    weighting,
    replacementPolicy: "without-replacement",
    constraints,
    sourceResult: { prefixCount: itemState.prefixModifiers.length, suffixCount: itemState.suffixModifiers.length },
    deterministicKey
  });
}

function validateRequest(request) {
  if (!isRecord(request)) return issue(ENGINE_REMOVAL_CODES.REQUEST_INVALID, "Removal request must be an object.", "request");
  if (request.type !== "modifier-removal" || request.count !== 1 || typeof request.executable !== "boolean" || !Array.isArray(request.candidates)
    || request.executable !== (request.candidates.length > 0)) {
    return issue(ENGINE_REMOVAL_CODES.REQUEST_INVALID, "Removal request executable state must match its count-1 candidate pool.", "request");
  }
  if (request.id !== `selection:${request.deterministicKey}` || typeof request.deterministicKey !== "string") {
    return issue(ENGINE_REMOVAL_CODES.REQUEST_MISMATCH, "Removal request identity is invalid.", "request.deterministicKey");
  }
  if (request.candidateStatus !== "existing" || request.replacementPolicy !== "without-replacement"
    || !technicalEqual(request.weighting, { mode: "uniform-candidate-count", normalized: true })
    || !technicalEqual(request.constraints, { regularExplicitModifiersOnly: true, excludedLists: ["implicitModifiers", "craftedModifiers", "desecratedModifiers"] })) {
    return issue(ENGINE_REMOVAL_CODES.REQUEST_INVALID, "Removal request does not use the authoritative regular-modifier selection contract.", "request");
  }
  let payload;
  try { payload = JSON.parse(request.deterministicKey); } catch {
    return issue(ENGINE_REMOVAL_CODES.REQUEST_MISMATCH, "Removal request key is not canonical JSON.", "request.deterministicKey");
  }
  const expectedPayload = {
    keyVersion: 1, actionId: request.actionId, type: request.type, count: request.count, item: payload.item,
    candidateStatus: request.candidateStatus, candidates: request.candidates, weighting: request.weighting,
    replacementPolicy: request.replacementPolicy, constraints: request.constraints, executable: request.executable
  };
  if (!isRecord(payload.item) || !technicalEqual(payload, expectedPayload)) {
    return issue(ENGINE_REMOVAL_CODES.REQUEST_MISMATCH, "Removal request fields do not match its deterministic key.", "request");
  }
  const seen = new Set();
  for (let index = 0; index < request.candidates.length; index += 1) {
    const candidate = request.candidates[index];
    if (!isRecord(candidate) || typeof candidate.instanceId !== "string" || !candidate.instanceId
      || typeof candidate.modifierId !== "string" || !candidate.modifierId
      || !["prefixModifiers", "suffixModifiers"].includes(candidate.listName)
      || candidate.generationType !== (candidate.listName === "prefixModifiers" ? "prefix" : "suffix")) {
      return issue(ENGINE_REMOVAL_CODES.CANDIDATE_INVALID, "Removal candidate is not a regular explicit modifier instance.", `request.candidates[${index}]`);
    }
    if (seen.has(candidate.instanceId)) return issue(ENGINE_REMOVAL_CODES.CANDIDATE_DUPLICATE, "Removal candidate instance is duplicated.", `request.candidates[${index}].instanceId`, { instanceId: candidate.instanceId });
    if (index > 0 && compareTechnicalStrings(request.candidates[index - 1].instanceId, candidate.instanceId) >= 0) {
      return issue(ENGINE_REMOVAL_CODES.CANDIDATE_ORDER_INVALID, "Removal candidates are not in canonical instance order.", `request.candidates[${index}].instanceId`);
    }
    seen.add(candidate.instanceId);
  }
  return null;
}

export function validateModifierRemovalSelection(request, selection) {
  const requestError = validateRequest(request);
  if (requestError) return immutableCopy({ valid: false, error: requestError });
  if (!isRecord(selection) || selection.valid !== true || selection.status !== "selected"
    || selection.requestId !== request.id || selection.deterministicKey !== request.deterministicKey
    || !Number.isInteger(selection.selectedIndex) || selection.selectedIndex < 0 || selection.selectedIndex >= request.candidates.length
    || selection.targetIndex !== selection.selectedIndex || selection.candidateCount !== request.candidates.length
    || typeof selection.randomValue !== "number" || !Number.isFinite(selection.randomValue) || selection.randomValue < 0 || selection.randomValue >= 1
    || Math.floor(selection.randomValue * request.candidates.length) !== selection.selectedIndex) {
    return immutableCopy({ valid: false, error: issue(ENGINE_REMOVAL_CODES.REQUEST_MISMATCH, "Removal selection does not match the authoritative request and uniform draw.", "selection") });
  }
  const candidate = request.candidates[selection.selectedIndex];
  if (selection.selectedCandidateId !== candidate.instanceId || selection.selectedInstanceId !== candidate.instanceId || !technicalEqual(selection.selectedCandidate, candidate)) {
    return immutableCopy({ valid: false, error: issue(ENGINE_REMOVAL_CODES.CANDIDATE_INVALID, "Removal selection candidate does not match the request candidate.", "selection.selectedCandidate") });
  }
  if (selection.rngState === null) {
    if (selection.nextRngState !== null) return immutableCopy({ valid: false, error: issue(ENGINE_REMOVAL_CODES.RNG_INVALID, "Injected-random selection must not claim a seeded next state.", "selection.nextRngState") });
  } else {
    try {
      const step = nextSeededRandom(selection.rngState);
      if (step.value !== selection.randomValue || !technicalEqual(step.nextRngState, selection.nextRngState)) {
        return immutableCopy({ valid: false, error: issue(ENGINE_REMOVAL_CODES.RNG_INVALID, "Seeded removal selection does not match its RNG transition.", "selection.rngState") });
      }
    } catch (error) {
      return immutableCopy({ valid: false, error: issue(error.code ?? ENGINE_REMOVAL_CODES.RNG_INVALID, error.message, error.path ?? "selection.rngState", error.details ?? {}) });
    }
  }
  return immutableCopy({ valid: true, error: null });
}

function selectionResult(request, status, entry = null, data = {}) {
  return immutableCopy({
    valid: status !== "error",
    status,
    requestId: typeof request?.id === "string" ? request.id : null,
    deterministicKey: typeof request?.deterministicKey === "string" ? request.deterministicKey : null,
    selectedCandidate: data.selectedCandidate ?? null,
    selectedCandidateId: data.selectedCandidate?.instanceId ?? null,
    selectedInstanceId: data.selectedCandidate?.instanceId ?? null,
    selectedIndex: data.selectedIndex ?? null,
    randomValue: data.randomValue ?? null,
    targetIndex: data.targetIndex ?? null,
    candidateCount: Array.isArray(request?.candidates) ? request.candidates.length : null,
    rngState: data.rngState ?? null,
    nextRngState: data.nextRngState ?? null,
    reasons: entry ? [entry] : [],
    errors: status === "error" && entry ? [entry] : [],
    warnings: []
  });
}

function randomStep(options) {
  if (!isRecord(options)) return { error: issue(ENGINE_REMOVAL_CODES.RNG_INVALID, "Selection options must be an object.", "options") };
  const hasRandom = Object.hasOwn(options, "random");
  const hasState = Object.hasOwn(options, "rngState");
  if (hasRandom === hasState) return { error: issue(ENGINE_REMOVAL_CODES.RNG_INVALID, "Provide exactly one random function or seeded RNG state.", "options") };
  if (hasRandom) {
    if (typeof options.random !== "function") return { error: issue(ENGINE_REMOVAL_CODES.RNG_INVALID, "Injected random source must be a function.", "options.random") };
    try { return { value: options.random(), rngState: null, nextRngState: null }; } catch (error) {
      return { error: issue(ENGINE_REMOVAL_CODES.RNG_INVALID, "Injected random source threw an error.", "options.random", { name: error?.name ?? null }) };
    }
  }
  try {
    const step = nextSeededRandom(options.rngState);
    return { value: step.value, rngState: options.rngState, nextRngState: step.nextRngState };
  } catch (error) {
    return { error: issue(error.code ?? ENGINE_REMOVAL_CODES.RNG_INVALID, error.message, error.path ?? "options.rngState", error.details ?? {}) };
  }
}

export function selectModifierForRemoval(request, options = {}) {
  const requestError = validateRequest(request);
  if (requestError) return selectionResult(request, "error", requestError);
  if (!request.executable) return selectionResult(request, "inapplicable", issue(ENGINE_REMOVAL_CODES.EMPTY_POOL, "Removal request has no regular explicit candidates.", "request.candidates"));
  const random = randomStep(options);
  if (random.error) return selectionResult(request, "error", random.error);
  if (typeof random.value !== "number" || !Number.isFinite(random.value) || random.value < 0 || random.value >= 1) {
    return selectionResult(request, "error", issue(ENGINE_REMOVAL_CODES.RNG_OUTPUT_INVALID, "Random source must return a finite number in [0, 1).", "randomValue"), random);
  }
  const targetIndex = Math.floor(random.value * request.candidates.length);
  return selectionResult(request, "selected", null, {
    selectedCandidate: request.candidates[targetIndex], selectedIndex: targetIndex, targetIndex,
    randomValue: random.value, rngState: random.rngState, nextRngState: random.nextRngState
  });
}
