import { ENGINE_RULE_ERROR_CODES, engineError } from "./errors.mjs";

const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isId = value => typeof value === "string" && value.length > 0;
const validIds = value => Array.isArray(value) && value.every(isId);
const validWeights = value => value === null || Array.isArray(value) && value.every(rule => isRecord(rule)
  && typeof rule.tag === "string" && rule.tag.length > 0 && Number.isFinite(rule.weight) && rule.weight >= 0
  && Object.keys(rule).every(key => key === "tag" || key === "weight"));
const invalid = (message, path, details = {}) => { throw engineError(ENGINE_RULE_ERROR_CODES.INVALID_CATALOG_DATA, message, path, details); };

export function validateModifierCatalog(catalog) {
  if (!isRecord(catalog) || catalog.schemaVersion !== 1 || !isRecord(catalog.itemClasses) || !isRecord(catalog.baseTypes)
    || !isRecord(catalog.modifiers) || !isRecord(catalog.families) || !validIds(catalog.knownDomains)
    || !validIds(catalog.knownGenerationTypes)) invalid("Modifier catalog has an unsupported structure.", "catalog");

  for (const key of Object.keys(catalog.itemClasses).sort()) {
    const entry = catalog.itemClasses[key];
    if (!isRecord(entry) || entry.id !== key) invalid("Item-class entry is inconsistent.", `catalog.itemClasses.${key}`, { key, id: entry?.id ?? null });
  }
  for (const key of Object.keys(catalog.baseTypes).sort()) {
    const entry = catalog.baseTypes[key];
    if (!isRecord(entry) || entry.id !== key || !isId(entry.itemClassId) || !catalog.itemClasses[entry.itemClassId]
      || entry.spawnTags !== null && !validIds(entry.spawnTags)) invalid("Base-type entry is inconsistent.", `catalog.baseTypes.${key}`, { key });
  }
  for (const key of Object.keys(catalog.families).sort()) {
    const entry = catalog.families[key];
    if (!isRecord(entry) || entry.id !== key || !isRecord(entry.tiers)) invalid("Modifier-family entry is inconsistent.", `catalog.families.${key}`, { key });
  }
  for (const key of Object.keys(catalog.modifiers).sort()) {
    const entry = catalog.modifiers[key];
    if (!isRecord(entry) || entry.id !== key) invalid("Modifier entry is inconsistent.", `catalog.modifiers.${key}`, { key, id: entry?.id ?? null });
    if (entry.familyId !== null && (!isId(entry.familyId) || !catalog.families[entry.familyId])) invalid("Modifier family reference is invalid.", `catalog.modifiers.${key}.familyId`, { familyId: entry.familyId });
    if (!validIds(entry.statIds)) invalid("Modifier stat IDs are invalid.", `catalog.modifiers.${key}.statIds`);
    if (entry.technicalTier !== null && (!Number.isInteger(entry.technicalTier) || entry.technicalTier < 1)) invalid("Modifier technical tier is invalid.", `catalog.modifiers.${key}.technicalTier`, { value: entry.technicalTier });
    if (entry.requiredLevel !== null && (!Number.isInteger(entry.requiredLevel) || entry.requiredLevel < 0)) invalid("Modifier required level is invalid.", `catalog.modifiers.${key}.requiredLevel`, { value: entry.requiredLevel });
    if (!validWeights(entry.spawnWeights)) invalid("Modifier spawn weights are invalid.", `catalog.modifiers.${key}.spawnWeights`);
    if (!validWeights(entry.generationWeights)) invalid("Modifier generation weights are invalid.", `catalog.modifiers.${key}.generationWeights`);
    if (entry.generationType !== null && (!isId(entry.generationType) || !catalog.knownGenerationTypes.includes(entry.generationType))) invalid("Modifier generation type is invalid.", `catalog.modifiers.${key}.generationType`, { value: entry.generationType });
    for (const field of ["domain", "itemDomain"]) if (entry[field] !== null && (!isId(entry[field]) || !catalog.knownDomains.includes(entry[field]))) invalid("Modifier domain is invalid.", `catalog.modifiers.${key}.${field}`, { value: entry[field] });
    for (const field of ["spawnTags", "modGroups", "regularItemClassIds", "specialItemClassIds", "requiredBaseTagsAny"])
      if (entry[field] !== null && !validIds(entry[field])) invalid("Modifier technical ID list is invalid.", `catalog.modifiers.${key}.${field}`);
    for (const field of ["regularItemClassIds", "specialItemClassIds"]) for (const itemClassId of entry[field] ?? [])
      if (!catalog.itemClasses[itemClassId]) invalid("Modifier item-class reference is invalid.", `catalog.modifiers.${key}.${field}`, { itemClassId });
  }
  return catalog;
}
