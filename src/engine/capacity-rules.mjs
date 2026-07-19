const DEFAULT_CAPACITY_RULES = Object.freeze({
  magic: Object.freeze({ prefix: 1, suffix: 1 }),
  rare: Object.freeze({ prefix: 3, suffix: 3 })
});

export function getDefaultCapacityRules() {
  return DEFAULT_CAPACITY_RULES;
}
