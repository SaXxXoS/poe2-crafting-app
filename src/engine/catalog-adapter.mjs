import fs from "node:fs";
import path from "node:path";
import { createModifierCatalog } from "./catalog-core.mjs";

export { createModifierCatalog, getModifierDisplayTier } from "./catalog-core.mjs";

export function loadModifierCatalog(appDirectory = path.resolve("generated", "poe2db", "app")) {
  const read = file => JSON.parse(fs.readFileSync(path.join(appDirectory, file), "utf8"));
  const index = read("index.json");
  return createModifierCatalog({ index, bases: read("bases.json"), mods: read("mods.json"), affixGroups: read(index.affixGroupsFile ?? "affix-groups.json") });
}
