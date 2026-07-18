import { CURRENT_MAX_ITEM_LEVEL, ENGINE_RARITIES, ITEM_STATE_SCHEMA_VERSION, MODIFIER_CATEGORIES } from "./constants.mjs";
import { ENGINE_ERROR_CODES, engineError } from "./errors.mjs";
import { MODIFIER_INSTANCE_FIELDS } from "./modifier-instance.mjs";

const STATE_FIELDS = new Set([
  "schemaVersion", "itemId", "baseTypeId", "itemClassId", "itemLevel", "rarity", "quality", "sockets",
  ...Object.keys(MODIFIER_CATEGORIES), "metadata", "revision", "history"
]);
const MODIFIER_FIELDS = new Set(MODIFIER_INSTANCE_FIELDS);
const HISTORY_FIELDS = new Set(["sequence", "previousRevision", "nextRevision", "actionType", "actionId", "input", "result", "metadata"]);
const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isId = value => typeof value === "string" && value.trim().length > 0;
const isInteger = value => Number.isInteger(value);

function rejectUnknownFields(value, fields, path) {
  for (const key of Object.keys(value)) if (!fields.has(key)) throw engineError(ENGINE_ERROR_CODES.UNKNOWN_ENGINE_FIELD, "Unknown engine field; place descriptive extensions in metadata.", `${path}.${key}`, { field: key });
}

function validateModifier(modifier, path, allowedGenerationTypes, revision) {
  if (!isRecord(modifier)) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER, "Modifier instance must be an object.", path, { value: modifier });
  rejectUnknownFields(modifier, MODIFIER_FIELDS, path);
  for (const field of ["instanceId", "modId", "generationType", "source"]) if (!isId(modifier[field])) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER, `${field} must be a non-empty technical identifier.`, `${path}.${field}`, { field });
  if (!allowedGenerationTypes.includes(modifier.generationType)) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER, "Modifier generation type does not match its category.", `${path}.generationType`, { allowed: allowedGenerationTypes, actual: modifier.generationType });
  if (modifier.familyId !== null && !isId(modifier.familyId)) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER, "familyId must be null or a non-empty technical identifier.", `${path}.familyId`);
  if (modifier.domain !== null && !isId(modifier.domain)) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER, "domain must be null or a non-empty technical identifier.", `${path}.domain`);
  if (modifier.technicalTier !== null && (!isInteger(modifier.technicalTier) || modifier.technicalTier < 1)) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER, "technicalTier must be null or a positive integer.", `${path}.technicalTier`);
  if (modifier.displayTier !== null && (!isInteger(modifier.displayTier) || modifier.displayTier < 1)) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER, "displayTier must be null or a positive item-class-specific tier.", `${path}.displayTier`);
  if (!Array.isArray(modifier.statIds) || modifier.statIds.some(statId => !isId(statId))) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER, "statIds must be an array of technical identifiers.", `${path}.statIds`);
  if (!Array.isArray(modifier.values) || modifier.values.some(value => !isRecord(value))) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER, "values must be an array of structured value objects.", `${path}.values`);
  if (!isInteger(modifier.appliedAtRevision) || modifier.appliedAtRevision < 0 || modifier.appliedAtRevision > revision) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER, "appliedAtRevision must reference an existing revision.", `${path}.appliedAtRevision`, { revision });
  if (!isRecord(modifier.metadata)) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER, "metadata must be an object.", `${path}.metadata`);
}

function validateHistory(history, revision) {
  if (!Array.isArray(history)) throw engineError(ENGINE_ERROR_CODES.INVALID_HISTORY, "history must be an array.", "history");
  history.forEach((entry, index) => {
    const path = `history[${index}]`;
    if (!isRecord(entry)) throw engineError(ENGINE_ERROR_CODES.INVALID_HISTORY, "History entry must be an object.", path);
    rejectUnknownFields(entry, HISTORY_FIELDS, path);
    if (!isInteger(entry.sequence) || entry.sequence < 0 || entry.sequence !== index) throw engineError(ENGINE_ERROR_CODES.INVALID_HISTORY, "History sequence must be contiguous and zero-based.", `${path}.sequence`);
    if (!isInteger(entry.previousRevision) || !isInteger(entry.nextRevision) || entry.previousRevision < 0 || entry.nextRevision <= entry.previousRevision || entry.nextRevision > revision) throw engineError(ENGINE_ERROR_CODES.INVALID_HISTORY, "History revisions must be valid and increasing.", path, { revision });
    if (!isId(entry.actionType) || !isId(entry.actionId)) throw engineError(ENGINE_ERROR_CODES.INVALID_HISTORY, "History action identifiers must be non-empty.", path);
    for (const field of ["input", "result", "metadata"]) if (!isRecord(entry[field])) throw engineError(ENGINE_ERROR_CODES.INVALID_HISTORY, `${field} must be an object.`, `${path}.${field}`);
  });
}

export function validateItemState(state) {
  if (!isRecord(state)) throw engineError(ENGINE_ERROR_CODES.INVALID_STATE, "Item state must be an object.", "");
  rejectUnknownFields(state, STATE_FIELDS, "itemState");
  if (state.schemaVersion !== ITEM_STATE_SCHEMA_VERSION) throw engineError(ENGINE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION, "Unsupported item-state schema version.", "schemaVersion", { supported: [ITEM_STATE_SCHEMA_VERSION], actual: state.schemaVersion });
  for (const field of ["itemId", "baseTypeId", "itemClassId"]) if (!isId(state[field])) throw engineError(ENGINE_ERROR_CODES.INVALID_IDENTITY, `${field} must be a non-empty technical identifier.`, field);
  if (!isInteger(state.itemLevel) || state.itemLevel < 1 || state.itemLevel > CURRENT_MAX_ITEM_LEVEL) throw engineError(ENGINE_ERROR_CODES.INVALID_ITEM_LEVEL, `itemLevel must be an integer from 1 to ${CURRENT_MAX_ITEM_LEVEL}.`, "itemLevel", { minimum: 1, maximum: CURRENT_MAX_ITEM_LEVEL, actual: state.itemLevel });
  if (!ENGINE_RARITIES.includes(state.rarity)) throw engineError(ENGINE_ERROR_CODES.INVALID_RARITY, "Unknown item rarity.", "rarity", { allowed: ENGINE_RARITIES, actual: state.rarity });
  if (!isInteger(state.quality) || state.quality < 0) throw engineError(ENGINE_ERROR_CODES.INVALID_STATE, "quality must be a non-negative integer.", "quality");
  if (!Array.isArray(state.sockets)) throw engineError(ENGINE_ERROR_CODES.INVALID_STATE, "sockets must be an array.", "sockets");
  if (!isInteger(state.revision) || state.revision < 0) throw engineError(ENGINE_ERROR_CODES.INVALID_REVISION, "revision must be a non-negative integer.", "revision");
  if (!isRecord(state.metadata)) throw engineError(ENGINE_ERROR_CODES.INVALID_STATE, "metadata must be an object.", "metadata");
  const seen = new Set();
  for (const [listName, allowedTypes] of Object.entries(MODIFIER_CATEGORIES)) {
    const list = state[listName];
    if (!Array.isArray(list)) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER_LIST, `${listName} must be an array.`, listName);
    list.forEach((modifier, index) => {
      validateModifier(modifier, `${listName}[${index}]`, allowedTypes, state.revision);
      if (seen.has(modifier.instanceId)) throw engineError(ENGINE_ERROR_CODES.DUPLICATE_MODIFIER_INSTANCE, "Modifier instanceId must be unique across the item.", `${listName}[${index}].instanceId`, { instanceId: modifier.instanceId });
      seen.add(modifier.instanceId);
    });
  }
  validateHistory(state.history, state.revision);
  return state;
}
