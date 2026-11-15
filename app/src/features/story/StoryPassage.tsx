import { StyleSheet, View } from 'react-native';
import { CliffGap } from '../../components/CliffGap';
import { useI18n } from '../../i18n';
import { useServices } from '../../services/ServicesProvider';
import { colors, radii, spacing } from '../../theme';
import { ContentText, InterfaceText } from '../../ui';
import { passageWords, type SamplePassage } from './sample';

export interface StoryPassageProps {
  passage: SamplePassage;
  /** Text shown (Ink) or words as blank tiles (Voice). */
  showText: boolean;
  /** Short native-language gloss of the new word, if the pair pack has one. */
  gloss?: string;
}

/** Placeholder passage: text with a dotted new word and the cliff gap, or blank tiles. */
export function StoryPassage({ passage, showText, gloss }: StoryPassageProps) {
  const { t } = useI18n();
  const { packs } = useServices();
  if (!showText) {
    return (
      <View style={styles.tiles} accessibilityHint={t('tile.legend')} testID="story-tiles">
        {passageWords(passage, packs.lang).map((word, i) => (
          <View
            key={`${i}-${word}`}
            accessible
            accessibilityLabel={t('tile.hidden')}
            style={[styles.tile, { width: 8 + word.length * 7 }]}
          />
        ))}
        <CliffGap />
      </View>
    );
  }
  return (
    <View style={styles.text} testID="story-text">
      <ContentText>
        {passage.before}
        <ContentText style={styles.newWord}>{passage.newWord}</ContentText>
        {passage.after}{' '}
        <CliffGap />
      </ContentText>
      {gloss ? (
        <View style={styles.gloss}>
          <InterfaceText variant="hint">
            {t('gloss.line', { word: passage.newWord, gloss })}
          </InterfaceText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { gap: spacing.lg + 2 },
  newWord: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: colors.accentText,
  },
  gloss: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.chip,
    backgroundColor: colors.heat1,
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md, columnGap: spacing.xs + 2 },
  tile: { height: 32, borderRadius: radii.tile, backgroundColor: colors.tileMid },
});
