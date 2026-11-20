import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { externalLinkUrl } from '../../src/config/links';
import { openUrl } from '../../src/config/openUrl';
import { usePairPack } from '../../src/engine/PacksProvider';
import { trackOfPair } from '../../src/features/experiences/experiences';
import { SettingsView } from '../../src/features/profile/SettingsView';
import { usePictureChooser } from '../../src/features/picture/usePictureChooser';
import { useModelFile } from '../../src/features/profile/useModelFile';
import { appVersion, useDataActions, useMusicAccess, useSecretTaps, useSettingsWriter } from '../../src/features/profile/useSettingsScreen';
import { useVoices } from '../../src/features/profile/useVoices';
import { languageName, useI18n } from '../../src/i18n';

/**
 * Settings: the learner's picture, the experience (and its choices), how characters address the
 * learner, the level, the other stored settings, the model file, your data and about (Apple Music
 * and lyrics only while Music is on). The Story tab's session follows the stored experience,
 * address and level.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const pair = usePairPack();
  const { settings, change, toggleRegion } = useSettingsWriter();
  const model = useModelFile();
  const voices = useVoices();
  const music = useMusicAccess();
  const data = useDataActions();
  const chooser = usePictureChooser();
  const openSelfTest = useCallback(() => router.push('/profile/selftest'), [router]);
  const onVersionTap = useSecretTaps(openSelfTest);
  const { version, build } = appVersion();
  const track = trackOfPair(pair, settings.trackId);

  return (
    <SettingsView
      settings={settings}
      experience={{ title: track?.title ?? null, choices: track?.choices ?? [] }}
      onPickExperience={(trackId, choices) =>
        change({ trackId, trackChoices: { ...settings.trackChoices, [trackId]: { ...(settings.trackChoices[trackId] ?? {}), ...choices } } })
      }
      nativeName={languageName(t, pair.native)}
      targetName={languageName(t, pair.target)}
      picture={{
        picture: chooser.picture,
        sources: chooser.sources,
        busy: chooser.busy,
        notice: chooser.notice,
        onChooseCharacter: chooser.chooseCharacter,
        onPickPhoto: chooser.pickPhoto,
        onRemovePhoto: chooser.removePhoto,
        onOpenSettings: chooser.openSettings,
      }}
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
        await data.resetProgress();
        // Back to the Story tab, where the first story starts again.
        router.dismissTo('/');
      }}
      version={version}
      build={build}
      onVersionTap={onVersionTap}
      onOpenLicenses={() => router.push('/profile/licenses')}
      onOpenLink={(link) => openUrl(externalLinkUrl(link))}
      onBack={() => router.back()}
    />
  );
}
