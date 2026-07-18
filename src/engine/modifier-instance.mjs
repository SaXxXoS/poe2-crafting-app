import { immutableCopy } from "./immutability.mjs";
import { ENGINE_ERROR_CODES, engineError } from "./errors.mjs";

export const MODIFIER_INSTANCE_FIELDS = Object.freeze([
  "instanceId", "modId", "familyId", "generationType", "domain", "technicalTier",
  "displayTier", "statIds", "values", "source", "appliedAtRevision", "metadata"
]);

export function createModifierInstance(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER, "Modifier instance must be an object.", "modifier");
  for (const field of Object.keys(input)) if (!MODIFIER_INSTANCE_FIELDS.includes(field)) throw engineError(ENGINE_ERROR_CODES.UNKNOWN_ENGINE_FIELD, "Unknown modifier field; place descriptive extensions in metadata.", `modifier.${field}`, { field });
  return immutableCopy({
    instanceId: input?.instanceId,
    modId: input?.modId,
    familyId: input?.familyId ?? null,
    generationType: input?.generationType,
    domain: input?.domain ?? null,
    technicalTier: input?.technicalTier ?? null,
    displayTier: input?.displayTier ?? null,
    statIds: input?.statIds ?? [],
    values: input?.values ?? [],
    source: input?.source ?? "normal",
    appliedAtRevision: input?.appliedAtRevision ?? 0,
    metadata: input?.metadata ?? {}
  });
}
