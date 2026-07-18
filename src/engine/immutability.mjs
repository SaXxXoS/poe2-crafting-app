export function cloneEngineValue(value) {
  if (Array.isArray(value)) return value.map(cloneEngineValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneEngineValue(child)]));
}

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function immutableCopy(value) {
  return deepFreeze(cloneEngineValue(value));
}
