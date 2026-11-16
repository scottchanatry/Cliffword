import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { usePairPack } from '../../src/engine/PacksProvider';
import { SettingsView } from '../../src/features/profile/SettingsView';
import { useModelFile } from '../../src/features/profile/useModelFile';
import { appVersion, useDataActions, useMusicAccess, useSecretTaps, useSettingsWriter } from '../../src/features/profile/useSettingsScreen';
import { useVoices } from '../../src/features/profile/useVoices';
import { languageName, useI18n } from '../../src/i18n';

/** Settings: every stored setting, the model file, Apple Music, your data and about. */
export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const pair = usePairPack();
  const { settings, change, toggleRegion } = useSettingsWriter();
  const model = useModelFile();
  const voices = useVoices();
  const music = useMusicAccess();
  const data = useDataActions();
  const openSelfTest = useCallback(() => router.push('/profile/selftest'), [router]);
  const onVersionTap = useSecretTaps(openSelfTest);
  const { version, build } = appVersion();

  return (
    <SettingsView
      settings={settings}
      nativeName={languageName(t, pair.native)}
      targetName={languageName(t, pair.target)}
      onChange={change}
      onToggleRegion={toggleRegion}
      voices={voices}
      model={{
        file: model.file,
        availability: model.availability,
        descriptor: model.descriptor,
        freeBytes: model.freeBytes,
        onStart: () => {
          model.start();
          if (settings.modelDeclined) change({ modelDeclined: false });
        },
        onPause: model.pause,
      }}
      onDeleteModel={model.remove}
      music={music}
      onDeleteContent={data.deleteContent}
      onResetProgress={async () => {
        // Back to the tabs first, so the guard swaps them for onboarding without a modal on top.
        router.dismissTo('/');
        await data.resetProgress();
      }}
      version={version}
      build={build}
      onVersionTap={onVersionTap}
      onOpenLicenses={() => router.push('/profile/licenses')}
      onBack={() => router.back()}
    />
  );
}
