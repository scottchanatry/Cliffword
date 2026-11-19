/**
 * "Change experience" on the Story tab: every experience as a card with the learner's progress
 * (each keeps its own), coming-soon ones shown but closed. Picking one that asks choices first
 * shows them; then onPick stores it (settings.trackId and trackChoices) and the story session
 * follows the settings.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../../components/words/fontScale';
import { usePairPack } from '../../../engine/PacksProvider';
import { useI18n } from '../../../i18n';
import type { LibraryProgress } from '@cliffword/engine';
import { colors, layout, radii, spacing } from '../../../theme';
import { Button, ContentText, InterfaceText } from '../../../ui';
import { experienceCards, trackOfPair } from '../../experiences/experiences';
import { ExperienceList } from '../../experiences/ExperienceList';
import { ChoiceCard } from '../../onboarding/ChoiceCard';

export interface ExperiencePickerProps {
  /** The session's library progress (each experience's episodes done), or null (Settings: none). */
  library: LibraryProgress | null;
  /** The experience in the settings, when there is no progress to read it from. */
  currentId?: string | null;
  busy?: boolean;
  onPick: (trackId: string, choices: Record<string, string>) => void;
  onClose: () => void;
}

export function ExperiencePicker({ library, currentId = null, busy = false, onPick, onClose }: ExperiencePickerProps) {
  const { t } = useI18n();
  const pair = usePairPack();
  const [asking, setAsking] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const cards = experienceCards(pair, library, currentId);
  const track = asking ? trackOfPair(pair, asking) : undefined;
  const pick = (id: string) => {
    const card = cards.find((c) => c.id === id);
    if (!card || card.comingSoon) return;
    if (card.current) {
      onClose();
      return;
    }
    if (card.missingChoices.length > 0) {
      setAsking(id);
      setChosen({});
      return;
    }
    onPick(id, {});
  };
  return (
    <View style={styles.root} testID="experience-picker">
      <View style={styles.header}>
        <ContentText variant="title" accessibilityRole="header" style={styles.title} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {track ? t('choices.title', { experience: track.title }) : t('picker.change')}
        </ContentText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={track ? () => setAsking(null) : onClose}
          testID="picker-close"
          style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
        >
          <View style={[styles.closeBar, styles.closeA]} />
          <View style={[styles.closeBar, styles.closeB]} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {track ? (
          <>
            <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t('choices.body')}
            </InterfaceText>
            {(track.choices ?? []).map((choice) => (
              <View key={choice.key} style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={choice.prompt}>
                <InterfaceText variant="cardTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                  {choice.prompt}
                </InterfaceText>
                {choice.options.map((option) => (
                  <ChoiceCard
                    key={option.id}
                    title={option.label}
                    selected={chosen[choice.key] === option.id}
                    onPress={() => setChosen((c) => ({ ...c, [choice.key]: option.id }))}
                    testID={`picker-choice-${choice.key}-${option.id}`}
                  />
                ))}
              </View>
            ))}
            <Button
              label={t('common.continue')}
              disabled={(track.choices ?? []).some((c) => chosen[c.key] === undefined)}
              onPress={() => onPick(track.id, chosen)}
              testID="picker-choices-continue"
            />
          </>
        ) : (
          <>
            <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t('picker.body')}
            </InterfaceText>
            <ExperienceList cards={cards} onPick={pick} disabled={busy} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: layout.screenPaddingX, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  title: { flex: 1 },
  close: { width: layout.minTouch, height: layout.minTouch, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  closePressed: { backgroundColor: colors.borderSoft },
  closeBar: { position: 'absolute', width: 18, height: 2, borderRadius: 1, backgroundColor: colors.ink },
  closeA: { transform: [{ rotate: '45deg' }] },
  closeB: { transform: [{ rotate: '-45deg' }] },
  content: { paddingHorizontal: layout.screenPaddingX, paddingBottom: spacing.xxxl, gap: spacing.lg },
  group: { gap: spacing.md },
});
