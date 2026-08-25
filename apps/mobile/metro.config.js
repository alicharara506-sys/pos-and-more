// Expo's default Metro config assumes a classic (non-pnpm) node_modules
// layout. pnpm hoists via symlinks into a content-addressed store, so
// Metro needs to be told explicitly to follow symlinks and to also look in
// the workspace root's node_modules for hoisted packages — this is Expo's
// documented pnpm-monorepo setup, not a project-specific hack.
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
