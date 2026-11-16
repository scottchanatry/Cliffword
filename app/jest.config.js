/**
 * Jest (jest-expo preset, iOS platform) for the app and the engine source it imports.
 *
 * - "@cliffword/engine" maps to ../engine/src/index.ts, the same file Metro and tsc use.
 * - Every .js/.ts/.tsx file, inside the app or under ../engine, goes through babel-jest with
 *   this app's babel.config.js named explicitly (configFile), so engine files outside the
 *   app root get the same preset. cwd/root stay the app directory.
 * - transformIgnorePatterns: node_modules are not transformed except React Native, Expo and
 *   the other packages that ship untranspiled ESM/Flow.
 * - Tests live in __tests__/ (routes; never under app/app, which expo-router would read as
 *   routes) and next to modules in src/ as *.test.ts(x).
 */
const path = require('path');

const appRoot = __dirname;

// babel-jest 30 from jest-expo (the hoisted copy is 29, from @react-native/jest-preset).
const babelJest = require.resolve('babel-jest', {
  paths: [path.dirname(require.resolve('jest-expo/package.json', { paths: [appRoot] }))],
});

/**
 * jest-expo's transformIgnorePatterns (kept in sync with the preset) plus packages this
 * app adds that ship untranspiled code.
 */
function transformIgnorePatterns() {
  const extra = ['llama\\.rn', '@lomray'];
  const preset = require('jest-expo/jest-preset').transformIgnorePatterns;
  return preset.map((pattern) =>
    pattern.startsWith('/node_modules/(?!(') ? pattern.replace('/node_modules/(?!(', `/node_modules/(?!(${extra.join('|')}|`) : pattern,
  );
}

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  rootDir: appRoot,
  setupFiles: ['<rootDir>/jest.setup.ts'],
  // Reanimated 4 / Worklets: resolve their web files in Jest (with the worklets mock in jest.setup.ts).
  resolver: require.resolve('react-native-reanimated/jest/resolver', { paths: [appRoot] }),
  testMatch: ['<rootDir>/__tests__/**/*.test.[jt]s?(x)', '<rootDir>/src/**/*.test.[jt]s?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/dist-', '<rootDir>/../engine/'],
  // Bare imports from ../engine files (Babel's @babel/runtime helpers) resolve from the app's
  // node_modules, like Metro's resolver.nodeModulesPaths.
  modulePaths: ['<rootDir>/node_modules'],
  moduleNameMapper: {
    '^@cliffword/engine$': '<rootDir>/../engine/src/index.ts',
  },
  transform: {
    '\\.[jt]sx?$': [
      babelJest,
      {
        cwd: appRoot,
        root: appRoot,
        configFile: path.join(appRoot, 'babel.config.js'),
        babelrc: false,
        caller: { name: 'metro', bundler: 'jest', platform: 'ios' },
      },
    ],
  },
  transformIgnorePatterns: transformIgnorePatterns(),
};
