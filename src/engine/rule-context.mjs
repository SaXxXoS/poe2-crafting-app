import { ENGINE_RULE_ERROR_CODES, engineError } from "./errors.mjs";
import { immutableCopy } from "./immutability.mjs";
import { validateItemState } from "./validation.mjs";

export function createRuleContext({ itemState, catalog, actionContext = {}, metadata = {} }) {
  validateItemState(itemState);
  if (!catalog || !Object.isFrozen(catalog)) throw engineError(ENGINE_RULE_ERROR_CODES.INVALID_CATALOG_DATA, "Rule context requires an immutable modifier catalog.", "catalog");
  const context = {
    itemState,
    itemClassId: itemState.itemClassId,
    baseTypeId: itemState.baseTypeId,
    itemLevel: itemState.itemLevel,
    rarity: itemState.rarity,
    catalog,
    actionContext: immutableCopy(actionContext),
    metadata: immutableCopy(metadata)
  };
  return Object.freeze(context);
}
