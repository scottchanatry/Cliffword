/**
 * Dev gallery of the onboarding, profile and settings views: one fixture (accountFixtures.ts) by
 * name, with a little local state (settings choices, voice, practice) so the screens can be tried
 * by hand; nothing is stored. Reached only through the guarded (dev) preview route.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { locateAnswer } from '@cliffword/engine';
import type { ListenState } from '../../session/contract';
import { useServices } from '../../services/ServicesProvider';
import { languageName, useI18n } from '../../i18n';
import type { AppSettings } from '../../storage/repos/settings';
import { colors } from '../../theme';
import { ModelStepView } from '../onboarding/ModelStepView';
import { SlangStepView } from '../onboarding/SlangStepView';
import { PRACTICE_COMMANDS, type HoldPractice } from '../onboarding/useHoldPractice';
import { VoiceStepView } from '../onboarding/VoiceStepView';
import { WelcomeView } from '../onboarding/WelcomeView';
import {
  FIXTURE_FREE_BYTES,
  FIXTURE_VOICES,
  fixtureSelfTestReport,
  MODEL_INFO_FIXTURES,
  MODEL_STATES,
  MUSIC_ACCESS_FIXTURE,
  PRACTICE_HEARD,
  PROFILE_FIXTURES,
  SETTINGS_FIXTURE,
  SPEECH_DENIED,
  SPEECH_READY,
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
  const practice = usePreviewPractice();

  switch (name) {
    case 'onboarding-welcome': {
      const first = packs.pair.starter?.sentences[0];
      const span = first ? locateAnswer(packs.lang, first.text, first.answer) : null;
      return (
        <WelcomeView
          language={language}
          sampleBefore={first && span ? first.text.slice(0, span.start) : null}
          saving={false}
          failed={false}
          onPlacement={none}
          onBrandNew={none}
          onOpenPrivacy={none}
        />
      );
    }
    case 'onboarding-model':
    case 'onboarding-model-downloading':
    case 'onboarding-model-error': {
      const state = name === 'onboarding-model' ? MODEL_STATES.absent : name === 'onboarding-model-error' ? MODEL_STATES.error : MODEL_STATES.downloading;
      return (
        <ModelStepView
          {...state}
          descriptor={{ bytes: MODEL_STATES.ready.file.progress.bytesTotal }}
          freeBytes={name === 'onboarding-model-error' ? null : FIXTURE_FREE_BYTES}
          saving={false}
          failed={false}
          onStart={none}
          onPause={none}
          onContinue={none}
          onNotNow={none}
          onBack={none}
        />
      );
    }
    case 'onboarding-voice':
    case 'onboarding-voice-denied':
      return (
        <VoiceStepView
          language={language}
          availability={name === 'onboarding-voice' ? SPEECH_READY : SPEECH_DENIED}
          speechBusy={false}
          downloadMessage={null}
          onAllow={none}
          onOpenSettings={none}
          onDownloadLanguage={none}
          voices={voices}
          voiceId={settings.voiceId}
          onSelectVoice={(voiceId) => change({ voiceId })}
          practice={practice}
          saving={false}
          failed={false}
          onContinue={none}
          onBack={none}
        />
      );
    case 'onboarding-slang':
      return (
        <SlangStepView
          language={language}
          register={settings.register}
          regions={settings.regions}
          showExplicit={settings.showExplicit}
          saving={false}
          failed={false}
          onRegister={(register) => change({ register })}
          onToggleRegion={toggleRegion}
          onToggleExplicit={() => change({ showExplicit: !settings.showExplicit })}
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

/** Practice with two commands said and the last one heard; holding shows the listening state. */
function usePreviewPractice(): HoldPractice {
  const [listen, setListen] = useState<ListenState>({ phase: 'idle' });
  return useMemo(
    () => ({
      listen,
      practised: PRACTICE_COMMANDS.slice(0, 2),
      heard: PRACTICE_HEARD,
      actions: {
        holdBegin: none,
        holdStart: () => setListen({ phase: 'listening', level: 0.6, partial: '' }),
        holdEnd: () => setListen({ phase: 'idle' }),
        holdCancel: () => setListen({ phase: 'idle' }),
      },
      typed: none,
      hear: none,
    }),
    [listen],
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
});
