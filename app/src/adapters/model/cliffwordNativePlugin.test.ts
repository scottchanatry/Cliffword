/**
 * The cliffword-native config plugin (modules/cliffword-native/app.plugin.js) keeps files/models/
 * (the language model) and files/avatar/ (the learner's photo) out of Android backups. The prebuild check in the README confirms the generated files; this
 * runs the plugin's mods on a minimal manifest and resource folder.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

type Mod = (config: Record<string, unknown>) => Promise<Record<string, unknown>>;
type Plugin = (config: Record<string, unknown>) => { mods: { android: { manifest: Mod; dangerous: Mod } } };

const plugin = jest.requireActual<Plugin>('../../../modules/cliffword-native/app.plugin.js');
const appJson = jest.requireActual<{ expo: { plugins: unknown[] } }>('../../../app.json');

function manifest(attrs: Record<string, string> = {}) {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [{ $: { 'android:name': '.MainApplication', 'android:allowBackup': 'true', ...attrs } }],
    },
  };
}

describe('cliffword-native config plugin', () => {
  it('is listed in app.json', () => {
    expect(appJson.expo.plugins).toContain('./modules/cliffword-native/app.plugin.js');
  });

  it('points the application at backup rules that exclude files/models/ and files/avatar/', async () => {
    const config = plugin({ name: 'Cliffword', slug: 'cliffword' });
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cliffword-plugin-'));
    fs.mkdirSync(path.join(projectRoot, 'android/app/src/main/res'), { recursive: true });
    try {
      const modRequest = { projectRoot, platformProjectRoot: path.join(projectRoot, 'android'), platform: 'android', introspect: false };
      const result = await config.mods.android.manifest({ ...config, modResults: manifest(), modRequest });
      const app = (result.modResults as ReturnType<typeof manifest>).manifest.application[0]?.$;
      expect(app).toMatchObject({
        'android:allowBackup': 'true',
        'android:fullBackupContent': '@xml/cliffword_backup_rules',
        'android:dataExtractionRules': '@xml/cliffword_data_extraction_rules',
      });

      await config.mods.android.dangerous({ ...config, modResults: {}, modRequest });
      const xmlDir = path.join(projectRoot, 'android/app/src/main/res/xml');
      const full = fs.readFileSync(path.join(xmlDir, 'cliffword_backup_rules.xml'), 'utf8');
      const extraction = fs.readFileSync(path.join(xmlDir, 'cliffword_data_extraction_rules.xml'), 'utf8');
      expect(full).toContain('<exclude domain="file" path="models/" />');
      expect(full).toContain('<exclude domain="file" path="avatar/" />');
      expect(extraction.match(/<exclude domain="file" path="models\/" \/>/g)).toHaveLength(2);
      expect(extraction.match(/<exclude domain="file" path="avatar\/" \/>/g)).toHaveLength(2);
      expect(extraction).toMatch(/<cloud-backup>[\s\S]*<device-transfer>/);

      await expect(
        config.mods.android.manifest({ ...config, modResults: manifest({ 'android:fullBackupContent': '@xml/other' }), modRequest }),
      ).rejects.toThrow(/already set/);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
