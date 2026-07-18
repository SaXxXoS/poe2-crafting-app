import { ENGINE_ELIGIBILITY_CODES, ENGINE_RULE_ERROR_CODES } from "./errors.mjs";
import { immutableCopy } from "./immutability.mjs";
import { createRuleContext } from "./rule-context.mjs";
import { evaluateRuleSets } from "./rule-evaluation.mjs";

export const ELIGIBILITY_RULES = Object.freeze([
  "itemClass", "baseType", "itemLevel", "generationType", "source", "domain",
  "tags", "weights", "existingModifiers", "capacity"
]);
export const REGULAR_MODIFIER_MODE = "regular";

const SPECIAL_SOURCES = new Set(["crafted", "essence", "desecrated", "desecration"]);
const REGULAR_SOURCES = new Set(["normal", "poe2db"]);
const REGULAR_GENERATION_TYPES = new Set(["prefix", "suffix"]);
const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const validWeights = value => Array.isArray(value) && value.every(rule => isRecord(rule)
  && typeof rule.tag === "string" && rule.tag.length > 0 && Number.isFinite(rule.weight) && rule.weight >= 0
  && Object.keys(rule).every(key => key === "tag" || key === "weight"));
const reason = (code, outcome, message, rule, path, details = {}) => ({ code, outcome, message, rule, path, details });
const compareReasons = (a, b) => [a.rule, a.code, a.path].join("\0").localeCompare([b.rule, b.code, b.path].join("\0"));
const compareCandidates = (a, b) => [a.generationType ?? "", a.modifierId, a.technicalTier ?? 0].join("\0").localeCompare([b.generationType ?? "", b.modifierId, b.technicalTier ?? 0].join("\0"));

function emptyResult(error, itemState) {
  return immutableCopy({
    valid: false,
    contextSummary: itemState ? { itemId: itemState.itemId ?? null, itemClassId: itemState.itemClassId ?? null, baseTypeId: itemState.baseTypeId ?? null, itemLevel: itemState.itemLevel ?? null, mode: REGULAR_MODIFIER_MODE } : null,
    candidateCount: 0, eligible: [], ineligible: [], unresolved: [], errors: [error], warnings: [],
    evaluatedRules: [], summary: { total: 0, eligibleCount: 0, ineligibleCount: 0, unresolvedCount: 0, prefixEligibleCount: 0, suffixEligibleCount: 0 }
  });
}

function firstWeight(rules, tags, emptyFallback) {
  if (rules === null || rules === undefined) return { state: "missing", weight: null, matchedTag: null };
  if (!validWeights(rules)) return { state: "invalid", weight: null, matchedTag: null };
  if (!rules.length) return { state: "matched", weight: emptyFallback, matchedTag: null };
  const tagSet = new Set(tags);
  const match = rules.find(rule => tagSet.has(rule.tag));
  return match ? { state: "matched", weight: match.weight, matchedTag: match.tag } : { state: "noMatch", weight: null, matchedTag: null };
}

function existingModifiers(itemState) {
  return [...itemState.prefixModifiers, ...itemState.suffixModifiers, ...itemState.craftedModifiers, ...itemState.desecratedModifiers];
}

function evaluateCandidate(modifier, context, options) {
  const { itemState, catalog, itemClassId, baseTypeId, itemLevel } = context;
  const base = catalog.baseTypes[baseTypeId];
  const reasons = [];
  const errors = [];
  const add = (...args) => reasons.push(reason(...args));
  const technicalEvaluation = evaluateRuleSets(createRuleContext({
    itemState, catalog, actionContext: { ...context.actionContext, modId: modifier.id }
  }));
  for (const technicalError of technicalEvaluation.errors.filter(entry => entry.code === ENGINE_RULE_ERROR_CODES.INVALID_CATALOG_DATA)) {
    const catalogError = reason(ENGINE_ELIGIBILITY_CODES.CATALOG_INVALID, "unresolved", technicalError.message, "catalog", technicalError.path, technicalError.details);
    reasons.push(catalogError); errors.push(catalogError);
  }
  const classes = modifier.regularItemClassIds;
  if (classes === null) add(ENGINE_ELIGIBILITY_CODES.ITEM_CLASS_UNRESOLVED, "unresolved", "Regular item-class compatibility is not present.", "itemClass", "catalog.modifiers.regularItemClassIds", { modifierId: modifier.id });
  else if (!classes.includes(itemClassId)) add(ENGINE_ELIGIBILITY_CODES.ITEM_CLASS_MISMATCH, "fail", "Modifier is not in the regular pool for this item class.", "itemClass", "itemClassId", { itemClassId, allowedItemClassIds: classes });
  else add("ENGINE_ELIGIBILITY_ITEM_CLASS_MATCH", "pass", "Modifier belongs to the regular item-class pool.", "itemClass", "itemClassId", { itemClassId });

  const requiredTags = modifier.requiredBaseTagsAny;
  if (requiredTags?.length && !requiredTags.some(tag => base.spawnTags?.includes(tag))) add(ENGINE_ELIGIBILITY_CODES.BASE_TYPE_MISMATCH, "fail", "Base type does not satisfy the structured base-tag restriction.", "baseType", "catalog.modifiers.requiredBaseTagsAny", { requiredTags, baseTags: base.spawnTags });
  else add("ENGINE_ELIGIBILITY_BASE_TYPE_MATCH", "pass", "No structured base restriction excludes the base type.", "baseType", "baseTypeId", { baseTypeId });

  if (modifier.requiredLevel === null) add(ENGINE_ELIGIBILITY_CODES.ITEM_LEVEL_UNRESOLVED, "unresolved", "Modifier item-level requirement is missing.", "itemLevel", "catalog.modifiers.requiredLevel", { requiredLevel: null });
  else if (!Number.isInteger(modifier.requiredLevel) || modifier.requiredLevel < 0) {
    const catalogError = reason(ENGINE_ELIGIBILITY_CODES.CATALOG_INVALID, "unresolved", "Modifier item-level requirement has an invalid structure.", "itemLevel", "catalog.modifiers.requiredLevel", { requiredLevel: modifier.requiredLevel });
    reasons.push(catalogError); errors.push(catalogError);
  }
  else if (itemLevel < modifier.requiredLevel) add(ENGINE_ELIGIBILITY_CODES.ITEM_LEVEL_NOT_MET, "fail", "Item level is below the modifier requirement.", "itemLevel", "itemLevel", { itemLevel, requiredLevel: modifier.requiredLevel });
  else add("ENGINE_ELIGIBILITY_ITEM_LEVEL_MET", "pass", "Item-level requirement is met.", "itemLevel", "itemLevel", { itemLevel, requiredLevel: modifier.requiredLevel });

  if (modifier.generationType === null || !catalog.knownGenerationTypes.includes(modifier.generationType)) add(ENGINE_ELIGIBILITY_CODES.GENERATION_TYPE_UNRESOLVED, "unresolved", "Generation type is missing or unknown.", "generationType", "catalog.modifiers.generationType", { generationType: modifier.generationType });
  else if (!REGULAR_GENERATION_TYPES.has(modifier.generationType)) add(ENGINE_ELIGIBILITY_CODES.GENERATION_TYPE_EXCLUDED, "fail", "Generation type is not a regular prefix or suffix.", "generationType", "catalog.modifiers.generationType", { generationType: modifier.generationType });
  else add("ENGINE_ELIGIBILITY_GENERATION_TYPE_REGULAR", "pass", "Generation type is regular.", "generationType", "catalog.modifiers.generationType", { generationType: modifier.generationType });

  const source = modifier.source?.toLowerCase() ?? null;
  const specialOnly = source !== null && SPECIAL_SOURCES.has(source) || classes?.length === 0 && (modifier.craftingSources?.length ?? 0) > 0;
  if (specialOnly) add(ENGINE_ELIGIBILITY_CODES.SPECIAL_SOURCE_EXCLUDED, "fail", "Special crafting source is excluded from the regular pool.", "source", "catalog.modifiers.source", { source: modifier.source, craftingSources: modifier.craftingSources });
  else if (!REGULAR_SOURCES.has(source)) add(ENGINE_ELIGIBILITY_CODES.SPECIAL_SOURCE_EXCLUDED, "unresolved", "Technical source is missing or not recognized as a regular source.", "source", "catalog.modifiers.source", { source: modifier.source, status: source === null ? "notPresent" : "presentUnknown" });
  else add("ENGINE_ELIGIBILITY_SOURCE_REGULAR", "pass", "Technical source is recognized as regular.", "source", "catalog.modifiers.source", { source: modifier.source });

  if (modifier.domain === null) {
    if (options.requireDomain === true) add(ENGINE_ELIGIBILITY_CODES.DOMAIN_UNRESOLVED, "unresolved", "Domain is required by the caller but absent.", "domain", "catalog.modifiers.domain", { status: "notPresent" });
    else add(ENGINE_ELIGIBILITY_CODES.DOMAIN_NOT_REQUIRED, "pass", "Domain is absent but not required because structured class and weight rules determine regular-pool compatibility.", "domain", "catalog.modifiers.domain", { status: "notPresent" });
  } else if (technicalEvaluation.errors.some(entry => entry.code === ENGINE_RULE_ERROR_CODES.UNKNOWN_MODIFIER_DOMAIN)) add(ENGINE_ELIGIBILITY_CODES.DOMAIN_UNRESOLVED, "unresolved", "Present domain is unknown.", "domain", "catalog.modifiers.domain", { status: "presentUnknown", domain: modifier.domain });
  else add("ENGINE_ELIGIBILITY_DOMAIN_KNOWN", "pass", "Domain is known.", "domain", "catalog.modifiers.domain", { domain: modifier.domain });

  if (base.spawnTags === null) add(ENGINE_ELIGIBILITY_CODES.TAG_DATA_MISSING, "unresolved", "Base spawn tags are missing.", "tags", "catalog.baseTypes.spawnTags", { baseTypeId });
  else add("ENGINE_ELIGIBILITY_TAG_DATA_PRESENT", "pass", "Base spawn tags are available.", "tags", "catalog.baseTypes.spawnTags", { tags: base.spawnTags });

  const spawn = firstWeight(modifier.spawnWeights, base.spawnTags ?? [], 0);
  const generation = firstWeight(modifier.generationWeights, base.spawnTags ?? [], 1);
  for (const [field, resolved] of [["spawnWeights", spawn], ["generationWeights", generation]]) {
    if (resolved.state === "invalid" || technicalEvaluation.errors.some(entry => entry.code === ENGINE_RULE_ERROR_CODES.INVALID_WEIGHT_STRUCTURE && entry.path.endsWith(field))) {
      const catalogError = reason(ENGINE_ELIGIBILITY_CODES.CATALOG_INVALID, "unresolved", "Weight structure is invalid.", "weights", `catalog.modifiers.${field}`, { modifierId: modifier.id, field });
      reasons.push(catalogError); errors.push(catalogError);
    } else if (resolved.state === "missing") add(ENGINE_ELIGIBILITY_CODES.WEIGHT_MISSING, "unresolved", "Weight structure is missing.", "weights", `catalog.modifiers.${field}`, { field, status: "notPresent" });
    else if (resolved.state === "noMatch") add(ENGINE_ELIGIBILITY_CODES.TAG_MISMATCH, "fail", "No weight rule matches the base tags.", "weights", `catalog.modifiers.${field}`, { field, baseTags: base.spawnTags });
    else if (resolved.weight === 0) add(ENGINE_ELIGIBILITY_CODES.ZERO_WEIGHT, "fail", "Applicable weight is explicitly zero.", "weights", `catalog.modifiers.${field}`, { field, matchedTag: resolved.matchedTag, weight: 0 });
    else add("ENGINE_ELIGIBILITY_POSITIVE_WEIGHT", "pass", "Applicable weight is positive.", "weights", `catalog.modifiers.${field}`, { field, matchedTag: resolved.matchedTag, weight: resolved.weight });
  }

  const existing = existingModifiers(itemState);
  if (existing.some(instance => instance.modId === modifier.id)) add(ENGINE_ELIGIBILITY_CODES.DUPLICATE_MODIFIER, "fail", "Identical modifier already exists on the item.", "existingModifiers", "itemState", { modifierId: modifier.id });
  const candidateGroups = modifier.modGroups;
  if (existing.length && (candidateGroups === null || !candidateGroups.length)) add(ENGINE_ELIGIBILITY_CODES.MOD_GROUP_UNRESOLVED, "unresolved", "Candidate mod-group data is missing while existing modifiers require conflict evaluation.", "existingModifiers", "catalog.modifiers.modGroups", { modifierId: modifier.id });
  else {
    const conflict = existing.find(instance => {
      const existingCatalog = catalog.modifiers[instance.modId];
      return existingCatalog?.modGroups?.some(group => candidateGroups?.includes(group));
    });
    const missingExistingGroup = existing.some(instance => !catalog.modifiers[instance.modId]?.modGroups?.length);
    if (conflict) add(ENGINE_ELIGIBILITY_CODES.MOD_GROUP_CONFLICT, "fail", "An existing modifier has the same technical mod group.", "existingModifiers", "catalog.modifiers.modGroups", { existingModifierId: conflict.modId, groups: candidateGroups });
    else if (missingExistingGroup) add(ENGINE_ELIGIBILITY_CODES.MOD_GROUP_UNRESOLVED, "unresolved", "An existing modifier lacks catalog mod-group data.", "existingModifiers", "itemState", {});
    else add("ENGINE_ELIGIBILITY_MOD_GROUP_CLEAR", "pass", "No technical mod-group conflict was found.", "existingModifiers", "itemState", {});
  }

  const capacity = options.capacityRules?.[modifier.generationType];
  if (!Number.isInteger(capacity) || capacity < 0) add(ENGINE_ELIGIBILITY_CODES.CAPACITY_UNRESOLVED, "unresolved", "No reliable capacity rule was supplied.", "capacity", `options.capacityRules.${modifier.generationType}`, { generationType: modifier.generationType });
  else {
    const count = modifier.generationType === "prefix" ? itemState.prefixModifiers.length : itemState.suffixModifiers.length;
    if (count >= capacity) add(modifier.generationType === "prefix" ? ENGINE_ELIGIBILITY_CODES.PREFIX_CAPACITY_REACHED : ENGINE_ELIGIBILITY_CODES.SUFFIX_CAPACITY_REACHED, "fail", "Regular affix capacity is reached.", "capacity", `itemState.${modifier.generationType}Modifiers`, { count, capacity });
    else add("ENGINE_ELIGIBILITY_CAPACITY_AVAILABLE", "pass", "Explicit capacity rule permits another affix.", "capacity", `options.capacityRules.${modifier.generationType}`, { count, capacity });
  }

  reasons.sort(compareReasons);
  const hasCatalogError = errors.length > 0;
  const status = hasCatalogError ? "unresolved" : reasons.some(entry => entry.outcome === "fail") ? "ineligible" : reasons.some(entry => entry.outcome === "unresolved") ? "unresolved" : "eligible";
  const applicableWeight = spawn.state === "matched" && generation.state === "matched" ? { spawn: spawn.weight, generation: generation.weight, spawnTag: spawn.matchedTag, generationTag: generation.matchedTag } : null;
  return {
    candidate: {
      modifierId: modifier.id, status, generationType: modifier.generationType, source: modifier.source,
      technicalTier: modifier.technicalTier, displayTier: modifier.displayTiers?.[itemClassId] ?? null,
      itemLevelRequirement: modifier.requiredLevel, applicableWeight, reasons, evaluatedRules: [...ELIGIBILITY_RULES],
      catalogReferences: {
        familyId: modifier.familyId, modGroups: modifier.modGroups, statIds: modifier.statIds,
        regularItemClassIds: modifier.regularItemClassIds, requiredBaseTagsAny: modifier.requiredBaseTagsAny,
        domain: modifier.domain, itemDomain: modifier.itemDomain, spawnTags: modifier.spawnTags, flags: modifier.flags
      }
    },
    errors
  };
}

export function resolveEligibleModifiers({ itemState, catalog, ruleContext = null, actionContext = {}, options = {} } = {}) {
  let context;
  try {
    context = ruleContext ?? createRuleContext({ itemState, catalog, actionContext });
    if (context.itemState !== itemState || context.catalog !== catalog) throw new Error("Rule context does not reference the supplied item state and catalog.");
    const baseEvaluation = evaluateRuleSets(createRuleContext({ itemState, catalog, actionContext }));
    const contextErrors = baseEvaluation.errors.filter(entry => entry.ruleSet === "identity");
    if (contextErrors.length) return emptyResult(reason(ENGINE_ELIGIBILITY_CODES.CONTEXT_INVALID, "unresolved", "Resolver context is invalid.", "context", contextErrors[0].path, { issues: contextErrors }), itemState);
  } catch (error) {
    return emptyResult(reason(ENGINE_ELIGIBILITY_CODES.CONTEXT_INVALID, "unresolved", error.message, "context", error.path ?? "context", { code: error.code ?? null, details: error.details ?? {} }), itemState);
  }

  const resolved = Object.values(catalog.modifiers).map(modifier => evaluateCandidate(modifier, context, options));
  const candidates = resolved.map(entry => entry.candidate).sort(compareCandidates);
  const eligible = candidates.filter(entry => entry.status === "eligible");
  const ineligible = candidates.filter(entry => entry.status === "ineligible");
  const unresolved = candidates.filter(entry => entry.status === "unresolved");
  const errors = resolved.flatMap(entry => entry.errors).sort(compareReasons);
  const warnings = candidates.flatMap(candidate => candidate.reasons.filter(entry => entry.outcome === "unresolved" && entry.code !== ENGINE_ELIGIBILITY_CODES.CATALOG_INVALID).map(entry => ({ ...entry, modifierId: candidate.modifierId }))).sort((a, b) => [a.modifierId, a.rule, a.code].join("\0").localeCompare([b.modifierId, b.rule, b.code].join("\0")));
  return immutableCopy({
    valid: errors.length === 0,
    contextSummary: { itemId: itemState.itemId, itemClassId: context.itemClassId, baseTypeId: context.baseTypeId, itemLevel: context.itemLevel, mode: REGULAR_MODIFIER_MODE },
    candidateCount: candidates.length, eligible, ineligible, unresolved, errors, warnings,
    evaluatedRules: [...ELIGIBILITY_RULES],
    summary: { total: candidates.length, eligibleCount: eligible.length, ineligibleCount: ineligible.length, unresolvedCount: unresolved.length, prefixEligibleCount: eligible.filter(entry => entry.generationType === "prefix").length, suffixEligibleCount: eligible.filter(entry => entry.generationType === "suffix").length }
  });
}
