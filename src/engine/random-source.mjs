import { ENGINE_WEIGHT_SELECTION_CODES, engineError } from "./errors.mjs";
import { immutableCopy } from "./immutability.mjs";

const UINT32_MAX = 0xffffffff;
const ALGORITHM = "mulberry32";
const technicalValue = value => value === null || ["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value) ? value : String(value);

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)
    || Object.keys(state).length !== 2 || state.algorithm !== ALGORITHM
    || !Number.isSafeInteger(state.state) || state.state < 0 || state.state > UINT32_MAX) {
    throw engineError(ENGINE_WEIGHT_SELECTION_CODES.RNG_STATE_INVALID, "Seeded RNG state is invalid.", "options.rngState", { algorithm: technicalValue(state?.algorithm ?? null), state: technicalValue(state?.state ?? null) });
  }
}

export function createSeededRandom(seed) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > UINT32_MAX) {
    throw engineError(ENGINE_WEIGHT_SELECTION_CODES.SEED_INVALID, "Seed must be an unsigned 32-bit safe integer.", "seed", { seed: technicalValue(seed) });
  }
  return immutableCopy({ algorithm: ALGORITHM, state: seed });
}

export function nextSeededRandom(rngState) {
  validateState(rngState);
  const nextState = (rngState.state + 0x6d2b79f5) >>> 0;
  let value = nextState;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  const randomValue = ((value ^ value >>> 14) >>> 0) / 4294967296;
  return immutableCopy({ value: randomValue, nextRngState: { algorithm: ALGORITHM, state: nextState } });
}
