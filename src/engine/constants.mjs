import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CURRENT_MAX_ITEM_LEVEL } = require("../../app-config.js");

export const ITEM_STATE_SCHEMA_VERSION = 1;
export { CURRENT_MAX_ITEM_LEVEL };
export const ENGINE_RARITIES = Object.freeze(["normal", "magic", "rare", "unique"]);
export const MODIFIER_CATEGORIES = Object.freeze({
  prefixModifiers: Object.freeze(["prefix"]),
  suffixModifiers: Object.freeze(["suffix"]),
  implicitModifiers: Object.freeze(["implicit"]),
  craftedModifiers: Object.freeze(["prefix", "suffix"]),
  desecratedModifiers: Object.freeze(["prefix", "suffix"])
});
