import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { borders, colors, layout, radii, spacing } from '../../theme';
import { ContentText, InterfaceText } from '../../ui';
import type { ExperienceCardData } from './experiences';
import { TrackMotif } from './TrackMotif';

export interface ExperienceListProps {
  cards: readonly ExperienceCardData[];
  /** A playable card was tapped. */
  onPick: (id: string) => void;
  /** Cards cannot be tapped (a choice is being stored). */
  disabled?: boolean;
}

/**
 * The experience picker's cards, one under the other (the screen scrolls them): a colored motif,
 * the title, the city and country, the funny tagline and a status line. Coming-soon cards are
 * shown but cannot be started. Each card is one button for screen readers.
 */
export function ExperienceList({ cards, onPick, disabled = false }: ExperienceListProps) {
  return (
    <View style={styles.list} testID="experience-list">
      {cards.map((card) => (
        <ExperienceCard key={card.id} card={card} onPick={onPick} disabled={disabled} />
      ))}
    </View>
  );
}

function ExperienceCard({ card, onPick, disabled }: { card: ExperienceCardData; onPick: (id: string) => void; disabled: boolean }) {
  const { t } = useI18n();
  const place = t('experience.place', { city: card.city, country: card.country });
  const status = card.comingSoon
    ? t('experience.comingSoon')
    : card.done
      ? t('experience.finished')
      : card.completed > 0
        ? t('experience.progress', { n: card.completed, total: card.episodes })
        : t('experience.episodes', { n: card.episodes });
  const blocked = disabled || card.comingSoon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('experience.a11y', { title: card.title, place, tagline: card.tagline, status })}
      accessibilityState={{ disabled: card.comingSoon, selected: card.current }}
      disabled={blocked}
      onPress={() => onPick(card.id)}
      testID={`experience-${card.id}`}
      style={({ pressed }) => [styles.card, card.current && styles.current, pressed && !blocked && styles.pressed]}
    >
      <TrackMotif dialect={card.dialect} muted={card.comingSoon} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <ContentText variant="title" style={[styles.title, card.comingSoon && styles.faded]} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
            {card.title}
          </ContentText>
          {card.current ? (
            <View style={styles.badge}>
              <InterfaceText variant="pillStrong" tone="onInk" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {t('experience.current')}
              </InterfaceText>
            </View>
          ) : null}
        </View>
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {place}
        </InterfaceText>
        <InterfaceText variant="body" tone={card.comingSoon ? 'muted' : 'ink'} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {card.tagline}
        </InterfaceText>
        <View style={styles.footer}>
          <InterfaceText variant="pillStrong" tone={card.comingSoon ? 'muted' : 'accent'} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`experience-${card.id}-status`}>
            {status}
          </InterfaceText>
          {!card.comingSoon ? (
            <InterfaceText variant="pillStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {card.current ? t('experience.continue') : t('experience.choose')}
            </InterfaceText>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.lg },
  card: {
    minHeight: layout.primaryHeight,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    borderWidth: borders.strong,
    borderColor: colors.card,
    overflow: 'hidden',
  },
  current: { borderColor: colors.ink },
  pressed: { opacity: 0.9 },
  body: { padding: spacing.lg, gap: spacing.xs + 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flexShrink: 1 },
  faded: { color: colors.muted },
  badge: { backgroundColor: colors.ink, borderRadius: radii.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xxs },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.sm, minHeight: 28 },
});
