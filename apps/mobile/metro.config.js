/**
 * Metro, taught about the monorepo.
 *
 * Two non-default settings, both required for `@erp/shared` to resolve: Metro
 * has to *watch* the workspace root, because the package lives outside this
 * app's folder, and it has to look for modules in the root `node_modules` as
 * well as this app's own.
 *
 * `disableHierarchicalLookup` is deliberately **left off**. The Expo monorepo
 * guide suggests it, but it only works when npm hoists every dependency flat.
 * Here npm nests `expo-modules-core` under `expo/node_modules`, and disabling
 * the hierarchical walk makes it unresolvable — the bundle fails on the very
 * first import. Keeping the standard walk, plus the extra roots below, resolves
 * both the hoisted and the nested cases.
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/**
 * Pin React to this workspace's copy.
 *
 * The web app pins React 18 and this app needs React 19, so npm keeps two in
 * the tree: 18 hoisted to the repo root, 19 nested here. Resolution order
 * already favours the nested one, but "the array happens to be in the right
 * order" is not a guarantee — and two Reacts in one bundle fails at runtime
 * with an unrelated-looking hooks error. An explicit alias makes it a rule.
 */
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
};

// `@erp/shared` ships ESM behind an `exports` map; without this Metro falls
// back to `main` and misses the type/runtime condition split.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
