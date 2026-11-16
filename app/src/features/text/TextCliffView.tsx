import { StyleSheet, View } from 'react-native';
import type { CliffPrompt } from '@cliffword/engine';
import { CliffGap } from '../../components/words/CliffGap';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { useServices } from '../../services/ServicesProvider';
import { spacing } from '../../theme';
import { Text } from '../../ui';
import { CliffCard } from '../story/CliffCard';
import { LyricLine } from '../music/LyricLine';
import { rawLineWords } from '../music/lyricWords';
import { CannedNote } from '../music/ReadView';
import type { LyricKindProps } from '../music/viewTypes';

/**
 * A cliff in a brought text (the Ink look, as the story's Main): the sentence before, the
 * sentence up to the ink gap (one or several words: advanced cliffs span idioms), and the
 * "Say what comes next" card with the rung's options or hint.
 */
export function TextCliffView({ screen, vm, actions, toggleListen, openTyping }: LyricKindProps<'cliff'>) {
  const { t } = useI18n();
  const { packs } = useServices();
  const opts = { regions: vm.regions, showExplicit: vm.showExplicit };
  const previous = screen.previous.trim() ? rawLineWords(packs.lang, screen.previous, opts) : [];
  const before = rawLineWords(packs.lang, screen.before, opts);
  const cliff: CliffPrompt = {
    wordIndex: before.length,
    length: screen.gapLength,
    rung: screen.rung,
    ui: screen.ui,
    nativeAllowed: false,
    ...(screen.options ? { options: screen.options } : {}),
    ...(screen.hint ? { hint: screen.hint } : {}),
  };
  return (
    <>
      <Text variant="eyebrow" tone="muted" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="text-cliff-meta">
        {t('text.sentenceOf', { title: screen.meta.title || t('text.untitled'), n: screen.lineIndex + 1, m: screen.meta.total })}
      </Text>
      {vm.modelMode === 'canned' ? <CannedNote /> : null}
      <View style={styles.passage} testID="text-cliff-passage">
        {previous.length > 0 ? <LyricLine words={previous} look="ink" muted testID="text-previous" /> : null}
        <LyricLine
          words={before}
          look="ink"
          after={
            <View style={styles.gap}>
              <CliffGap variant="ink" />
            </View>
          }
          testID="text-current"
        />
      </View>
      <View style={styles.spacer} />
      <CliffCard
        cliff={cliff}
        listen={vm.listen}
        onToggleListen={toggleListen}
        onTypeInstead={openTyping}
        onHearAgain={() => actions.command('again')}
        onSkip={() => actions.command('dont_know')}
        onPickOption={actions.pickOption}
      />
    </>
  );
}

const styles = StyleSheet.create({
  passage: { gap: spacing.xs },
  gap: { marginLeft: spacing.xxs },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
});
