// Runs before each test file (after jest-expo's own setup).
import 'react-native-gesture-handler/jestSetup';

// Reanimated 4 in Jest: react-native-reanimated/jest/resolver (jest.config.js) loads its web
// implementation, and react-native-worklets is replaced by its own mock (no native runtime).
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
