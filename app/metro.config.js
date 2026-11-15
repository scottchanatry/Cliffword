/**
 * Metro for the app plus the engine package next to it (../engine, plain TypeScript,
 * "main": "src/index.ts", zero runtime dependencies).
 *
 * - getDefaultConfig keeps every Expo default (asset exts, web support, tsconfig paths).
 * - watchFolders adds ../engine so Metro can see, transform (via babel.config.js) and
 *   hot-reload engine files. "@cliffword/engine" resolves to ../engine/src/index.ts through
 *   the tsconfig "paths" entry (Expo resolves tsconfig paths) and, equally, through the
 *   node_modules/@cliffword/engine symlink that the "file:../engine" dependency creates.
 * - nodeModulesPaths makes any bare import from an engine file resolve from the app's
 *   node_modules, so one copy of each package exists in the bundle. (The engine has no runtime
 *   dependencies; its only bare imports are the @babel/runtime helpers Babel injects.)
 * - blockList hides ../engine/node_modules (vitest and friends) and the engine's tests from
 *   Metro's file map. This is load-bearing, not just tidy: Metro resolves only files in its file
 *   map, so a lookup from an engine file never stops in ../engine/node_modules (even if a dev
 *   tool there ships its own @babel/runtime) and falls through to nodeModulesPaths. Folders
 *   outside the project and watchFolders (a node_modules at the repo root) are not in the file
 *   map either.
 */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const engineRoot = path.resolve(projectRoot, '../engine');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), engineRoot];

config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

// A path as a regex source that matches either separator.
const escape = (p) =>
  p
    .split(path.sep)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[/\\\\]');
const engineBlocks = [
  new RegExp(`^${escape(path.join(engineRoot, 'node_modules'))}[/\\\\].*`),
  new RegExp(`^${escape(path.join(engineRoot, 'test'))}[/\\\\].*`),
  new RegExp(`^${escape(engineRoot)}[/\\\\].*\\.test\\.ts$`),
];
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  ...engineBlocks,
];

module.exports = config;
