/**
 * The story so far, above the line on screen: the episode's earlier lines as a conversation
 * (vm.transcript, the engine's StorySession.libraryTranscript).
 *
 * - A character's line or question: the avatar, then a bubble with the name and the Spanish, the
 *   gap's words in the accent color. A tap shows or hides the English and the pictures of the
 *   line's words.
 * - Narration: centered plain text, no avatar; a tap shows or hides the English too.
 * - The learner's reply to a question: a "You" bubble on the right with the learner's picture
 *   (settings.picture: the character they chose, or their photo as a circle).
 */
import { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { EpisodeTranscript, TranscriptEntry } from '@cliffword/engine';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../../components/words/fontScale';
import { useI18n } from '../../../i18n';
import { LearnerAvatar } from '../../../components/LearnerAvatar';
import { castForSpeaker, vocabInText } from '../../../illustrations';
import { DEFAULT_PICTURE, type LearnerPicture } from '../../../storage/repos/settings';
import { colors, layout, radii, spacing } from '../../../theme';
import { ContentText, InterfaceText } from '../../../ui';
import { Avatar, WordPictures } from './Pictures';

const AVATAR = 36;

export function Transcript({ transcript, you = DEFAULT_PICTURE }: { transcript: EpisodeTranscript; you?: LearnerPicture }) {
  if (transcript.entries.length === 0) return null;
  return (
    <View style={styles.list} testID="transcript">
      {transcript.entries.map((entry) =>
        entry.kind === 'reply' ? (
          <Reply key={`reply-${entry.turnId}`} text={entry.text} you={you} />
        ) : (
          <Said key={`${entry.kind}-${entry.id}`} entry={entry} trackId={transcript.track} />
        ),
      )}
    </View>
  );
}

type Spoken = Exclude<TranscriptEntry, { kind: 'reply' }>;

/** A line or a question: a bubble with the speaker's avatar, or centered narration. */
const Said = memo(function Said({ entry, trackId }: { entry: Spoken; trackId: string }) {
  const { t } = useI18n();
  const [english, setEnglish] = useState(false);
  const gap = entry.kind === 'line' ? entry.gap : null;
  const narration = entry.speaker === null;
  const testID = `transcript-${entry.id}`;
  const body = (
    <>
      {!narration ? (
        <InterfaceText variant="pillStrong" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {entry.speaker}
        </InterfaceText>
      ) : null}
      <ContentText variant="prompt" style={[styles.text, narration && styles.narration]} maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID={`${testID}-text`}>
        {gap ? entry.text.slice(0, gap.start) : entry.text}
        {gap ? (
          <ContentText variant="prompt" style={[styles.text, styles.gap]} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
            {entry.text.slice(gap.start, gap.end)}
          </ContentText>
        ) : null}
        {gap ? entry.text.slice(gap.end) : null}
      </ContentText>
      {english ? (
        <InterfaceText variant="body" tone="muted" style={narration && styles.center} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`${testID}-english`}>
          {entry.translation}
        </InterfaceText>
      ) : null}
      {english ? (
        <View style={narration && styles.centerRow}>
          <WordPictures words={vocabInText(entry.text)} size={44} testID={`${testID}-pictures`} />
        </View>
      ) : null}
    </>
  );
  const press = {
    accessibilityRole: 'button' as const,
    accessibilityLabel: narration ? entry.text : t('episode.line.a11y', { speaker: entry.speaker ?? '', text: entry.text }),
    accessibilityHint: english ? t('episode.line.hideEnglish') : t('episode.line.showEnglish'),
    accessibilityState: { expanded: english },
    onPress: () => setEnglish((e) => !e),
    testID,
  };
  if (narration) {
    return (
      <Pressable {...press} style={({ pressed }) => [styles.narrator, pressed && styles.pressed]}>
        {body}
      </Pressable>
    );
  }
  const avatar = castForSpeaker(trackId, entry.speakerId);
  return (
    <View style={styles.row}>
      {avatar ? <Avatar source={avatar} size={AVATAR} /> : <View style={styles.avatarSpace} />}
      <Pressable {...press} style={({ pressed }) => [styles.bubble, pressed && styles.pressed]}>
        {body}
      </Pressable>
    </View>
  );
});

/** The learner's reply to a question, on the right, with their picture. */
function Reply({ text, you }: { text: string; you: LearnerPicture }) {
  const { t } = useI18n();
  return (
    <View style={[styles.row, styles.rowRight]}>
      <View style={[styles.bubble, styles.you]} accessible accessibilityLabel={t('turn.youSaid', { text })} testID="transcript-reply">
        <InterfaceText variant="pillStrong" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('transcript.you')}
        </InterfaceText>
        <ContentText variant="prompt" style={styles.text} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {text}
        </ContentText>
      </View>
      <LearnerAvatar picture={you} size={AVATAR} testID="transcript-you-avatar" />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingRight: spacing.xxl },
  rowRight: { justifyContent: 'flex-end', paddingRight: 0, paddingLeft: spacing.xxl },
  avatarSpace: { width: AVATAR },
  bubble: {
    flexShrink: 1,
    minHeight: layout.minTouch,
    gap: spacing.xxs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.list,
    borderBottomLeftRadius: radii.tile,
    backgroundColor: colors.card,
  },
  you: { backgroundColor: colors.heat1, borderBottomLeftRadius: radii.list, borderBottomRightRadius: radii.tile },
  pressed: { opacity: 0.8 },
  text: { fontSize: 19, lineHeight: 26 },
  gap: { color: colors.accentText, textDecorationLine: 'underline' },
  narrator: { minHeight: layout.minTouch, alignItems: 'center', justifyContent: 'center', gap: spacing.xxs, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  narration: { textAlign: 'center', color: colors.mutedStrong },
  center: { textAlign: 'center' },
  centerRow: { alignItems: 'center' },
});
