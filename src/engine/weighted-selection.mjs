import { ENGINE_WEIGHT_SELECTION_CODES } from "./errors.mjs";
import { immutableCopy } from "./immutability.mjs";
import { nextSeededRandom } from "./random-source.mjs";

const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const issue = (code, message, path, details = {}) => ({ code, message, path, details });
const technicalValue = value => value === null || ["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value) ? value : String(value);

function result(request, status, entry, selection = {}) {
  const errors = status === "error" ? [entry] : [];
  const reasons = entry ? [entry] : [];
  return immutableCopy({
    valid: status !== "error", status, requestId: typeof request?.id === "string" ? request.id : null,
    deterministicKey: typeof request?.deterministicKey === "string" ? request.deterministicKey : null,
    selectedCandidate: selection.selectedCandidate ?? null,
    selectedCandidateId: selection.selectedCandidate?.modifierId ?? null,
    selectedIndex: selection.selectedIndex ?? null,
    randomValue: selection.randomValue ?? null,
    targetWeight: selection.targetWeight ?? null,
    totalWeight: selection.totalWeight ?? null,
    rngState: selection.rngState ?? null,
    nextRngState: selection.nextRngState ?? null,
    reasons, errors, warnings: []
  });
}

function validateRequest(request) {
  if (!isRecord(request)) return { status: "error", entry: issue(ENGINE_WEIGHT_SELECTION_CODES.REQUEST_INVALID, "Selection request must be an object.", "request") };
  if (request.type !== "modifier-addition") return { status: "inapplicable", entry: issue(ENGINE_WEIGHT_SELECTION_CODES.REQUEST_TYPE_UNSUPPORTED, "Only modifier-addition requests are supported.", "request.type", { type: request.type ?? null }) };
  if (request.executable !== true) return { status: "inapplicable", entry: issue(ENGINE_WEIGHT_SELECTION_CODES.REQUEST_NOT_EXECUTABLE, "Selection request is not executable.", "request.executable", { executable: request.executable ?? null }) };
  if (request.count !== 1) return { status: "inapplicable", entry: issue(ENGINE_WEIGHT_SELECTION_CODES.COUNT_UNSUPPORTED, "Only selection count 1 is supported.", "request.count", { count: request.count ?? null }) };
  if (!Array.isArray(request.candidates)) return { status: "error", entry: issue(ENGINE_WEIGHT_SELECTION_CODES.REQUEST_INVALID, "Selection request candidates must be an array.", "request.candidates") };
  if (!request.candidates.length) return { status: "inapplicable", entry: issue(ENGINE_WEIGHT_SELECTION_CODES.EMPTY_POOL, "Selection request has no candidates.", "request.candidates") };

  const identities = new Set();
  let totalWeight = 0;
  for (let index = 0; index < request.candidates.length; index += 1) {
    const candidate = request.candidates[index];
    const path = `request.candidates[${index}]`;
    if (!isRecord(candidate) || typeof candidate.modifierId !== "string" || !candidate.modifierId.length
      || typeof candidate.generationType !== "string" || !candidate.generationType.length) {
      return { status: "error", entry: issue(ENGINE_WEIGHT_SELECTION_CODES.CANDIDATE_INVALID, "Selection candidate lacks stable technical identity.", path) };
    }
    if (identities.has(candidate.modifierId)) return { status: "error", entry: issue(ENGINE_WEIGHT_SELECTION_CODES.CANDIDATE_DUPLICATE, "Selection candidate identity is duplicated.", `${path}.modifierId`, { modifierId: candidate.modifierId }) };
    identities.add(candidate.modifierId);
    const weight = candidate.applicableWeight?.spawn;
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
      return { status: "error", entry: issue(ENGINE_WEIGHT_SELECTION_CODES.WEIGHT_INVALID, "Candidate effective weight must be a finite non-negative number.", `${path}.applicableWeight.spawn`, { modifierId: candidate.modifierId, weight: technicalValue(weight ?? null) }) };
    }
    totalWeight += weight;
    if (!Number.isFinite(totalWeight)) return { status: "error", entry: issue(ENGINE_WEIGHT_SELECTION_CODES.TOTAL_WEIGHT_INVALID, "Candidate effective weight sum must remain finite.", "request.candidates", { index }) };
  }
  if (!(totalWeight > 0)) return { status: "inapplicable", entry: issue(ENGINE_WEIGHT_SELECTION_CODES.NO_POSITIVE_WEIGHT, "Selection request has no positive effective weight.", "request.candidates"), totalWeight };
  return { status: "valid", totalWeight };
}

function randomStep(options) {
  if (!isRecord(options)) return { error: issue(ENGINE_WEIGHT_SELECTION_CODES.RNG_STATE_INVALID, "Selection options must be an object.", "options") };
  const hasRandom = Object.hasOwn(options, "random");
  const hasState = Object.hasOwn(options, "rngState");
  if (hasRandom === hasState) return { error: issue(ENGINE_WEIGHT_SELECTION_CODES.RNG_STATE_INVALID, "Provide exactly one random function or seeded RNG state.", "options") };
  if (hasRandom) {
    if (typeof options.random !== "function") return { error: issue(ENGINE_WEIGHT_SELECTION_CODES.RNG_STATE_INVALID, "Injected random source must be a function.", "options.random") };
    let value;
    try { value = options.random(); } catch (error) { return { error: issue(ENGINE_WEIGHT_SELECTION_CODES.RNG_OUTPUT_INVALID, "Injected random source threw an error.", "options.random", { name: error?.name ?? null }) }; }
    return { value, rngState: null, nextRngState: null };
  }
  try {
    const step = nextSeededRandom(options.rngState);
    return { value: step.value, rngState: options.rngState, nextRngState: step.nextRngState };
  } catch (error) {
    return { error: issue(error.code ?? ENGINE_WEIGHT_SELECTION_CODES.RNG_STATE_INVALID, error.message, error.path ?? "options.rngState", error.details ?? {}) };
  }
}

export function selectWeightedModifier(request, options = {}) {
  const validation = validateRequest(request);
  if (validation.status !== "valid") return result(request, validation.status, validation.entry, { totalWeight: validation.totalWeight ?? null });
  const random = randomStep(options);
  if (random.error) return result(request, "error", random.error, { totalWeight: validation.totalWeight });
  if (typeof random.value !== "number" || !Number.isFinite(random.value) || random.value < 0 || random.value >= 1) {
    return result(request, "error", issue(ENGINE_WEIGHT_SELECTION_CODES.RNG_OUTPUT_INVALID, "Random source must return a finite number in [0, 1).", "randomValue", { value: technicalValue(random.value ?? null) }), { totalWeight: validation.totalWeight, rngState: random.rngState, nextRngState: random.nextRngState });
  }

  const targetWeight = random.value * validation.totalWeight;
  let cumulativeWeight = 0;
  for (let index = 0; index < request.candidates.length; index += 1) {
    const weight = request.candidates[index].applicableWeight.spawn;
    if (weight === 0) continue;
    cumulativeWeight += weight;
    if (targetWeight < cumulativeWeight) return result(request, "selected", null, {
      selectedCandidate: request.candidates[index], selectedIndex: index, randomValue: random.value,
      targetWeight, totalWeight: validation.totalWeight, rngState: random.rngState, nextRngState: random.nextRngState
    });
  }
  return result(request, "error", issue(ENGINE_WEIGHT_SELECTION_CODES.SELECTION_INVARIANT, "Weighted selection did not resolve a candidate.", "request.candidates", { targetWeight, totalWeight: validation.totalWeight }), {
    randomValue: random.value, targetWeight, totalWeight: validation.totalWeight, rngState: random.rngState, nextRngState: random.nextRngState
  });
}
