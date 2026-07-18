import { ENGINE_ERROR_CODES, engineError } from "./errors.mjs";
import { immutableCopy } from "./immutability.mjs";
import { validateItemState } from "./validation.mjs";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

export function serializeItemState(state) {
  validateItemState(state);
  return `${JSON.stringify(canonicalize(state), null, 2)}\n`;
}

export function deserializeItemState(serialized) {
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (cause) {
    throw engineError(ENGINE_ERROR_CODES.INVALID_STATE, "Serialized item state is not valid JSON.", "", { cause: cause.message });
  }
  validateItemState(parsed);
  return immutableCopy(parsed);
}
