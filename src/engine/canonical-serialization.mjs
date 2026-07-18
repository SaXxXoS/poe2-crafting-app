import { ENGINE_ACTION_CODES, engineError } from "./errors.mjs";

const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const compareCodeUnits = (left, right) => left === right ? 0 : left < right ? -1 : 1;
const invalid = (message, path, value) => { throw engineError(ENGINE_ACTION_CODES.CANONICAL_PAYLOAD_INVALID, message, path, { type: typeof value }); };

function canonicalValue(value, path) {
  if (value === undefined) invalid("Canonical technical payload cannot contain undefined.", path, value);
  if (typeof value === "number" && !Number.isFinite(value)) invalid("Canonical technical payload numbers must be finite.", path, value);
  if (value === null || ["string", "boolean", "number"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`));
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareCodeUnits).map(key => [key, canonicalValue(value[key], `${path}.${key}`)]));
  invalid("Canonical technical payload contains an unsupported value type.", path, value);
}

export function canonicalTechnicalString(value) {
  return JSON.stringify(canonicalValue(value, "payload"));
}
