/**
 * One Babel config for Metro (iOS, Android, web) and Jest.
 *
 * babel.config.js is a project-wide ("root") config: it applies to every file compiled with
 * this directory as Babel's root, including ../engine/src, which lives outside the app
 * package. (A .babelrc would not reach it.) babel-preset-expo strips the engine's TypeScript
 * and, because react-native-worklets is installed, adds the worklets plugin that
 * react-native-reanimated 4 needs; no separate reanimated plugin entry.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
