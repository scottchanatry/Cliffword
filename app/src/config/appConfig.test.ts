/**
 * app.json's store-facing config: iOS 17.0 as the oldest iOS (docs/STORE.md decision 1), and the
 * icon, adaptive icon, splash, favicon and Play graphics from scripts/make-icons.js at the sizes
 * and PNG types the stores take (the App Store rejects an icon with alpha; Play wants a 32-bit
 * 512 icon and a feature graphic without alpha).
 */
import fs from 'fs';
import path from 'path';

const APP_ROOT = path.resolve(__dirname, '../..');

interface AppJson {
  expo: {
    icon: string;
    ios: { infoPlist: Record<string, unknown> };
    android: { adaptiveIcon: Record<string, string>; permissions: string[]; blockedPermissions: string[] };
    web: { favicon: string };
    plugins: (string | [string, Record<string, unknown>])[];
  };
}
const appJson = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'app.json'), 'utf8')) as AppJson;

const RGB = 2;
const RGBA = 6;

/** Width, height and color type from a PNG's IHDR chunk. */
function png(relative: string): { width: number; height: number; colorType: number } {
  const bytes = fs.readFileSync(path.join(APP_ROOT, relative));
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] ?? -1 };
}

function pluginOptions(name: string): Record<string, unknown> | undefined {
  for (const plugin of appJson.expo.plugins) if (Array.isArray(plugin) && plugin[0] === name) return plugin[1];
  return undefined;
}

describe('app.json', () => {
  it('builds no share extension and asks for no Apple Music access (Music is off in this build)', () => {
    const names = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).not.toContain('expo-share-intent');
    expect(JSON.stringify(appJson)).not.toMatch(/share-extension|appExtensions|group\.app\.cliffword/);
    expect(appJson.expo.ios.infoPlist).not.toHaveProperty('NSAppleMusicUsageDescription');
    expect(appJson.expo.ios.infoPlist).not.toHaveProperty('NSPhotoLibraryUsageDescription');
    // Neither native module is linked: no share-intent module, no MusicKit code in the binary.
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')) as { expo?: { autolinking?: { exclude?: string[] } } };
    expect(pkg.expo?.autolinking?.exclude).toEqual(expect.arrayContaining(['expo-share-intent', 'cliffword-music']));
    expect(fs.existsSync(path.join(APP_ROOT, 'app/+native-intent.tsx'))).toBe(false);
  });

  it("asks for the camera and explains photos for the learner's picture, and leaves the microphone to speech", () => {
    const picker = pluginOptions('expo-image-picker');
    expect(picker).toEqual({
      photosPermission: 'Cliffword opens your photos only when you choose one for your picture in the story. The photo stays on your phone.',
      cameraPermission: 'Cliffword uses the camera only when you take a selfie for your picture in the story. The photo stays on your phone.',
    });
    // microphonePermission: false would delete NSMicrophoneUsageDescription on iOS and block
    // RECORD_AUDIO on Android (the plugin's documented behaviour), which speech needs. Left out, the
    // plugin keeps the app's own text (checked by prebuild: docs/STORE.md, "Privacy manifest").
    expect(picker).not.toHaveProperty('microphonePermission');
    expect(appJson.expo.ios.infoPlist.NSMicrophoneUsageDescription).toBe(
      'Cliffword listens only while the microphone button is on, so it can hear your answers to the story.',
    );
    const android = appJson.expo.android;
    expect(android.permissions).toEqual(['RECORD_AUDIO', 'CAMERA']);
    expect(android.blockedPermissions).not.toContain('android.permission.CAMERA');
    expect(android.blockedPermissions).not.toContain('android.permission.RECORD_AUDIO');
    // The system photo picker needs no storage or media permission; the library's own are blocked.
    expect(android.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
      ]),
    );
  });

  it('raises the iOS deployment target to 17.0 with expo-build-properties', () => {
    expect(pluginOptions('expo-build-properties')).toEqual({ ios: { deploymentTarget: '17.0' } });
  });

  it('points at icons that exist: a 1024 opaque app icon, the adaptive layers, the favicon and the splash', () => {
    expect(png(appJson.expo.icon)).toEqual({ width: 1024, height: 1024, colorType: RGB });
    const adaptive = appJson.expo.android.adaptiveIcon;
    expect(png(adaptive.foregroundImage ?? '')).toEqual({ width: 1024, height: 1024, colorType: RGBA });
    expect(png(adaptive.backgroundImage ?? '').width).toBe(1024);
    expect(png(adaptive.monochromeImage ?? '')).toEqual({ width: 1024, height: 1024, colorType: RGBA });
    expect(png(appJson.expo.web.favicon)).toEqual({ width: 48, height: 48, colorType: RGBA });
    const splash = pluginOptions('expo-splash-screen');
    expect(png(String(splash?.image)).width).toBe(1024);
  });

  it('has the Play graphics: a 32-bit 512 icon and a 1024 x 500 feature graphic without alpha', () => {
    expect(png('store/graphics/play-icon-512.png')).toEqual({ width: 512, height: 512, colorType: RGBA });
    expect(png('store/graphics/play-feature-graphic.png')).toEqual({ width: 1024, height: 500, colorType: RGB });
  });

  it('keeps the brand mark as the SVG every icon is rendered from', () => {
    const mark = fs.readFileSync(path.join(APP_ROOT, 'assets/brand/mark.svg'), 'utf8');
    expect(mark).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 724 450"/);
    expect(mark).not.toMatch(/<text/);
  });
});
