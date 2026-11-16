import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { speechInStatusKey, SPEECH_IN_DOWNLOAD_ACTION } from '../../adapters/speechIn/messages';
import type { SpeechAvailability } from '../../adapters/speechIn/types';
import { HoldAnywhere } from '../../components/voice/HoldAnywhere';
import { HoldArea } from '../../components/voice/HoldArea';
import { useListenToggle } from '../../components/voice/useListenToggle';
import { COMMAND_TEXT } from '../../components/voice/CommandChips';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n, type CatalogKey } from '../../i18n';
import { colors, layout, spacing } from '../../theme';
import { Button, Card, ContentText, InterfaceText } from '../../ui';
import { TypeAnswerSheet } from '../story/TypeAnswerSheet';
import { VoicePicker } from '../profile/VoicePicker';
import type { VoicesView } from '../profile/useVoices';
import { CommandPractice } from './CommandPractice';
import { StepHeader } from './StepHeader';
import { PRACTICE_COMMANDS, type HoldPractice } from './useHoldPractice';

export interface VoiceStepViewProps {
  /** The target language's name ("Spanish"). */
  language: string;
  /** null while the first check runs. */
  availability: SpeechAvailability | null;
  speechBusy: boolean;
  downloadMessage: CatalogKey | null;
  onAllow: () => void;
  onOpenSettings: () => void;
  onDownloadLanguage: () => void;
  voices: VoicesView;
  voiceId: string | null;
  onSelectVoice: (voiceId: string | null) => void;
  practice: HoldPractice;
  saving: boolean;
  failed: boolean;
  onContinue: () => void;
  onBack: () => void;
}

/**
 * Voice step: microphone and speech permission (with the reasons), the on-device check, the story
 * voice with a sample, and practice: hold anywhere on the practice card and say the six commands.
 * Without speech (refused, unsupported) the practice takes typed commands.
 */
export function VoiceStepView(props: VoiceStepViewProps) {
  const { t } = useI18n();
  const { availability, practice } = props;
  const [typing, setTyping] = useState(false);
  const ready = availability?.status === 'ready';
  const toggle = useListenToggle(practice.listen, practice.actions);
  const heard = practice.heard;
  const remaining = PRACTICE_COMMANDS.length - practice.practised.length;

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.root} testID="onboarding-voice">
      <HoldAnywhere actions={practice.actions} enabled={ready}>
        <ScrollView contentContainerStyle={styles.content}>
          <StepHeader step="voice" onBack={props.onBack} />
          <ContentText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
            {t('onboarding.voice.title')}
          </ContentText>
          <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('onboarding.voice.body')}
          </InterfaceText>

          <SpeechCard {...props} />

          <View style={styles.section}>
            <InterfaceText variant="eyebrow" tone="muted" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t('voice.title')}
            </InterfaceText>
            <Card>
              <VoicePicker
                voices={props.voices.voices}
                selected={props.voiceId}
                onSelect={props.onSelectVoice}
                onPlay={() => props.voices.playSample(props.voiceId)}
                playing={props.voices.playing}
                canSample={props.voices.canSample}
                language={props.language}
              />
            </Card>
          </View>

          <View style={styles.section}>
            <InterfaceText variant="eyebrow" tone="muted" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t('onboarding.practice.title')}
            </InterfaceText>
            <Card testID="practice-card">
              <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {ready ? t('onboarding.practice.body') : t('onboarding.practice.bodyTyped')}
              </InterfaceText>
              <CommandPractice commands={PRACTICE_COMMANDS} practised={practice.practised} onHear={practice.hear} />
              {ready ? (
                <HoldArea
                  title={t('onboarding.practice.hold')}
                  subtitle={t('onboarding.practice.holdHint')}
                  listen={practice.listen}
                  onToggle={toggle}
                  height={150}
                  ringsWidth={96}
                  testID="practice-hold"
                />
              ) : null}
              {heard ? (
                <InterfaceText
                  variant="body"
                  tone={heard.command ? 'ink' : 'accent'}
                  accessibilityLiveRegion="polite"
                  maxFontSizeMultiplier={CHROME_MAX_SCALE}
                  testID="practice-heard"
                >
                  {heard.command
                    ? t('onboarding.practice.matched', { text: heard.text, gloss: t(COMMAND_TEXT[heard.command].gloss) })
                    : t('onboarding.practice.noMatch', { text: heard.text })}
                </InterfaceText>
              ) : null}
              <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="practice-count">
                {remaining === 0 ? t('onboarding.practice.all') : t('onboarding.practice.count', { n: practice.practised.length, total: PRACTICE_COMMANDS.length })}
              </InterfaceText>
              <Button variant="ghost" label={t('action.typeInstead')} onPress={() => setTyping(true)} testID="practice-type" />
            </Card>
          </View>

          {props.failed ? (
            <InterfaceText tone="accent" accessibilityRole="alert" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t('error.generic')}
            </InterfaceText>
          ) : null}
          <Button label={t('common.continue')} onPress={props.onContinue} disabled={props.saving} testID="voice-continue" />
          <InterfaceText variant="caption" tone="muted" style={styles.center} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('onboarding.practice.later')}
          </InterfaceText>
        </ScrollView>
      </HoldAnywhere>
      <TypeAnswerSheet
        visible={typing}
        onSubmit={(text) => {
          setTyping(false);
          practice.typed(text);
        }}
        onClose={() => setTyping(false)}
      />
    </SafeAreaView>
  );
}

/** Permission, on-device recognition and the offline download, by what listening would do now. */
function SpeechCard({ availability, speechBusy, downloadMessage, onAllow, onOpenSettings, onDownloadLanguage }: VoiceStepViewProps) {
  const { t } = useI18n();
  if (!availability) {
    return (
      <Card testID="speech-card">
        <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('onboarding.voice.checking')}
        </InterfaceText>
      </Card>
    );
  }
  const { status } = availability;
  if (status === 'ready') {
    return (
      <Card testID="speech-card">
        <InterfaceText variant="cardTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('permission.microphone.title')}
        </InterfaceText>
        <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="speech-status">
          {availability.onDevice ? t('onboarding.voice.ready') : t('onboarding.voice.readyServer')}
        </InterfaceText>
      </Card>
    );
  }
  if (availability.permission === 'denied') {
    // Refused: Settings can turn it back on (Android may still ask once more); typing works.
    return (
      <Card testID="speech-card">
        <InterfaceText variant="cardTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('permission.microphone.title')}
        </InterfaceText>
        <InterfaceText variant="body" tone="accent" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="speech-status">
          {t('speechIn.status.permissionDenied')}
        </InterfaceText>
        <Button variant="outline" label={t('permission.openSettings')} onPress={onOpenSettings} testID="speech-settings" />
        {status === 'needs-permission' ? (
          <Button variant="ghost" label={t('onboarding.voice.askAgain')} onPress={onAllow} disabled={speechBusy} testID="speech-allow" />
        ) : null}
      </Card>
    );
  }
  if (status === 'needs-permission') {
    return (
      <Card testID="speech-card">
        <InterfaceText variant="cardTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('permission.microphone.title')}
        </InterfaceText>
        <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('permission.microphone.body')}
        </InterfaceText>
        <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('permission.speech.body')}
        </InterfaceText>
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('onboarding.voice.private')}
        </InterfaceText>
        <Button label={t('permission.allow')} onPress={onAllow} disabled={speechBusy} testID="speech-allow" />
      </Card>
    );
  }
  return (
    <Card testID="speech-card">
      <InterfaceText variant="cardTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('permission.microphone.title')}
      </InterfaceText>
      <InterfaceText variant="body" tone="accent" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="speech-status">
        {t(speechInStatusKey(availability))}
      </InterfaceText>
      {status === 'permission-denied' ? (
        <Button variant="outline" label={t('permission.openSettings')} onPress={onOpenSettings} testID="speech-settings" />
      ) : null}
      {status === 'on-device-unavailable' && availability.canDownload ? (
        <Button variant="outline" label={t(SPEECH_IN_DOWNLOAD_ACTION)} onPress={onDownloadLanguage} disabled={speechBusy} testID="speech-download" />
      ) : null}
      {downloadMessage ? (
        <InterfaceText variant="caption" tone="muted" accessibilityLiveRegion="polite" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t(downloadMessage)}
        </InterfaceText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  content: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: layout.screenPaddingTop / 2,
    paddingBottom: layout.screenPaddingBottom,
    gap: layout.screenGap,
  },
  section: { gap: spacing.sm },
  center: { textAlign: 'center' },
});
