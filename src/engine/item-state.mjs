import { ITEM_STATE_SCHEMA_VERSION } from "./constants.mjs";
import { ENGINE_ERROR_CODES, engineError } from "./errors.mjs";
import { immutableCopy } from "./immutability.mjs";
import { createModifierInstance } from "./modifier-instance.mjs";
import { validateItemState } from "./validation.mjs";

const modifierLists = ["prefixModifiers", "suffixModifiers", "implicitModifiers", "craftedModifiers", "desecratedModifiers"];
const itemStateInputFields = new Set(["schemaVersion", "itemId", "baseTypeId", "itemClassId", "itemLevel", "rarity", "quality", "sockets", "metadata", "revision", "history", ...modifierLists]);

function normalizeModifiers(input, listName) {
  if (!Array.isArray(input)) throw engineError(ENGINE_ERROR_CODES.INVALID_MODIFIER_LIST, `${listName} must be an array.`, listName);
  return input.map(createModifierInstance);
}

export function createItemState(input) {
  if (input && (typeof input !== "object" || Array.isArray(input))) throw engineError(ENGINE_ERROR_CODES.INVALID_STATE, "Item-state input must be an object.", "itemState");
  for (const field of Object.keys(input ?? {})) if (!itemStateInputFields.has(field)) throw engineError(ENGINE_ERROR_CODES.UNKNOWN_ENGINE_FIELD, "Unknown item-state field; place descriptive extensions in metadata.", `itemState.${field}`, { field });
  const state = {
    schemaVersion: input?.schemaVersion ?? ITEM_STATE_SCHEMA_VERSION,
    itemId: input?.itemId,
    baseTypeId: input?.baseTypeId,
    itemClassId: input?.itemClassId,
    itemLevel: input?.itemLevel,
    rarity: input?.rarity ?? "normal",
    quality: input?.quality ?? 0,
    sockets: input?.sockets ?? [],
    prefixModifiers: normalizeModifiers(input?.prefixModifiers ?? [], "prefixModifiers"),
    suffixModifiers: normalizeModifiers(input?.suffixModifiers ?? [], "suffixModifiers"),
    implicitModifiers: normalizeModifiers(input?.implicitModifiers ?? [], "implicitModifiers"),
    craftedModifiers: normalizeModifiers(input?.craftedModifiers ?? [], "craftedModifiers"),
    desecratedModifiers: normalizeModifiers(input?.desecratedModifiers ?? [], "desecratedModifiers"),
    metadata: input?.metadata ?? {},
    revision: input?.revision ?? 0,
    history: input?.history ?? []
  };
  const immutable = immutableCopy(state);
  validateItemState(immutable);
  return immutable;
}

export function reviseItemState(previousState, changes = {}) {
  validateItemState(previousState);
  const forbidden = ["schemaVersion", "itemId", "baseTypeId", "itemClassId", "revision", "history"];
  for (const field of forbidden) if (Object.hasOwn(changes, field)) throw engineError(ENGINE_ERROR_CODES.INVALID_STATE, `${field} cannot be changed by reviseItemState.`, field);
  const allowed = new Set(["itemLevel", "rarity", "quality", "sockets", "metadata", ...modifierLists]);
  for (const field of Object.keys(changes)) if (!allowed.has(field)) throw engineError(ENGINE_ERROR_CODES.UNKNOWN_ENGINE_FIELD, "Unknown update field.", field, { field });
  return createItemState({ ...previousState, ...changes, itemId: previousState.itemId, baseTypeId: previousState.baseTypeId, itemClassId: previousState.itemClassId, schemaVersion: previousState.schemaVersion, revision: previousState.revision + 1, history: previousState.history });
}
