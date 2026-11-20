/**
 * Dev gallery of the onboarding, profile and settings views: one fixture (accountFixtures.ts) by
 * name, with a little local state (settings choices, voice, practice) so the screens can be tried
 * by hand; nothing is stored. Reached only through the guarded (dev) preview route.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatBytes } from '../../adapters/model/modelFileMessages';
import { useServices } from '../../services/ServicesProvider';
import { languageName, useI18n } from '../../i18n';
import type { YouAvatarId } from '../../illustrations';
import { DEFAULT_PICTURE, type AppSettings } from '../../storage/repos/settings';
import { colors } from '../../theme';
import { addressExample, experienceCards, trackOfPair, welcomeSample } from '../experiences/experiences';
import { AddressStepView } from '../onboarding/AddressStepView';
import { ExperienceStepView } from '../onboarding/ExperienceStepView';
import { LevelStepView } from '../onboarding/LevelStepView';
import { MicStepView } from '../onboarding/MicStepView';
import { PictureStepView } from '../onboarding/PictureStepView';
import { WelcomeView } from '../onboarding/WelcomeView';
import {
  FIXTURE_FREE_BYTES,
  FIXTURE_VOICES,
  fixtureSelfTestReport,
  MODEL_INFO_FIXTURES,
  MODEL_STATES,
  MUSIC_ACCESS_FIXTURE,
  PROFILE_FIXTURES,
  SETTINGS_FIXTURE,
  SPEECH_DENIED,
  SPEECH_NEEDS_PERMISSION,
  type AccountFixtureName,
} from './accountFixtures';
import { LicensesView } from './LicensesView';
import { ProfileView } from './ProfileView';
import { SelfTestView } from './SelfTestView';
import { SettingsView } from './SettingsView';
import type { VoicesView } from './useVoices';

const none = () => undefined;
const noneAsync = () => Promise.resolve();

export function AccountPreview({ name }: { name: AccountFixtureName }) {
  return (
    <View style={styles.root} testID="account-preview">
      <PreviewBody key={name} name={name} />
    </View>
  );
}

function PreviewBody({ name }: { name: AccountFixtureName }) {
  const { t } = useI18n();
  const { packs } = useServices();
  const language = languageName(t, packs.pair.target);
  const [settings, setSettings] = useState<AppSettings>(SETTINGS_FIXTURE);
  const change = (patch: Partial<AppSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const toggleRegion = (code: string) =>
    setSettings((s) => ({ ...s, regions: s.regions.includes(code) ? s.regions.filter((c) => c !== code) : [...s.regions, code] }));
  const voices: VoicesView = { voices: [...FIXTURE_VOICES], playing: false, canSample: true, playSample: none };
  const ctx = { hasChoices: false };
  // The picture chooser: characters change the local settings; the photo buttons do nothing here.
  const picture = {
    picture: settings.picture,
    sources: ['camera', 'library'] as const,
    busy: false,
    notice: null,
    onChooseCharacter: (id: YouAvatarId) => change({ picture: { kind: 'character', id } }),
    onPickPhoto: none,
    onRemovePhoto: () => change({ picture: DEFAULT_PICTURE }),
    onOpenSettings: none,
  };

  switch (name) {
    case 'onboarding-welcome':
      return <WelcomeView language={language} sample={welcomeSample(packs.pair, packs.lang)} saving={false} failed={false} onStart={none} onOpenPrivacy={none} />;
    case 'onboarding-experience':
      return <ExperienceStepView cards={experienceCards(packs.pair, null, settings.trackId)} ctx={ctx} saving={false} failed={false} onPick={(trackId) => change({ trackId })} onBack={none} />;
    case 'onboarding-level':
      return <LevelStepView language={language} ctx={ctx} level={settings.level} saving={false} failed={false} onPick={(level) => change({ level })} onBack={none} />;
    case 'onboarding-address':
      return (
        <AddressStepView
          language={language}
          ctx={ctx}
          example={addressExample(packs.pair, settings.trackId)}
          address={settings.address}
          saving={false}
          failed={false}
          onPick={(address) => change({ address })}
          onBack={none}
        />
      );
    case 'onboarding-picture':
      return <PictureStepView ctx={ctx} {...picture} saving={false} failed={false} onContinue={none} onBack={none} />;
    case 'onboarding-mic':
    case 'onboarding-mic-denied':
      return (
        <MicStepView
          ctx={ctx}
          availability={name === 'onboarding-mic' ? SPEECH_NEEDS_PERMISSION : SPEECH_DENIED}
          speechBusy={false}
          downloadMessage={null}
          modelSize={formatBytes(MODEL_STATES.ready.file.progress.bytesTotal, t)}
          saving={false}
          failed={false}
          onAllow={none}
          onOpenSettings={none}
          onDownloadLanguage={none}
          onFinish={none}
          onBack={none}
        />
      );
    case 'profile':
    case 'profile-new':
      return <ProfileView stats={PROFILE_FIXTURES[name]} onOpenSettings={none} onClose={none} />;
    case 'settings':
    case 'settings-downloading': {
      const model = name === 'settings' ? MODEL_STATES.ready : MODEL_STATES.downloading;
      return (
        <SettingsView
          settings={settings}
          experience={{ title: trackOfPair(packs.pair, settings.trackId)?.title ?? null, choices: trackOfPair(packs.pair, settings.trackId)?.choices ?? [] }}
          onPickExperience={(trackId) => change({ trackId })}
          picture={picture}
          nativeName={languageName(t, packs.pair.native)}
          targetName={language}
          onChange={change}
          onToggleRegion={toggleRegion}
          voices={voices}
          model={{ ...model, descriptor: { bytes: model.file.progress.bytesTotal }, freeBytes: FIXTURE_FREE_BYTES, onStart: none, onPause: none }}
          onDeleteModel={noneAsync}
          music={{ access: MUSIC_ACCESS_FIXTURE, onConnect: none, onOpenSettings: none }}
          onDeleteContent={noneAsync}
          onResetProgress={noneAsync}
          version="1.0.0"
          build="12"
          onVersionTap={none}
          onOpenLicenses={none}
          onOpenLink={noneAsync}
          onBack={none}
        />
      );
    }
    case 'licenses':
      return <LicensesView onBack={none} />;
    case 'selftest':
    case 'selftest-mock': {
      const info = name === 'selftest' ? MODEL_INFO_FIXTURES.native : MODEL_INFO_FIXTURES.mock;
      return <SelfTestView info={info} status="ready" report={fixtureSelfTestReport(info)} progress={null} onRun={none} onBack={none} />;
    }
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
});
