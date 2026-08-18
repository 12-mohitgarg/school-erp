/**
 * `@/...` imports are resolved from `tsconfig.json` `paths` by Expo's Metro
 * config, which has handled tsconfig path aliases natively since SDK 49 — so
 * no `module-resolver` plugin is needed, and there is no second place where an
 * alias could drift out of sync with the TypeScript one.
 */
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxRuntime: 'automatic' }]],
  };
};
