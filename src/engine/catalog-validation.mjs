import { ENGINE_RULE_ERROR_CODES, engineError } from "./errors.mjs";

const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isId = value => typeof value === "string" && value.length > 0;
const isNullableId = value => value === null || isId(value);
const hasOnlyFields = (value, fields) => Object.keys(value).every(key => fields.has(key));
const hasExactFields = (value, fields) => hasOnlyFields(value, fields) && [...fields].every(key => Object.hasOwn(value, key));
const validIds = value => Array.isArray(value) && value.every(isId);
const validNullableIds = value => value === null || validIds(value);
const validTier = (value, minimum) => value === null || Number.isInteger(value) && value >= minimum;
const invalid = (message, path, details = {}) => { throw engineError(ENGINE_RULE_ERROR_CODES.INVALID_CATALOG_DATA, message, path, details); };
const invalidCode = (code, message, path, details = {}) => { throw engineError(code, message, path, details); };

const TOP_FIELDS = new Set(["schemaVersion", "itemClasses", "baseTypes", "modifiers", "families", "knownDomains", "knownGenerationTypes"]);
const ITEM_CLASS_FIELDS = new Set(["id"]);
const BASE_TYPE_FIELDS = new Set(["id", "itemClassId", "spawnTags"]);
const FAMILY_FIELDS = new Set(["id", "technicalSignature", "generationType", "tiers"]);
const TIER_FIELDS = new Set(["modId", "technicalTier", "displayTiers", "requiredLevel", "spawnWeights", "generationWeights", "craftingSources", "regularItemClassIds", "specialItemClassIds", "requiredBaseTagsAny"]);
const MODIFIER_FIELDS = new Set(["id", "familyId", "generationType", "domain", "itemDomain", "statIds", "technicalTier", "displayTiers", "requiredLevel", "spawnWeights", "generationWeights", "spawnTags", "modGroups", "flags", "craftingSources", "regularItemClassIds", "specialItemClassIds", "requiredBaseTagsAny", "source"]);
const CRAFTING_SOURCE_FIELDS = new Set(["type", "sourceId"]);
const validatedFrozenCatalogs = new WeakSet();

export function isValidWeightRules(value) {
  return Array.isArray(value) && value.every(rule => isRecord(rule)
    && typeof rule.tag === "string" && rule.tag.length > 0
    && typeof rule.weight === "number" && Number.isFinite(rule.weight) && rule.weight >= 0
    && hasOnlyFields(rule, new Set(["tag", "weight"])));
}

const validNullableWeights = value => value === null || isValidWeightRules(value);
const validDisplayTiers = (value, itemClasses) => value === null || isRecord(value) && Object.entries(value).every(([itemClassId, tier]) => itemClasses[itemClassId]
  && Number.isInteger(tier) && tier >= 1);
const validCraftingSources = value => value === null || Array.isArray(value) && value.every(source => isRecord(source)
  && hasOnlyFields(source, CRAFTING_SOURCE_FIELDS) && isId(source.type) && isId(source.sourceId));

function validateTier(tier, path, catalog, familyId, key) {
  if (!isRecord(tier) || !hasExactFields(tier, TIER_FIELDS) || tier.modId !== key) invalid("Modifier-family tier is inconsistent.", path, { familyId, modId: tier?.modId ?? null });
  if (!validTier(tier.technicalTier, 1)) invalid("Family technical tier is invalid.", `${path}.technicalTier`, { value: tier.technicalTier });
  if (!validDisplayTiers(tier.displayTiers, catalog.itemClasses)) invalid("Family display tiers are invalid.", `${path}.displayTiers`);
  if (!validTier(tier.requiredLevel, 0)) invalid("Family required level is invalid.", `${path}.requiredLevel`, { value: tier.requiredLevel });
  if (!validNullableWeights(tier.spawnWeights) || !validNullableWeights(tier.generationWeights)) invalidCode(ENGINE_RULE_ERROR_CODES.INVALID_WEIGHT_STRUCTURE, "Family weight rules are invalid.", path);
  if (!validCraftingSources(tier.craftingSources)) invalid("Family crafting sources are invalid.", `${path}.craftingSources`);
  for (const field of ["regularItemClassIds", "specialItemClassIds", "requiredBaseTagsAny"])
    if (!validNullableIds(tier[field])) invalid("Family technical ID list is invalid.", `${path}.${field}`);
  for (const field of ["regularItemClassIds", "specialItemClassIds"]) for (const itemClassId of tier[field] ?? [])
    if (!catalog.itemClasses[itemClassId]) invalid("Family item-class reference is invalid.", `${path}.${field}`, { itemClassId });
}

export function validateModifierCatalog(catalog) {
  if (isRecord(catalog) && Object.isFrozen(catalog) && validatedFrozenCatalogs.has(catalog)) return catalog;
  if (!isRecord(catalog) || !hasExactFields(catalog, TOP_FIELDS) || catalog.schemaVersion !== 1 || !isRecord(catalog.itemClasses)
    || !isRecord(catalog.baseTypes) || !isRecord(catalog.modifiers) || !isRecord(catalog.families)
    || !validIds(catalog.knownDomains) || !validIds(catalog.knownGenerationTypes)) invalid("Modifier catalog has an unsupported structure.", "catalog");

  for (const key of Object.keys(catalog.itemClasses).sort()) {
    const entry = catalog.itemClasses[key];
    if (!isRecord(entry) || !hasExactFields(entry, ITEM_CLASS_FIELDS) || entry.id !== key) invalid("Item-class entry is inconsistent.", `catalog.itemClasses.${key}`, { key, id: entry?.id ?? null });
  }
  for (const key of Object.keys(catalog.baseTypes).sort()) {
    const entry = catalog.baseTypes[key];
    if (!isRecord(entry) || !hasExactFields(entry, BASE_TYPE_FIELDS) || entry.id !== key || !isId(entry.itemClassId)
      || !catalog.itemClasses[entry.itemClassId] || !validNullableIds(entry.spawnTags)) invalid("Base-type entry is inconsistent.", `catalog.baseTypes.${key}`, { key });
  }
  for (const key of Object.keys(catalog.families).sort()) {
    const entry = catalog.families[key];
    const path = `catalog.families.${key}`;
    if (!isRecord(entry) || !hasExactFields(entry, FAMILY_FIELDS) || entry.id !== key || !isNullableId(entry.technicalSignature)
      || !isNullableId(entry.generationType) || entry.generationType !== null && !catalog.knownGenerationTypes.includes(entry.generationType)
      || !isRecord(entry.tiers)) invalid("Modifier-family entry is inconsistent.", path, { key });
    for (const tierKey of Object.keys(entry.tiers).sort()) validateTier(entry.tiers[tierKey], `${path}.tiers.${tierKey}`, catalog, key, tierKey);
  }
  for (const key of Object.keys(catalog.modifiers).sort()) {
    const entry = catalog.modifiers[key];
    const path = `catalog.modifiers.${key}`;
    if (!isRecord(entry) || !hasExactFields(entry, MODIFIER_FIELDS) || entry.id !== key) invalid("Modifier entry is inconsistent.", path, { key, id: entry?.id ?? null });
    if (entry.familyId !== null && (!isId(entry.familyId) || !catalog.families[entry.familyId] || !catalog.families[entry.familyId].tiers[key])) invalid("Modifier family reference is invalid.", `${path}.familyId`, { familyId: entry.familyId });
    if (!validIds(entry.statIds)) invalid("Modifier stat IDs are invalid.", `${path}.statIds`);
    if (!validTier(entry.technicalTier, 1)) invalid("Modifier technical tier is invalid.", `${path}.technicalTier`, { value: entry.technicalTier });
    if (!validDisplayTiers(entry.displayTiers, catalog.itemClasses)) invalid("Modifier display tiers are invalid.", `${path}.displayTiers`);
    if (!validTier(entry.requiredLevel, 0)) invalid("Modifier required level is invalid.", `${path}.requiredLevel`, { value: entry.requiredLevel });
    if (!validNullableWeights(entry.spawnWeights)) invalidCode(ENGINE_RULE_ERROR_CODES.INVALID_WEIGHT_STRUCTURE, "Modifier spawn weights are invalid.", `${path}.spawnWeights`);
    if (!validNullableWeights(entry.generationWeights)) invalidCode(ENGINE_RULE_ERROR_CODES.INVALID_WEIGHT_STRUCTURE, "Modifier generation weights are invalid.", `${path}.generationWeights`);
    if (entry.generationType !== null && (!isId(entry.generationType) || !catalog.knownGenerationTypes.includes(entry.generationType))) invalidCode(ENGINE_RULE_ERROR_CODES.UNKNOWN_GENERATION_TYPE, "Modifier generation type is invalid.", `${path}.generationType`, { value: entry.generationType });
    for (const field of ["domain", "itemDomain"]) if (entry[field] !== null && (!isId(entry[field]) || !catalog.knownDomains.includes(entry[field]))) invalidCode(ENGINE_RULE_ERROR_CODES.UNKNOWN_MODIFIER_DOMAIN, "Modifier domain is invalid.", `${path}.${field}`, { value: entry[field] });
    for (const field of ["spawnTags", "modGroups", "regularItemClassIds", "specialItemClassIds", "requiredBaseTagsAny"])
      if (!validNullableIds(entry[field])) invalid("Modifier technical ID list is invalid.", `${path}.${field}`);
    if (entry.flags !== null && !validIds(entry.flags)) invalid("Modifier flags are invalid.", `${path}.flags`);
    if (!validCraftingSources(entry.craftingSources)) invalid("Modifier crafting sources are invalid.", `${path}.craftingSources`);
    if (entry.source !== null && !isId(entry.source)) invalid("Modifier source is invalid.", `${path}.source`, { value: entry.source });
    for (const field of ["regularItemClassIds", "specialItemClassIds"]) for (const itemClassId of entry[field] ?? [])
      if (!catalog.itemClasses[itemClassId]) invalid("Modifier item-class reference is invalid.", `${path}.${field}`, { itemClassId });
  }
  if (Object.isFrozen(catalog)) validatedFrozenCatalogs.add(catalog);
  return catalog;
}
