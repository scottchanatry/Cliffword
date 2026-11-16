import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import type { Register } from '@cliffword/engine';
import type { MusicAuthorization } from '../../adapters/music/types';
import { formatBytes } from '../../adapters/model/modelFileMessages';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { tKey, useI18n, type CatalogKey } from '../../i18n';
import type { AppSettings, TextMode } from '../../storage/repos/settings';
import { colors, layout, spacing } from '../../theme';
import { Card, InterfaceText, Screen } from '../../ui';
import { RegionPills, type RegionCode } from '../music/RegionPills';
import { SourceRow } from '../music/SourceRow';
import { ConfirmSheet } from './ConfirmSheet';
import { DangerRow } from './DangerRow';
import { LinkRow } from './LinkRow';
import { ModelCard, type ModelStatusProps } from './ModelCard';
import { ModalHeader } from './ModalHeader';
import { RateStepper } from './RateStepper';
import { SegmentedControl } from './SegmentedControl';
import { SettingsRow } from './SettingsRow';
import { ToggleRow } from './ToggleRow';
import { VoicePicker } from './VoicePicker';
import type { VoicesView } from './useVoices';

const TEXT_MODES: readonly { value: TextMode; label: CatalogKey }[] = [
  { value: 'auto', label: tKey('settings.text.auto') },
  { value: 'text', label: tKey('settings.text.text') },
  { value: 'tiles', label: tKey('settings.text.tiles') },
];

const REGISTERS: readonly { value: Register; label: CatalogKey }[] = [
  { value: 'neutral', label: tKey('settings.register.neutral') },
  { value: 'street', label: tKey('settings.register.street') },
];

/** Apple Music access as the settings row shows it; 'checking' until the player answered. */
export type MusicAccess = MusicAuthorization | 'checking';

export interface SettingsViewProps {
  settings: AppSettings;
  /** Translated names of the learner's language and the one they learn. */
  nativeName: string;
  targetName: string;
  /** Store a change (the screen shows the stored value once it is in). */
  onChange: (patch: Partial<AppSettings>) => void;
  onToggleRegion: (code: RegionCode) => void;
  voices: VoicesView;
  model: ModelStatusProps & { onStart: () => void; onPause: () => void };
  /** Runs after the learner confirmed; resolves when the file is gone. */
  onDeleteModel: () => Promise<void>;
  music: { access: MusicAccess; onConnect: () => void; onOpenSettings: () => void };
  /** Each runs after the learner confirmed; rejects when nothing was deleted. */
  onDeleteContent: () => Promise<void>;
  onResetProgress: () => Promise<void>;
  /** app version and native build ("1.0.0", "12"); the build is null in development. */
  version: string;
  build: string | null;
  /** Counted by the screen: seven taps open the hidden model self-test. */
  onVersionTap: () => void;
  onOpenLicenses: () => void;
  onBack: () => void;
}

type Confirm = 'model' | 'content' | 'reset';

const CONFIRM: Readonly<Record<Confirm, { title: CatalogKey; body: CatalogKey; action: CatalogKey }>> = {
  model: { title: tKey('settings.confirm.model.title'), body: tKey('model.delete.body'), action: tKey('model.delete') },
  content: { title: tKey('settings.confirm.content.title'), body: tKey('settings.confirm.content.body'), action: tKey('settings.deleteContent') },
  reset: { title: tKey('settings.confirm.reset.title'), body: tKey('settings.confirm.reset.body'), action: tKey('settings.resetProgress') },
};

/** Settings: story, voice, slang and music, speech recognition, the model, your data, about. */
export function SettingsView(props: SettingsViewProps) {
  const { t } = useI18n();
  const { settings, onChange, model } = props;
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletedModel, setDeletedModel] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const size = formatBytes(model.descriptor.bytes, t);

  const run = async (which: Confirm) => {
    setBusy(true);
    try {
      if (which === 'model') {
        await props.onDeleteModel();
        setDeletedModel(true);
        setNotice(t('model.delete.done'));
      } else if (which === 'content') {
        await props.onDeleteContent();
        setNotice(t('settings.deleteContent.done'));
      } else {
        await props.onResetProgress();
      }
    } catch {
      setNotice(t('error.generic'));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']} testID="settings-screen">
      <ModalHeader title={t('settings.title')} actionLabel={t('common.back')} onAction={props.onBack} placement="leading" actionTestID="settings-back" />
      {notice ? (
        <Card tone="soft" accessibilityLiveRegion="polite" testID="settings-notice">
          <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {notice}
          </InterfaceText>
        </Card>
      ) : null}

      <Section title={t('settings.section.story')}>
        <Field title={t('settings.text')} hint={t('settings.text.hint')} divider>
          <SegmentedControl
            label={t('settings.text')}
            options={TEXT_MODES.map((m) => ({ value: m.value, label: t(m.label) }))}
            value={settings.textMode}
            onChange={(textMode) => onChange({ textMode })}
            testID="settings-text-mode"
          />
        </Field>
        <Field title={t('settings.speechRate')} hint={t('settings.speechRate.hint')} divider>
          <RateStepper bias={settings.speechRateBias} onChange={(speechRateBias) => onChange({ speechRateBias })} />
        </Field>
        <ToggleRow
          title={t('settings.nativeAnswers', { language: props.nativeName })}
          hint={t('settings.nativeAnswers.hint', { language: props.nativeName, target: props.targetName })}
          value={settings.nativeAnswersAllowed}
          onChange={(nativeAnswersAllowed) => onChange({ nativeAnswersAllowed })}
          testID="settings-native-answers"
        />
      </Section>

      <Section title={t('voice.title')}>
        <View style={styles.field}>
          <VoicePicker
            voices={props.voices.voices}
            selected={settings.voiceId}
            onSelect={(voiceId) => onChange({ voiceId })}
            onPlay={() => props.voices.playSample(settings.voiceId)}
            playing={props.voices.playing}
            canSample={props.voices.canSample}
            language={props.targetName}
          />
        </View>
      </Section>

      <Section title={t('settings.section.slang')}>
        <Field title={t('settings.register')} hint={t('settings.register.hint')} divider>
          <SegmentedControl
            label={t('settings.register')}
            options={REGISTERS.map((r) => ({ value: r.value, label: t(r.label) }))}
            value={settings.register}
            onChange={(register) => onChange({ register })}
            testID="settings-register"
          />
        </Field>
        <Field title={t('settings.regions')} hint={t('settings.regions.hint')} divider>
          <RegionPills selected={settings.regions} onToggle={props.onToggleRegion} />
        </Field>
        <ToggleRow
          title={t('settings.explicit')}
          hint={settings.showExplicit ? t('music.explicit.onHint') : t('music.explicit.offHint')}
          value={settings.showExplicit}
          onChange={(showExplicit) => onChange({ showExplicit })}
          divider
          testID="settings-explicit"
        />
        <AppleMusicRow {...props.music} />
      </Section>

      <Section title={t('settings.section.speech')}>
        <ToggleRow
          title={t('settings.onDevice')}
          hint={settings.allowNetworkRecognition ? t('settings.onDevice.offHint') : t('settings.onDevice.onHint')}
          value={!settings.allowNetworkRecognition}
          onChange={(onDevice) => onChange({ allowNetworkRecognition: !onDevice })}
          testID="settings-on-device"
        />
      </Section>

      <ModelCard {...model} deleted={deletedModel} onDelete={() => setConfirm('model')} />

      <Section title={t('settings.section.data')}>
        <DangerRow
          title={t('settings.deleteContent')}
          hint={t('settings.deleteContent.hint')}
          onPress={() => setConfirm('content')}
          divider
          testID="settings-delete-content"
        />
        <DangerRow title={t('settings.resetProgress')} hint={t('settings.resetProgress.hint')} onPress={() => setConfirm('reset')} testID="settings-reset" />
      </Section>

      <Card testID="privacy-card">
        <InterfaceText variant="cardTitle" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('settings.privacy.title')}
        </InterfaceText>
        <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('settings.privacy.device')}
        </InterfaceText>
        <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('settings.privacy.speech')}
        </InterfaceText>
        <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('settings.privacy.none')}
        </InterfaceText>
      </Card>

      <Section title={t('settings.about')}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.build ? t('settings.versionBuild', { version: props.version, build: props.build }) : t('settings.version', { version: props.version })}
          onPress={props.onVersionTap}
          style={styles.version}
          testID="settings-version"
        >
          <InterfaceText variant="rowTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('settings.version', { version: props.version })}
          </InterfaceText>
          <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {props.build ? t('settings.build', { build: props.build }) : t('settings.build.dev')}
          </InterfaceText>
        </Pressable>
        <SettingsRow title={t('settings.nativeLanguage')} value={props.nativeName} divider />
        <SettingsRow title={t('settings.targetLanguage')} value={props.targetName} divider />
        <LinkRow title={t('licenses.title')} hint={t('licenses.hint')} onPress={props.onOpenLicenses} testID="open-licenses" />
      </Section>

      {confirm ? (
        <ConfirmSheet
          visible
          title={t(CONFIRM[confirm].title)}
          body={t(CONFIRM[confirm].body, { size })}
          confirmLabel={t(CONFIRM[confirm].action)}
          onConfirm={() => void run(confirm)}
          onCancel={() => setConfirm(null)}
          busy={busy}
        />
      ) : null}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <InterfaceText variant="eyebrow" tone="muted" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {title}
      </InterfaceText>
      <Card style={styles.card}>{children}</Card>
    </View>
  );
}

function Field({ title, hint, divider, children }: { title: string; hint?: string; divider?: boolean; children: ReactNode }) {
  return (
    <View style={[styles.field, divider && styles.fieldDivider]}>
      <InterfaceText variant="rowTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {title}
      </InterfaceText>
      {children}
      {hint ? (
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {hint}
        </InterfaceText>
      ) : null}
    </View>
  );
}

function AppleMusicRow({ access, onConnect, onOpenSettings }: SettingsViewProps['music']) {
  const { t } = useI18n();
  let hint: string;
  let action: { label: string; onPress: () => void } | null = null;
  switch (access) {
    case 'authorized':
      hint = t('music.appleMusic.connected');
      action = { label: t('action.manage'), onPress: onOpenSettings };
      break;
    case 'notDetermined':
      hint = t('music.appleMusic.notDetermined');
      action = { label: t('action.connect'), onPress: onConnect };
      break;
    case 'denied':
      hint = t('music.appleMusic.denied');
      action = { label: t('permission.openSettings'), onPress: onOpenSettings };
      break;
    case 'restricted':
      hint = t('music.appleMusic.restricted');
      break;
    case 'unsupported':
      hint = Platform.OS === 'android' ? t('music.appleMusic.android') : t('music.appleMusic.unsupported');
      break;
    default:
      hint = t('music.appleMusic.checking');
  }
  return (
    <SourceRow
      title={t('music.appleMusic')}
      hint={hint}
      {...(action ? { actionLabel: action.label, onAction: action.onPress } : {})}
      testID="settings-apple-music"
    />
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  card: { paddingVertical: spacing.xs, gap: 0 },
  field: { gap: spacing.sm, paddingVertical: spacing.md },
  fieldDivider: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  version: {
    minHeight: layout.primaryHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
});
