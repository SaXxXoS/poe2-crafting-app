import { EXILEFORGE_CONFIG } from "./app-config-values.mjs";

globalThis.EXILEFORGE_CONFIG = EXILEFORGE_CONFIG;
await import("./app.js");
