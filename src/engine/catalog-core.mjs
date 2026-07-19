import { validateModifierCatalog } from "./catalog-validation.mjs";
import { ENGINE_RULE_ERROR_CODES, engineError } from "./errors.mjs";
import { immutableCopy } from "./immutability.mjs";

const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const compareTechnicalIds = (left, right) => left === right ? 0 : left < right ? -1 : 1;
const id = (value, location) => {
  if (typeof value !== "string" || !value.trim()) throw engineError(ENGINE_RULE_ERROR_CODES.INVALID_CATALOG_DATA, "Catalog technical ID is missing.", location, { value });
  return value;
};
const sortedUnique = values => [...new Set(values.filter(value => typeof value === "string" && value.length))].sort();
const normalizeIds = (value, location) => {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some(entry => typeof entry !== "string" || !entry.length)) throw engineError(ENGINE_RULE_ERROR_CODES.INVALID_CATALOG_DATA, "Catalog technical ID list is invalid.", location, { value });
  return sortedUnique(value);
};
const normalizeWeights = value => value === undefined ? null : Array.isArray(value) ? value.map(rule => isRecord(rule) ? { tag: rule.tag, weight: rule.weight } : rule) : value;

export function createModifierCatalog({ index, bases, mods, affixGroups }) {
  if (!isRecord(index) || !Array.isArray(index.classes) || !Array.isArray(bases?.bases) || !Array.isArray(mods?.mods) || !Array.isArray(affixGroups?.groups)) throw engineError(ENGINE_RULE_ERROR_CODES.INVALID_CATALOG_DATA, "Catalog documents have an unsupported structure.", "catalog");
  const itemClasses = Object.fromEntries(index.classes.map((row, position) => [id(row.id, `index.classes[${position}].id`), { id: row.id }]).sort(([a], [b]) => compareTechnicalIds(a, b)));
  const baseTypes = Object.fromEntries(bases.bases.map((row, position) => [id(row.id, `bases.bases[${position}].id`), {
    id: row.id,
    itemClassId: id(row.itemClass, `bases.bases[${position}].itemClass`),
    spawnTags: normalizeIds(row.tags, `bases.bases[${position}].tags`)
  }]).sort(([a], [b]) => compareTechnicalIds(a, b)));

  const familyByMod = new Map();
  const families = {};
  for (const [familyIndex, family] of affixGroups.groups.entries()) {
    const familyId = id(family.familyId, `affixGroups.groups[${familyIndex}].familyId`);
    const tiers = {};
    for (const [tierIndex, tier] of (family.tiers ?? []).entries()) {
      const modId = id(tier.modId, `affixGroups.groups[${familyIndex}].tiers[${tierIndex}].modId`);
      const normalizedTier = {
        modId,
        technicalTier: tier.technicalTier ?? null,
        displayTiers: tier.displayTiers === undefined ? null : tier.displayTiers,
        requiredLevel: tier.requiredLevel ?? null,
        spawnWeights: normalizeWeights(tier.spawnWeights),
        generationWeights: normalizeWeights(tier.generationWeights),
        craftingSources: Array.isArray(tier.craftingSources) ? tier.craftingSources : tier.craftingSources ?? null,
        regularItemClassIds: normalizeIds(tier.regularClasses, `affixGroups.groups[${familyIndex}].tiers[${tierIndex}].regularClasses`),
        specialItemClassIds: normalizeIds(tier.specialClasses, `affixGroups.groups[${familyIndex}].tiers[${tierIndex}].specialClasses`),
        requiredBaseTagsAny: normalizeIds(tier.requiredBaseTagsAny, `affixGroups.groups[${familyIndex}].tiers[${tierIndex}].requiredBaseTagsAny`)
      };
      tiers[modId] = normalizedTier;
      const previous = familyByMod.get(modId);
      if (previous && previous !== familyId) throw engineError(ENGINE_RULE_ERROR_CODES.INVALID_CATALOG_DATA, "Modifier belongs to multiple technical families.", `affixGroups.groups[${familyIndex}]`, { modId, families: [previous, familyId] });
      familyByMod.set(modId, familyId);
    }
    families[familyId] = { id: familyId, technicalSignature: family.technicalSignature ?? null, generationType: family.generationType ?? null, tiers: Object.fromEntries(Object.entries(tiers).sort(([a], [b]) => compareTechnicalIds(a, b))) };
  }

  const modifiers = {};
  for (const [position, row] of mods.mods.entries()) {
    const modId = id(row.modId ?? row.id, `mods.mods[${position}].modId`);
    if (modifiers[modId]) throw engineError(ENGINE_RULE_ERROR_CODES.INVALID_CATALOG_DATA, "Duplicate modifier ID.", `mods.mods[${position}]`, { modId });
    const familyId = familyByMod.get(modId) ?? null;
    const familyTier = familyId ? families[familyId].tiers[modId] : null;
    const spawnWeights = familyTier?.spawnWeights ?? normalizeWeights(row.spawnWeights);
    modifiers[modId] = {
      id: modId,
      familyId,
      generationType: row.generationType ?? null,
      domain: row.domain ?? null,
      itemDomain: row.itemDomain ?? null,
      statIds: Array.isArray(row.technicalStats) ? row.technicalStats.map((stat, statIndex) => id(stat?.id, `mods.mods[${position}].technicalStats[${statIndex}].id`)) : null,
      technicalTier: familyTier?.technicalTier ?? row.tier ?? null,
      displayTiers: familyTier?.displayTiers ?? null,
      requiredLevel: familyTier?.requiredLevel ?? row.requiredLevel ?? null,
      spawnWeights,
      generationWeights: familyTier?.generationWeights ?? normalizeWeights(row.generationWeights),
      spawnTags: Array.isArray(spawnWeights) ? sortedUnique(spawnWeights.map(rule => rule?.tag)) : null,
      modGroups: row.groups !== undefined ? normalizeIds(row.groups, `mods.mods[${position}].groups`) : row.group !== undefined ? [id(row.group, `mods.mods[${position}].group`)] : null,
      flags: row.flags === undefined ? null : row.flags,
      craftingSources: familyTier?.craftingSources ?? null,
      regularItemClassIds: familyTier?.regularItemClassIds ?? null,
      specialItemClassIds: familyTier?.specialItemClassIds ?? null,
      requiredBaseTagsAny: familyTier?.requiredBaseTagsAny ?? null,
      source: row.source ?? null
    };
  }

  const catalog = {
    schemaVersion: 1,
    itemClasses,
    baseTypes,
    modifiers: Object.fromEntries(Object.entries(modifiers).sort(([a], [b]) => compareTechnicalIds(a, b))),
    families: Object.fromEntries(Object.entries(families).sort(([a], [b]) => compareTechnicalIds(a, b))),
    knownDomains: sortedUnique(Object.values(modifiers).flatMap(modifier => [modifier.domain, modifier.itemDomain])),
    knownGenerationTypes: sortedUnique(Object.values(modifiers).map(modifier => modifier.generationType))
  };
  validateModifierCatalog(catalog);
  return immutableCopy(catalog);
}

export function getModifierDisplayTier(catalog, modId, itemClassId) {
  if (typeof itemClassId !== "string" || !itemClassId) throw engineError(ENGINE_RULE_ERROR_CODES.DISPLAY_TIER_CONTEXT_REQUIRED, "displayTier requires an item-class context.", "itemClassId", { modId });
  const modifier = catalog.modifiers[modId];
  if (!modifier) throw engineError(ENGINE_RULE_ERROR_CODES.UNKNOWN_MODIFIER, "Modifier is not present in the catalog.", "modId", { modId });
  return modifier.displayTiers?.[itemClassId] ?? null;
}
