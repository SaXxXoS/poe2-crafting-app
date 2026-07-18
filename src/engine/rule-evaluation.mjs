import { CURRENT_MAX_ITEM_LEVEL } from "./constants.mjs";
import { ENGINE_RULE_ERROR_CODES } from "./errors.mjs";
import { immutableCopy } from "./immutability.mjs";

export const ENGINE_RULE_SETS = Object.freeze([
  "identity", "modifierReference", "domain", "generationType", "itemLevel", "tagAndWeightStructure"
]);

const issue = (ruleSet, code, message, path, details = {}) => ({ code, message, path, details, ruleSet });
const validWeightRules = value => Array.isArray(value) && value.every(rule => rule && typeof rule === "object" && !Array.isArray(rule) && typeof rule.tag === "string" && rule.tag.length > 0 && Number.isFinite(rule.weight) && rule.weight >= 0 && Object.keys(rule).every(key => key === "tag" || key === "weight"));
const valueStatus = (value, known = null) => value === null || value === undefined ? "notPresent" : known === null || known.includes(value) ? "presentKnown" : "presentUnknown";

export function evaluateRuleSets(context) {
  const errors = [];
  const warnings = [];
  const { catalog } = context;
  const itemClass = catalog.itemClasses[context.itemClassId];
  const baseType = catalog.baseTypes[context.baseTypeId];
  const modId = context.actionContext.modId ?? null;
  const modifier = modId ? catalog.modifiers[modId] : null;

  if (!itemClass) errors.push(issue("identity", ENGINE_RULE_ERROR_CODES.UNKNOWN_ITEM_CLASS, "Item class is not present in the catalog.", "itemClassId", { itemClassId: context.itemClassId }));
  if (!baseType) errors.push(issue("identity", ENGINE_RULE_ERROR_CODES.UNKNOWN_BASE_TYPE, "Base type is not present in the catalog.", "baseTypeId", { baseTypeId: context.baseTypeId }));
  if (baseType && baseType.itemClassId !== context.itemClassId) errors.push(issue("identity", ENGINE_RULE_ERROR_CODES.BASE_CLASS_MISMATCH, "Base type does not belong to the item class.", "baseTypeId", { baseItemClassId: baseType.itemClassId, itemClassId: context.itemClassId }));
  if (!Number.isInteger(context.itemLevel) || context.itemLevel < 1 || context.itemLevel > CURRENT_MAX_ITEM_LEVEL) errors.push(issue("identity", "ENGINE_INVALID_ITEM_LEVEL", "Item level is outside the supported range.", "itemLevel", { maximum: CURRENT_MAX_ITEM_LEVEL, actual: context.itemLevel }));

  if (modId && !modifier) errors.push(issue("modifierReference", ENGINE_RULE_ERROR_CODES.UNKNOWN_MODIFIER, "Modifier is not present in the catalog.", "actionContext.modId", { modId }));
  if (modifier?.familyId && !catalog.families[modifier.familyId]) errors.push(issue("modifierReference", ENGINE_RULE_ERROR_CODES.INVALID_CATALOG_DATA, "Referenced modifier family is missing.", "catalog.modifiers.familyId", { modId, familyId: modifier.familyId }));
  if (modifier && (!Array.isArray(modifier.statIds) || modifier.technicalTier !== null && (!Number.isInteger(modifier.technicalTier) || modifier.technicalTier < 1))) errors.push(issue("modifierReference", ENGINE_RULE_ERROR_CODES.INVALID_CATALOG_DATA, "Modifier stat or technical tier data is inconsistent.", "catalog.modifiers", { modId }));

  if (modifier && modifier.domain !== null && !catalog.knownDomains.includes(modifier.domain)) errors.push(issue("domain", ENGINE_RULE_ERROR_CODES.UNKNOWN_MODIFIER_DOMAIN, "Modifier domain is unknown to the catalog.", "catalog.modifiers.domain", { modId, domain: modifier.domain }));
  if (modifier && modifier.itemDomain !== null && !catalog.knownDomains.includes(modifier.itemDomain)) errors.push(issue("domain", ENGINE_RULE_ERROR_CODES.UNKNOWN_MODIFIER_DOMAIN, "Item domain is unknown to the catalog.", "catalog.modifiers.itemDomain", { modId, domain: modifier.itemDomain }));
  if (modifier && modifier.domain === null) warnings.push(issue("domain", ENGINE_RULE_ERROR_CODES.RULE_DATA_NOT_AVAILABLE, "Modifier domain is not present in the structured catalog data.", "catalog.modifiers.domain", { modId, status: "notPresent" }));

  if (modifier && modifier.generationType !== null && !catalog.knownGenerationTypes.includes(modifier.generationType)) errors.push(issue("generationType", ENGINE_RULE_ERROR_CODES.UNKNOWN_GENERATION_TYPE, "Modifier generation type is unknown to the catalog.", "catalog.modifiers.generationType", { modId, generationType: modifier.generationType }));
  if (modifier && modifier.generationType === null) warnings.push(issue("generationType", ENGINE_RULE_ERROR_CODES.RULE_DATA_NOT_AVAILABLE, "Modifier generation type is not present in the structured catalog data.", "catalog.modifiers.generationType", { modId, status: "notPresent" }));

  if (modifier && modifier.requiredLevel !== null && context.itemLevel < modifier.requiredLevel) errors.push(issue("itemLevel", ENGINE_RULE_ERROR_CODES.MODIFIER_ITEM_LEVEL_NOT_MET, "Modifier item-level requirement is not met.", "itemLevel", { modId, requiredLevel: modifier.requiredLevel, itemLevel: context.itemLevel }));
  if (modifier && modifier.displayTiers !== null && itemClass && modifier.displayTiers[context.itemClassId] === undefined) warnings.push(issue("itemLevel", ENGINE_RULE_ERROR_CODES.DISPLAY_TIER_CONTEXT_REQUIRED, "No displayTier exists for this item-class context.", "itemClassId", { modId, itemClassId: context.itemClassId }));

  for (const [field, value] of [["spawnWeights", modifier?.spawnWeights], ["generationWeights", modifier?.generationWeights]]) {
    if (modifier && value !== null && !validWeightRules(value)) errors.push(issue("tagAndWeightStructure", ENGINE_RULE_ERROR_CODES.INVALID_WEIGHT_STRUCTURE, "Modifier weight rules have an unsupported structure.", `catalog.modifiers.${field}`, { modId, field }));
    if (modifier && value === null) warnings.push(issue("tagAndWeightStructure", ENGINE_RULE_ERROR_CODES.RULE_DATA_NOT_AVAILABLE, "Modifier weight data is not present in the structured catalog data.", `catalog.modifiers.${field}`, { modId, field, status: "notPresent" }));
  }

  return immutableCopy({
    valid: errors.length === 0,
    errors,
    warnings,
    evaluatedRuleSets: [...ENGINE_RULE_SETS],
    contextSummary: {
      itemId: context.itemState.itemId,
      itemClassId: context.itemClassId,
      baseTypeId: context.baseTypeId,
      itemLevel: context.itemLevel,
      rarity: context.rarity,
      modId,
      technicalDataStatus: modifier ? {
        domain: valueStatus(modifier.domain, catalog.knownDomains),
        itemDomain: valueStatus(modifier.itemDomain, catalog.knownDomains),
        generationType: valueStatus(modifier.generationType, catalog.knownGenerationTypes),
        spawnWeights: modifier.spawnWeights === null ? "notPresent" : validWeightRules(modifier.spawnWeights) ? "presentKnown" : "presentUnknown",
        generationWeights: modifier.generationWeights === null ? "notPresent" : validWeightRules(modifier.generationWeights) ? "presentKnown" : "presentUnknown",
        flags: valueStatus(modifier.flags)
      } : null
    }
  });
}
