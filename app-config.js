(function exposeExileForgeConfig(root) {
  const config = Object.freeze({ CURRENT_MAX_ITEM_LEVEL: 86 });
  root.EXILEFORGE_CONFIG = config;
  if (typeof module !== 'undefined' && module.exports) module.exports = config;
})(typeof globalThis !== 'undefined' ? globalThis : window);
