export const ENGINE_ERROR_CODES = Object.freeze({
  UNSUPPORTED_SCHEMA_VERSION: "ENGINE_UNSUPPORTED_SCHEMA_VERSION",
  INVALID_IDENTITY: "ENGINE_INVALID_IDENTITY",
  INVALID_ITEM_LEVEL: "ENGINE_INVALID_ITEM_LEVEL",
  INVALID_RARITY: "ENGINE_INVALID_RARITY",
  INVALID_REVISION: "ENGINE_INVALID_REVISION",
  INVALID_MODIFIER_LIST: "ENGINE_INVALID_MODIFIER_LIST",
  DUPLICATE_MODIFIER_INSTANCE: "ENGINE_DUPLICATE_MODIFIER_INSTANCE",
  INVALID_MODIFIER: "ENGINE_INVALID_MODIFIER",
  INVALID_HISTORY: "ENGINE_INVALID_HISTORY",
  INVALID_STATE: "ENGINE_INVALID_STATE",
  UNKNOWN_ENGINE_FIELD: "ENGINE_UNKNOWN_FIELD"
});

export class EngineValidationError extends Error {
  constructor(code, message, path = "", details = {}) {
    super(message);
    this.name = "EngineValidationError";
    this.code = code;
    this.path = path;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, path: this.path, details: this.details };
  }
}

export function engineError(code, message, path, details) {
  return new EngineValidationError(code, message, path, details);
}
